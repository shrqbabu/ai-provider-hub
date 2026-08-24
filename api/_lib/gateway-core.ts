// Gateway core â€” the OpenAI-compatible endpoint the user hits with their own
// "ah-â€¦" key from anywhere. Flow:
//   1. Authenticate the ah- key â†’ uid.
//   2. Load the user's providers + models from Firestore.
//   3. Resolve which provider serves the requested model (auto-detect).
//   4. Try that provider's keys in order (fallback on 401/403/429/5xx/network).
//   5. Stream the upstream response straight back (SSE passes through unchanged).
//
// Supported sub-paths (OpenAI-compatible):
//   POST chat/completions   â†’ provider /chat/completions
//   POST completions        â†’ provider /completions
//   POST embeddings         â†’ provider /embeddings
//   POST messages           â†’ provider /messages (Anthropic-native)
//   GET  models             â†’ aggregate of the user's saved models + combos
import { resolveApiKey } from "./api-keys.js";
import { readKV, writeKV } from "./kv.js";
import {
  baseURLFor,
  resolveAttempts,
  providerKeys,
  type GwCombo,
  type GwModel,
  type GwProvider,
  type ResolvedRoute,
} from "./upstreams.js";
import { bearerToken, requireUser } from "./auth.js";
import { jsonResponse, type CoreRequest, type CoreResponse } from "./http.js";
import { resolveAntigravityProject } from "./oauth/device-flow.js";
import { OAUTH_PROVIDERS } from "./oauth/constants.js";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
]);

// Status codes worth retrying with the next key.
function shouldFallback(status: number): boolean {
  return (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 422 ||
    status === 429 ||
    status >= 500
  );
}

// Max time to wait for an upstream provider to return response *headers*
// (time-to-first-byte). Once headers arrive the timer is cleared, so slow
// generations / long SSE streams are never cut — but a hung upstream fails
// over to the next key/combo member instead of stalling the client forever.
// Override with GATEWAY_UPSTREAM_TTFB_MS; set 0 to disable.
const UPSTREAM_TTFB_MS = (() => {
  const v = parseInt(process.env.GATEWAY_UPSTREAM_TTFB_MS || "", 10);
  return Number.isFinite(v) && v >= 0 ? v : 60000;
})();

// Per-request latency breakdown, surfaced as a Server-Timing header so it is
// visible with plain `curl -i` or browser devtools. This lets deployments
// answer "is the 3.6s TTFB the hub or the upstream?" with real numbers.
type GwTiming = { name: string; dur: number; desc?: string };

export async function handleGateway(
  req: CoreRequest,
  nowMs: number
): Promise<CoreResponse> {
  const timing: GwTiming[] = [];
  const t0 = Date.now();
  try {
    const res = await handleGatewayCore(req, nowMs, timing);
    timing.push({ name: "total", dur: Date.now() - t0 });
    const st = formatServerTiming(timing);
    const headers: Record<string, string> = { ...(res.headers ?? {}) };
    headers["Server-Timing"] = headers["Server-Timing"]
      ? `${headers["Server-Timing"]}, ${st}`
      : st;
    return { ...res, headers };
  } catch (err) {
    // Never leak an opaque adapter-level 500: log the real cause server-side
    // AND put it in the client-facing error body (with timings), otherwise
    // data-shape bugs (e.g. a malformed KV doc) are invisible to operators.
    console.error("[gateway] unhandled error:", err);
    timing.push({ name: "total", dur: Date.now() - t0 });
    const message = err instanceof Error ? err.message : String(err);
    const isAnthropicReq = req.subPath.toLowerCase().includes("messages");
    const res = formatGatewayError(
      500,
      `Gateway internal error: ${message}`,
      isAnthropicReq
    );
    return {
      ...res,
      headers: { ...(res.headers ?? {}), "Server-Timing": formatServerTiming(timing) },
    };
  }
}

async function handleGatewayCore(
  req: CoreRequest,
  nowMs: number,
  timing: GwTiming[]
): Promise<CoreResponse> {
  const isAnthropicReq = req.subPath.toLowerCase().includes("messages");

  // â”€â”€ 1. Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const raw =
    bearerToken(req) ||
    req.header("x-api-key") ||
    req.header("api-key") ||
    req.query.get("key") ||
    req.query.get("api_key");

  if (!raw) {
    return formatGatewayError(
      401,
      "Missing API key. Send `Authorization: Bearer ah-â€¦` or `x-api-key: ah-â€¦`.",
      isAnthropicReq
    );
  }

  const connectionId = req.header("x-connection-id") || req.header("x-provider-id");
  const providerKeyHeader = req.header("x-provider-key");

  const authStart = Date.now();
  let uid = raw ? await resolveApiKey(raw) : null;
  if (!uid) {
    // Also accept direct Firebase session token or authenticated user
    uid = await requireUser(req);
  }
  timing.push({ name: "auth", dur: Date.now() - authStart });

  if (!uid) {
    return formatGatewayError(401, "Invalid or revoked API key.", isAnthropicReq);
  }

  const path = req.subPath.replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase();

  // Load the user's connected providers + models + combos
  const kvStart = Date.now();
  let [providers, models, combos] = await Promise.all([
    readKV<GwProvider[]>(uid, "providers", []),
    readKV<GwModel[]>(uid, "models", []),
    readKV<GwCombo[]>(uid, "combos", []),
  ]);

  // Defensive: these KV docs are expected to be arrays. A malformed or
  // object-shaped doc (e.g. dict-notation export from an older UI) used to
  // crash POST requests downstream with "providers.map is not a function"
  // (500), while GET /models survived because it guards with Array.isArray.
  // Normalize instead — the user then gets a clear "no providers" 400.
  if (!Array.isArray(providers)) providers = [];
  if (!Array.isArray(models)) models = [];
  if (!Array.isArray(combos)) combos = [];

  // Track which uid actually owns the loaded providers (may fall back to the
  // shared local_user store) so token refreshes persist to the right place.
  let providersOwnerUid = uid;

  if (!providers || providers.length === 0) {
    if (uid !== "local_user") {
      const [localProv, localMod, localComb] = await Promise.all([
        readKV<GwProvider[]>("local_user", "providers", []),
        readKV<GwModel[]>("local_user", "models", []),
        readKV<GwCombo[]>("local_user", "combos", []),
      ]);
      if (localProv && localProv.length > 0) {
        providers = localProv;
        providersOwnerUid = "local_user";
        if (!models || models.length === 0) models = localMod;
        if (!combos || combos.length === 0) combos = localComb;
      }
    }
  }
  timing.push({ name: "cfg", dur: Date.now() - kvStart, desc: "providers+models+combos" });

  // â”€â”€ GET models: return working models for active connected providers + combos ────
  if (path === "models" || path === "v1/models") {
    const data: Array<{ id: string; object: string; owned_by: string }> = [];
    const seenIds = new Set<string>();

    const activeProviders = Array.isArray(providers)
      ? providers.filter((p) => p && !(p as any).disabled)
      : [];

    const activeProviderIdMap = new Map<string, GwProvider>();
    for (const p of activeProviders) {
      if (p.id) activeProviderIdMap.set(p.id, p);
      if (p.displayName) activeProviderIdMap.set(p.displayName.toLowerCase(), p);
    }

    const providerModelCounts = new Map<string, number>();

    if (Array.isArray(models)) {
      for (const m of models) {
        if (!m || !m.modelId) continue;

        // Strict ownership check: Model MUST belong to an active connected provider
        const parentProvider =
          (m.providerId && activeProviderIdMap.get(m.providerId)) ||
          (m.providerId && activeProviderIdMap.get(m.providerId.toLowerCase()));

        if (activeProviders.length > 0 && !parentProvider) {
          continue; // Skip models from old/deleted/disconnected providers
        }

        const cleanId = m.modelId.replace(/^aip\//i, "");
        if (seenIds.has(cleanId)) continue;
        seenIds.add(cleanId);

        const owner = parentProvider?.displayName || parentProvider?.key || m.providerKey || "provider";
        data.push({
          id: cleanId,
          object: "model",
          owned_by: owner,
        });
        if (parentProvider?.id) {
          providerModelCounts.set(parentProvider.id, (providerModelCounts.get(parentProvider.id) || 0) + 1);
        }
      }
    }

    // Default working models per provider if an active provider has 0 discovered models
    const DEFAULT_CATALOG: Record<string, string[]> = {
      openai: ["gpt-4o", "gpt-4o-mini", "o1", "o1-mini", "o3-mini"],
      anthropic: ["claude-3-7-sonnet-latest", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"],
      google: [
        "gemini-3.7-flash-high", "gemini-3.7-flash-medium", "gemini-3.7-flash-low",
        "gemini-pro-agent", "gemini-3.1-pro-low", "gemini-3.1-flash-lite",
        "claude-opus-4-6-thinking", "claude-sonnet-4-6", "claude-3-5-sonnet-v2",
        "gpt-oss-120b-medium", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"
      ],
      antigravity: [
        "gemini-3.7-flash-high", "gemini-3.7-flash-medium", "gemini-3.7-flash-low",
        "gemini-pro-agent", "gemini-3.1-pro-low", "gemini-3.1-flash-lite",
        "claude-opus-4-6-thinking", "claude-sonnet-4-6", "claude-3-5-sonnet-v2",
        "gpt-oss-120b-medium", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"
      ],
      github: ["gpt-4o", "claude-3.5-sonnet", "o1-mini"],
      grok: ["grok-2", "grok-2-vision", "grok-beta"],
      kimi: ["kimi-k1.5", "moonshot-v1-128k", "moonshot-v1-32k"],
      nvidia: ["meta/llama-3.3-70b-instruct", "deepseek-ai/deepseek-r1"],
      openrouter: ["anthropic/claude-3.7-sonnet", "openai/gpt-4o", "deepseek/deepseek-r1"],
    };

    function detectProviderKey(p: GwProvider): string {
      const url = (p.baseURL || "").toLowerCase();
      const name = (p.displayName || (p as any).name || "").toLowerCase();
      if (url.includes("githubcopilot.com") || name.includes("copilot") || name.includes("github")) return "github";
      if (url.includes("api.x.ai") || name.includes("grok") || name.includes("xai")) return "grok";
      if (url.includes("api.kimi.com") || name.includes("kimi") || name.includes("moonshot")) return "kimi";
      if (url.includes("nvidia.com") || name.includes("nvidia")) return "nvidia";
      if (url.includes("openrouter.ai") || name.includes("openrouter")) return "openrouter";
      if (url.includes("anthropic.com") || name.includes("anthropic") || name.includes("claude")) return "anthropic";
      if (url.includes("cloudcode-pa.googleapis.com") || name.includes("antigravity")) return "antigravity";
      if (url.includes("generativelanguage.googleapis.com") || name.includes("google") || name.includes("gemini")) return "google";
      if (url.includes("openai.com") || name.includes("openai") || name.includes("codex")) return "openai";
      return p.key || "custom";
    }

    for (const p of activeProviders) {
      const count = (p.id ? providerModelCounts.get(p.id) : 0) || 0;
      const effectiveKey = detectProviderKey(p);
      if (count === 0 && (DEFAULT_CATALOG[effectiveKey] || DEFAULT_CATALOG[p.key])) {
        const catalogList = DEFAULT_CATALOG[effectiveKey] || DEFAULT_CATALOG[p.key] || [];
        for (const mid of catalogList) {
          if (!seenIds.has(mid)) {
            seenIds.add(mid);
            data.push({
              id: mid,
              object: "model",
              owned_by: effectiveKey || p.key || "provider",
            });
          }
        }
      }
    }

    if (Array.isArray(combos)) {
      for (const c of combos) {
        const comboName = (c?.name || (c as any)?.comboName || (c as any)?.id || "").trim();
        if (comboName && !seenIds.has(comboName)) {
          seenIds.add(comboName);
          data.push({
            id: comboName,
            object: "model",
            owned_by: "combo",
          });
        }
      }
    }
    return jsonResponse(200, {
      object: "list",
      data,
    });
  }

  // â”€â”€ POST inference endpoints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const endpoint = matchEndpoint(path);
  if (!endpoint) {
    return formatGatewayError(
      400,
      `Unsupported gateway path "/${path}".`,
      isAnthropicReq
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json<Record<string, unknown>>();
  } catch {
    return formatGatewayError(
      400,
      "Request body must be valid JSON.",
      isAnthropicReq
    );
  }

  // Google OAuth access tokens (Antigravity) expire about an hour after
  // login. Refresh any expired ones with the stored long-lived refresh token
  // instead of dying with 401s on every attempt until a manual reconnect.
  await refreshExpiredOAuthTokens(providers, providersOwnerUid);

  const requestedModel = String(body.model ?? "");
  const resolved = resolveAttempts(requestedModel, providers, models, combos);
  if ("error" in resolved) {
    return formatGatewayError(resolved.status, resolved.error, isAnthropicReq);
  }

  const wantsStream = body.stream === true;

  type Try = { route: ResolvedRoute; cred: string };
  const tries: Try[] = [];
  for (const route of resolved.attempts) {
    if (!baseURLFor(route.provider)) continue;
    const authList =
      route.provider.authMode === "cookie"
        ? [route.provider.cookie ?? ""].filter(Boolean)
        : route.keys.length
        ? route.keys
        : providerKeys(route.provider);
    for (const cred of authList) tries.push({ route, cred });
  }

  if (!tries.length) {
    return formatGatewayError(
      400,
      `No usable provider/key found for "${requestedModel}". Check the provider's base URL and API key in the app.`,
      isAnthropicReq
    );
  }

  // â”€â”€ Fallback loop over attempt(s) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let lastStatus = 502;
  let lastText = "All provider attempts failed.";
  const isCombo = resolved && "combo" in resolved && !!resolved.combo;
  const comboStart = Date.now();
  const comboAttempts: Array<{
    providerId: string;
    modelId: string;
    displayName?: string;
    status: "success" | "failed";
    error?: string;
    durationMs?: number;
  }> = [];

  for (let i = 0; i < tries.length; i++) {
    const { route, cred } = tries[i];
    const { provider, modelId } = route;
    const attemptStart = Date.now();

    const isAnthropicProvider = (provider.apiFormat ?? "openai") === "anthropic";
    // Two translation directions are possible, depending on what format the
    // CALLER speaks vs what the PROVIDER speaks:
    //   - /messages request â†’ OpenAI provider: translate request â†’ OpenAI,
    //     response â†’ Anthropic (needsTranslation).
    //   - /chat/completions request â†’ Anthropic provider (e.g. a combo member):
    //     translate request â†’ Anthropic, response â†’ OpenAI (toAnthropicProvider).
    const needsTranslation = endpoint === "/messages" && !isAnthropicProvider;
    const toAnthropicProvider =
      endpoint === "/chat/completions" && isAnthropicProvider;
    const isGoogleProvider =
      provider.key === "google" ||
      (provider.baseURL ?? "").includes("generativelanguage.googleapis.com") ||
      (provider.baseURL ?? "").includes("cloudcode-pa.googleapis.com");
    const isOAuth =
      provider.authMode === "oauth" ||
      cred.startsWith("ya29.");

    let actualEndpoint: string;
    let targetURL: string;
    let upstreamBody: string;

    const cleanModelId = modelId.replace(/^(google\/|aip\/)/i, "");
    const candidateUrls: string[] = [];

    if (needsTranslation && isGoogleProvider) {
      const googleRequest = anthropicToGoogle(body, cleanModelId);
      const streamEndpoint = wantsStream
        ? "streamGenerateContent"
        : "generateContent";
      const sseParam = wantsStream ? (isOAuth ? "?alt=sse" : "&alt=sse") : "";

      if (isOAuth) {
        const projStart = Date.now();
        let projectId = provider.extraHeaders?.projectId || "";
        if (!projectId) {
          try {
            projectId = await resolveAntigravityProject(cred);
          } catch {}
        }
        timing.push({ name: "proj", dur: Date.now() - projStart, desc: "antigravity-project" });

        candidateUrls.push(
          `https://cloudcode-pa.googleapis.com/v1internal:${streamEndpoint}${sseParam}`,
          `https://daily-cloudcode-pa.googleapis.com/v1internal:${streamEndpoint}${sseParam}`,
          `https://cloudcode-pa.googleapis.com/v1alpha/models/${cleanModelId}:${streamEndpoint}${sseParam}`
        );
        if (cleanModelId.startsWith("claude-")) {
          const gemFallback = cleanModelId.includes("sonnet") || cleanModelId.includes("opus") ? "gemini-2.5-pro" : "gemini-2.0-flash";
          candidateUrls.push(
            `https://cloudcode-pa.googleapis.com/v1internal:${streamEndpoint}${sseParam}`,
            `https://daily-cloudcode-pa.googleapis.com/v1internal:${streamEndpoint}${sseParam}`,
            `https://cloudcode-pa.googleapis.com/v1alpha/models/${gemFallback}:${streamEndpoint}${sseParam}`
          );
        }
        upstreamBody = JSON.stringify({
          model: cleanModelId,
          project: projectId || "",
          request: googleRequest,
        });
      } else {
        candidateUrls.push(
          `https://generativelanguage.googleapis.com/v1beta/models/${cleanModelId}:${streamEndpoint}?key=${encodeURIComponent(cred)}${sseParam}`,
          `https://generativelanguage.googleapis.com/v1/models/${cleanModelId}:${streamEndpoint}?key=${encodeURIComponent(cred)}${sseParam}`
        );
        upstreamBody = JSON.stringify({ model: cleanModelId, ...googleRequest });
      }
      actualEndpoint = endpoint;
    } else if (isGoogleProvider) {
      const googleRequest = openAIToGoogle(body, cleanModelId);
      const streamEndpoint = wantsStream
        ? "streamGenerateContent"
        : "generateContent";
      const sseParam = wantsStream ? (isOAuth ? "?alt=sse" : "&alt=sse") : "";

      if (isOAuth) {
        const projStart = Date.now();
        let projectId = provider.extraHeaders?.projectId || "";
        if (!projectId) {
          try {
            projectId = await resolveAntigravityProject(cred);
          } catch {}
        }
        timing.push({ name: "proj", dur: Date.now() - projStart, desc: "antigravity-project" });

        candidateUrls.push(
          `https://cloudcode-pa.googleapis.com/v1internal:${streamEndpoint}${sseParam}`,
          `https://daily-cloudcode-pa.googleapis.com/v1internal:${streamEndpoint}${sseParam}`,
          `https://cloudcode-pa.googleapis.com/v1alpha/models/${cleanModelId}:${streamEndpoint}${sseParam}`
        );
        if (cleanModelId.startsWith("claude-")) {
          const gemFallback = cleanModelId.includes("sonnet") || cleanModelId.includes("opus") ? "gemini-2.5-pro" : "gemini-2.0-flash";
          candidateUrls.push(
            `https://cloudcode-pa.googleapis.com/v1internal:${streamEndpoint}${sseParam}`,
            `https://daily-cloudcode-pa.googleapis.com/v1internal:${streamEndpoint}${sseParam}`,
            `https://cloudcode-pa.googleapis.com/v1alpha/models/${gemFallback}:${streamEndpoint}${sseParam}`
          );
        }
        upstreamBody = JSON.stringify({
          model: cleanModelId,
          project: projectId || "",
          request: googleRequest,
        });
      } else {
        candidateUrls.push(
          `https://generativelanguage.googleapis.com/v1beta/models/${cleanModelId}:${streamEndpoint}?key=${encodeURIComponent(cred)}${sseParam}`,
          `https://generativelanguage.googleapis.com/v1/models/${cleanModelId}:${streamEndpoint}?key=${encodeURIComponent(cred)}${sseParam}`
        );
        upstreamBody = JSON.stringify({ model: cleanModelId, ...googleRequest });
      }
      actualEndpoint = endpoint;
    } else if (needsTranslation) {
      actualEndpoint = "/chat/completions";
      candidateUrls.push(baseURLFor(provider).replace(/\/$/, "") + actualEndpoint);
      upstreamBody = JSON.stringify(
        anthropicToOpenAI(body, cleanModelId, provider.key)
      );
    } else if (toAnthropicProvider) {
      actualEndpoint = "/messages";
      candidateUrls.push(baseURLFor(provider).replace(/\/$/, "") + actualEndpoint);
      upstreamBody = JSON.stringify(openAIToAnthropic(body, cleanModelId));
    } else {
      actualEndpoint = endpoint;
      candidateUrls.push(baseURLFor(provider).replace(/\/$/, "") + actualEndpoint);
      upstreamBody = JSON.stringify({ ...body, model: cleanModelId });
    }

    const headers =
      isGoogleProvider
        ? buildUpstreamHeaders(provider, cred, actualEndpoint)
        : buildUpstreamHeaders(provider, cred, actualEndpoint);

    let upstream: Response | null = null;
    const upStart = Date.now();
    // First REAL API error across this member's candidate URLs — generic
    // fallback tail errors (the v1alpha variant's HTML 404 page) must not
    // mask it in surfaced errors / combo logs.
    let memberFirstError = "";
    // NOTE: every failed candidate's body is consumed below via safeText and
    // kept in lastText. If the last attempt also fails, that text is what we
    // surface to the caller (see the !succeeded branch after combo logging).

    for (const url of candidateUrls) {
      try {
        const candidateResp = await fetchUpstream(url, {
          method: "POST",
          headers,
          body: upstreamBody,
        }, UPSTREAM_TTFB_MS);

        // Detect HTML responses — upstream returned a web page, not an API.
        const ct = (candidateResp.headers.get("content-type") ?? "").toLowerCase();
        if (ct.includes("text/html")) {
          lastStatus = candidateResp.status || 502;
          lastText = `Upstream returned an HTML page (Error ${candidateResp.status}). Check the provider Base URL (include /v1).`;
          continue;
        }

        if (candidateResp.ok) {
          upstream = candidateResp;
          break;
        }

        lastStatus = candidateResp.status;
        lastText = await safeText(candidateResp);
        if (!memberFirstError && lastText && !isHtmlLike(lastText)) {
          memberFirstError = lastText;
        }

        // Content-sniff non-ok bodies: some servers return an HTML page with a
        // mislabeled/missing content-type header (e.g. a WAF or captive portal
        // that replies text/plain). Relaying that raw makes the client's JSON
        // parser throw "Unexpected token < in JSON", so refuse to forward it and
        // surface a clear message instead — same as the content-type check above.
        if (isHtmlLike(lastText)) {
          lastText = `Upstream returned an HTML page (Error ${candidateResp.status}). Check the provider Base URL (include /v1).`;
          continue;
        }

        // Account-level failures (401/403/429) usually share the same
        // credentials across EVERY candidate URL variant, so retrying the
        // variants just burns round-trips (up to 6 sequential calls per
        // failing combo member = multi-second agent stalls): hand the error
        // to the outer fallback loop (next key / next combo member) instead.
        //
        // EXCEPTION — Google CloudCode (Antigravity OAuth) 429s:
        // cloudcode-pa.googleapis.com and daily-cloudcode-pa.googleapis.com
        // are separate frontends with SEPARATE quota buckets, so a 429 from
        // the primary MUST fall through to the daily variant. The in-app
        // model test (api/proxy.ts) does exactly this, which is why the app
        // kept serving models while Claude Code — the gateway /messages
        // path — got a raw 429 for the very same model.
        const accountLevel =
          candidateResp.status === 401 ||
          candidateResp.status === 403 ||
          (candidateResp.status === 429 && !(isGoogleProvider && isOAuth));

        // If candidate url returned a shape-level error (400/404/5xx), try
        // the next URL variant — endpoint availability differs per model.
        if (!accountLevel && candidateUrls.length > 1) {
          continue;
        }

        upstream = candidateResp;
        break;
      } catch (err) {
        lastStatus = 502;
        lastText = err instanceof Error ? err.message : "Upstream fetch failed.";
      }
    }

    // Surface the REAL upstream reason (quota / bad payload / auth) instead
    // of the generic tail candidate error (e.g. an HTML 404 from the
    // v1alpha variant) whenever one was seen.
    if (memberFirstError) lastText = memberFirstError;

    timing.push({ name: `up${i + 1}`, dur: Date.now() - upStart, desc: cleanModelId });

    if (!upstream) {
      if (isCombo) {
        comboAttempts.push({
          providerId: provider.id,
          modelId: modelId,
          displayName: modelId,
          status: "failed",
          error: lastText,
          durationMs: Date.now() - attemptStart,
        });
      }
      continue;
    }

    if (shouldFallback(upstream.status) && i < tries.length - 1) {
      lastStatus = upstream.status;
      // The body may already have been read by the candidate-URL loop's
      // safeText (e.g. an account-level 401/403/429 response that escaped
      // the cascade) — keep that text instead of re-reading a used body.
      if (!upstream.bodyUsed) {
        lastText = await safeText(upstream);
      }
      if (isCombo) {
        comboAttempts.push({
          providerId: provider.id,
          modelId: modelId,
          displayName: modelId,
          status: "failed",
          error: lastText,
          durationMs: Date.now() - attemptStart,
        });
      }
      continue;
    }

    // We're here on either a genuine success OR the LAST attempt (which may
    // still be an error, e.g. every combo member is rate-limited). Only treat
    // a 2xx as success â€” otherwise the combo log would show "responded" while
    // the client actually receives the upstream error.
    const succeeded = upstream.ok;

    if (succeeded) {
      void recordUsage(uid, provider.id, modelId, nowMs).catch(() => {});
    } else {
      lastStatus = upstream.status;
    }

    let comboLogId = "";
    if (isCombo && resolved.combo) {
      // On failure paths the response body was almost always already consumed
      // (the candidate-URL loop's safeText, or the fallback check above), so
      // upstream.clone() here would throw "Response.clone: Body has already
      // been consumed" — crashing the request with an opaque 500 instead of
      // returning the REAL upstream error. lastText already holds that error
      // body on every failure path — reuse it.
      const attemptError = succeeded
        ? undefined
        : lastText || `HTTP ${upstream.status}`;
      comboAttempts.push({
        providerId: provider.id,
        modelId: modelId,
        displayName: modelId,
        status: succeeded ? "success" : "failed",
        error: attemptError,
        durationMs: Date.now() - attemptStart,
      });
      void recordComboLog(uid, {
        id: (comboLogId = `glog_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
        comboId: resolved.combo.id,
        comboName: resolved.combo.name,
        respondingModelId: succeeded ? modelId : "",
        respondingProviderId: succeeded ? provider.id : "",
        respondingModelName: succeeded ? modelId : undefined,
        attempts: [...comboAttempts],
        tokensIn: 0,
        tokensOut: 0,
        durationMs: Date.now() - comboStart,
        createdAt: Date.now(),
      }).catch(() => {});
    }

    if (!succeeded) {
      // Failed responses already had their bodies consumed (safeText in the
      // candidate loop / fallback check), so relay() or the translators would
      // only forward an empty husk with a bare status like "401 ". Return the
      // REAL upstream error text instead — operators must see "token expired"
      // / "quota exhausted" / actual provider messages to act on them.
      return formatGatewayError(
        lastStatus,
        `Upstream error (${lastStatus}): ${lastText}`,
        isAnthropicReq
      );
    }

    // Successful combo response: wrap it in the usage tap so the combo log
    // written above gets patched with real token counts + true duration once
    // the stream/JSON body actually finishes reaching the client.
    const respondWithTap = (res: any) =>
      succeeded && comboLogId
        ? tapComboLogUsage(res, {
            uid,
            logId: comboLogId,
            startedAt: comboStart,
            requestBytes: upstreamBody.length,
          })
        : res;

    if (needsTranslation && isGoogleProvider) {
      return respondWithTap(await translateGoogleResponseToAnthropic(upstream, wantsStream, modelId, body));
    }
    if (isGoogleProvider) {
      return respondWithTap(await translateGoogleResponseToOpenAI(upstream, wantsStream, cleanModelId, body));
    }
    if (needsTranslation) {
      return respondWithTap(await translateResponseToAnthropic(upstream, wantsStream, modelId));
    }
    if (toAnthropicProvider) {
      return respondWithTap(await translateAnthropicResponseToOpenAI(
        upstream,
        wantsStream,
        cleanModelId
      ));
    }
    return respondWithTap(relay(upstream, wantsStream, isAnthropicReq));
  }

  if (isCombo && resolved.combo) {
    void recordComboLog(uid, {
      id: `glog_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      comboId: resolved.combo.id,
      comboName: resolved.combo.name,
      respondingModelId: "",
      respondingProviderId: "",
      attempts: [...comboAttempts],
      tokensIn: 0,
      tokensOut: 0,
      durationMs: Date.now() - comboStart,
      createdAt: Date.now(),
    }).catch(() => {});
  }

  return formatGatewayError(
    lastStatus,
    `All ${tries.length} attempt(s) failed. Last upstream error: ${lastText}`,
    isAnthropicReq
  );
}

function buildUpstreamHeaders(
  provider: GwProvider,
  cred: string,
  endpoint: string
): Headers {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  // Ask upstream for uncompressed bytes. We relay the body straight through
  // while stripping content-encoding, so a gzip/br body would reach the
  // client mislabeled and render as garbage.
  headers.set("Accept-Encoding", "identity");

  const isCopilot = (provider.baseURL ?? "").includes("api.githubcopilot.com") || (provider.baseURL ?? "").includes("copilot");
  const isGrok = (provider.baseURL ?? "").includes("api.x.ai");

  if (provider.key === "google" || (provider.baseURL ?? "").includes("googleapis.com")) {
    headers.set("User-Agent", "antigravity/1.0.0 darwin/arm64");
    headers.set("x-goog-api-client", "gl-node/22.21.1 google-api-nodejs-client/10.3.0");
  }

  const isAnthropic =
    provider.apiFormat === "anthropic" || endpoint === "/messages";

  if (isCopilot) {
    // GitHub Copilot: use the copilotToken stored in extraHeaders, not the GitHub access_token
    const copilotToken = provider.extraHeaders?.copilotToken || cred;
    headers.set("Authorization", `Bearer ${copilotToken}`);
    headers.set("X-GitHub-Api-Version", "2023-07-07");
    headers.set("User-Agent", "GitHubCopilot/1.0");
    headers.set("Editor-Version", "vscode/1.95.0");
    headers.set("Editor-Plugin-Version", "copilot/1.255.0");
    headers.set("Copilot-Integration-Id", "vscode-chat");
    headers.set("Openai-Intent", "conversation-panel");
    // Don't add extra headers from provider.extraHeaders for Copilot since they
    // contain copilotToken/copilotEndpoints metadata, not HTTP headers
    return headers;
  }

  if (isGrok) {
    headers.set("Authorization", `Bearer ${cred}`);
    headers.set("x-grok-client-version", "0.2.106");
    headers.set("x-grok-client-surface", "cli");
  } else if (provider.authMode === "cookie") {
    headers.set("Cookie", cred);
  } else if (
    // Google endpoints (Cloud Code / Generative Language) expect OAuth creds
    // as a Bearer token — NEVER Anthropic-style x-api-key. Without this,
    // /messages (Claude Code) requests to Antigravity went out with
    // "x-api-key: ya29.…" because endpoint==="/messages" forced the
    // isAnthropic branch, and Google answered 401 UNAUTHENTICATED on every
    // attempt — while OpenAI-format clients worked fine (Bearer branch).
    (provider.key === "google" ||
      provider.key === "antigravity" ||
      (provider.baseURL ?? "").includes("googleapis.com")) &&
    (provider.authMode === "oauth" || cred.startsWith("ya29."))
  ) {
    headers.set("Authorization", `Bearer ${cred}`);
  } else if (isAnthropic) {
    headers.set("x-api-key", cred);
    headers.set("anthropic-version", "2023-06-01");
  } else {
    headers.set("Authorization", `Bearer ${cred}`);
  }
  if (provider.organization)
    headers.set("OpenAI-Organization", provider.organization);
  if (provider.extraHeaders) {
    for (const [k, v] of Object.entries(provider.extraHeaders)) {
      // Skip internal metadata keys that aren't actual HTTP headers
      if (k === "copilotToken" || k === "copilotTokenExpiresAt" || k === "copilotEndpoints") continue;
      headers.set(k, v);
    }
  }
  return headers;
}

// Translate an OpenAI /chat/completions request into the Anthropic Messages
// wire format. Used when a caller speaks OpenAI (e.g. Claude Desktop through a
// combo, or the app's own chat) but the serving provider is Anthropic-native.
function openAIToAnthropic(
  body: Record<string, unknown>,
  modelId: string
): Record<string, unknown> {
  const messages: Array<{ role: string; content: string | unknown[] }> = [];

  const inMsgs = (body.messages ?? []) as Array<{
    role: string;
    content: string | Array<Record<string, unknown>>;
  }>;

  for (const msg of inMsgs) {
    // Anthropic has no system message role â€” system content is collected into
    // the top-level `system` field at the end, so skip it here.
    if (msg.role === "system") continue;
    const role = msg.role === "assistant" ? "assistant" : "user";
    if (typeof msg.content === "string") {
      messages.push({ role, content: msg.content });
      continue;
    }
    if (!Array.isArray(msg.content)) {
      messages.push({ role, content: String(msg.content ?? "") });
      continue;
    }

    // Multimodal blocks: text, image_url, file. tool_calls / tool results are
    // represented as text (no tool wiring in this path).
    const parts: unknown[] = [];
    for (const b of msg.content) {
      const block = b as Record<string, unknown>;
      if (block.type === "text" && typeof block.text === "string") {
        parts.push({ type: "text", text: block.text });
      } else if (block.type === "image_url") {
        const url =
          (block.image_url as Record<string, unknown>)?.url ?? "";
        if (typeof url === "string" && url) {
          // data:image/...;base64,... â†’ Anthropic inline image block.
          const m = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(url);
          if (m) {
            parts.push({
              type: "image",
              source: {
                type: "base64",
                media_type: m[1],
                data: m[2],
              },
            });
          } else {
            parts.push({ type: "text", text: `[image: ${url}]` });
          }
        }
      } else if (block.type === "file") {
        const file = block.file as Record<string, unknown> | undefined;
        const filename = String(file?.filename ?? "file");
        const fileData = String(file?.file_data ?? "");
        const m = /^data:(application\/[\w.+-]+);base64,(.+)$/.exec(fileData);
        if (m) {
          parts.push({
            type: "document",
            source: { type: "base64", media_type: m[1], data: m[2] },
            title: filename,
          });
        } else {
          parts.push({ type: "text", text: `[attached file: ${filename}]` });
        }
      }
    }
    if (parts.length === 0) parts.push({ type: "text", text: "" });
    messages.push({ role, content: parts });
  }

  const result: Record<string, unknown> = {
    model: modelId,
    messages,
  };

  if (body.stream === true) result.stream = true;
  if (body.max_tokens != null) result.max_tokens = body.max_tokens;
  else if (body.max_completion_tokens != null) {
    result.max_tokens = body.max_completion_tokens;
  }
  if (body.temperature != null) result.temperature = body.temperature;
  if (body.top_p != null) result.top_p = body.top_p;

  // OpenAI tool_calls â†’ Anthropic tools. The first system message in the
  // conversation is lifted into systemInstruction (Anthropic requires it
  // outside the messages array).
  const systemParts: string[] = [];
  for (const msg of inMsgs) {
    if (msg.role === "system") {
      if (typeof msg.content === "string") systemParts.push(msg.content);
      else if (Array.isArray(msg.content)) {
        for (const b of msg.content) {
          if ((b as Record<string, unknown>).type === "text") {
            systemParts.push(String((b as Record<string, unknown>).text ?? ""));
          }
        }
      }
    }
  }
  if (systemParts.length) {
    result.system = systemParts.join("\n");
  }

  const tools = body.tools as Array<{
    type?: string;
    function?: { name?: string; description?: string; parameters?: unknown };
  }> | undefined;
  if (Array.isArray(tools) && tools.length) {
    result.tools = tools.map((t) => ({
      name: t.function?.name ?? "",
      description: t.function?.description ?? "",
      input_schema:
        t.function?.parameters ?? { type: "object", properties: {} },
    }));
    const tc = body.tool_choice as
      | string
      | { type?: string; function?: { name?: string } }
      | undefined;
    if (typeof tc === "string") {
      if (tc === "required") result.tool_choice = { type: "any" };
      else if (tc === "auto") result.tool_choice = { type: "auto" };
      else result.tool_choice = { type: "auto" };
    } else if (tc?.type === "function" && tc.function?.name) {
      result.tool_choice = { type: "tool", name: tc.function.name };
    } else if (tc?.type === "required") {
      result.tool_choice = { type: "any" };
    } else if (tc?.type === "auto") {
      result.tool_choice = { type: "auto" };
    }
  }

  return result;
}

function anthropicToOpenAI(
  body: Record<string, unknown>,
  modelId: string,
  providerKey?: string
): Record<string, unknown> {
  const messages: Array<{ role: string; content: string | unknown[] }> = [];

  const sys = body.system;
  if (sys) {
    const sysText =
      typeof sys === "string"
        ? sys
        : Array.isArray(sys)
        ? (sys as Array<{ text?: string }>).map((b) => b.text ?? "").join("\n")
        : "";
    if (sysText) messages.push({ role: "system", content: sysText });
  }

  const inMsgs = (body.messages ?? []) as Array<{
    role: string;
    content: string | Array<Record<string, unknown>>;
  }>;

  for (const msg of inMsgs) {
    if (typeof msg.content === "string") {
      messages.push({ role: msg.role, content: msg.content });
      continue;
    }
    if (!Array.isArray(msg.content)) {
      messages.push({ role: msg.role, content: String(msg.content ?? "") });
      continue;
    }

    const blocks = msg.content;
    const textParts = blocks
      .filter((b) => b.type === "text")
      .map((b) => (b.text as string) ?? "")
      .join("\n");

    if (msg.role === "assistant") {
      const toolUses = blocks.filter((b) => b.type === "tool_use");
      const m: Record<string, unknown> = {
        role: "assistant",
        content: textParts || null,
      };
      if (toolUses.length) {
        m.tool_calls = toolUses.map((t) => ({
          id: t.id,
          type: "function",
          function: { name: t.name, arguments: JSON.stringify(t.input ?? {}) },
        }));
      }
      messages.push(m as { role: string; content: string | unknown[] });
      continue;
    }

    const toolResults = blocks.filter((b) => b.type === "tool_result");
    for (const tr of toolResults) {
      let trText = "";
      const trc = tr.content;
      if (typeof trc === "string") trText = trc;
      else if (Array.isArray(trc)) {
        trText = (trc as Array<Record<string, unknown>>)
          .filter((x) => x.type === "text")
          .map((x) => (x.text as string) ?? "")
          .join("\n");
      }
      messages.push({
        role: "tool",
        tool_call_id: tr.tool_use_id,
        content: trText,
      } as unknown as { role: string; content: string });
    }
    if (textParts || !toolResults.length) {
      messages.push({ role: "user", content: textParts });
    }
  }

  const result: Record<string, unknown> = {
    model: modelId,
    messages,
  };

  if (body.stream === true) result.stream = true;
  if (body.max_tokens != null) {
    let maxTokens = Number(body.max_tokens);
    if (providerKey === "nvidia" && maxTokens > 4096) {
      maxTokens = 4096;
    }
    result.max_tokens = maxTokens;
  }
  if (body.temperature != null) result.temperature = body.temperature;
  if (body.top_p != null) result.top_p = body.top_p;
  if (body.stop_sequences != null) result.stop = body.stop_sequences;

  const tools = body.tools as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(tools) && tools.length) {
    result.tools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description ?? "",
        parameters: t.input_schema ?? { type: "object", properties: {} },
      },
    }));
    const tc = body.tool_choice as { type?: string; name?: string } | undefined;
    if (tc?.type === "tool" && tc.name) {
      result.tool_choice = { type: "function", function: { name: tc.name } };
    } else if (tc?.type === "any") {
      result.tool_choice = "required";
    } else if (tc?.type === "auto") {
      result.tool_choice = "auto";
    }
  }

  return result;
}

const GOOGLE_ALLOWED_SCHEMA_KEYS = new Set([
  "type",
  "format",
  "description",
  "nullable",
  "enum",
  "items",
  "properties",
  "required",
]);

function cleanSchemaForGoogle(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(cleanSchemaForGoogle);

  const src = obj as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};

  // Fold union/composition keywords Gemini rejects into the parent schema.
  // Dropping them used to strip every tool down to {"type":"object",
  // "properties":{}} — models then called tools with no/empty arguments and
  // agentic clients (Claude Code, Cline) broke. anyOf/oneOf → first
  // alternative; allOf → shallow merge of all alternatives.
  for (const fk of ["anyOf", "oneOf"] as const) {
    const alts = src[fk];
    if (Array.isArray(alts) && alts.length) {
      const first = cleanSchemaForGoogle(alts[0]);
      if (first && typeof first === "object" && !Array.isArray(first)) {
        Object.assign(cleaned, first as Record<string, unknown>);
      }
    }
  }
  if (Array.isArray(src.allOf) && src.allOf.length) {
    for (const alt of src.allOf) {
      const c = cleanSchemaForGoogle(alt);
      if (c && typeof c === "object" && !Array.isArray(c)) {
        const co = c as Record<string, unknown>;
        if (co.properties && cleaned.properties) {
          co.properties = { ...(cleaned.properties as object), ...(co.properties as object) };
        }
        Object.assign(cleaned, co);
      }
    }
  }

  for (const [key, value] of Object.entries(src)) {
    if (key === "anyOf" || key === "oneOf" || key === "allOf") continue;
    // `properties` is a MAP of arbitrary property NAMES → schemas. The
    // keyword allowlist must NOT be applied to those names (doing so deleted
    // every parameter); only each property's own schema gets cleaned.
    if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
      const props: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(value as Record<string, unknown>)) {
        props[propName] = cleanSchemaForGoogle(propSchema);
      }
      cleaned.properties = props;
      continue;
    }
    if (!GOOGLE_ALLOWED_SCHEMA_KEYS.has(key)) {
      continue;
    }
    cleaned[key] = cleanSchemaForGoogle(value);
  }

  // Gemini `type` is a single-valued enum: collapse JSON-Schema union types
  // like ["string","null"] → type "string" + nullable true.
  if (Array.isArray(cleaned.type)) {
    const types = (cleaned.type as unknown[]).filter((t) => t !== "null");
    if (types.length !== (cleaned.type as unknown[]).length) cleaned.nullable = true;
    cleaned.type = types[0] ?? "string";
  }

  if (
    Array.isArray(cleaned.required) &&
    cleaned.properties &&
    typeof cleaned.properties === "object"
  ) {
    const validProps = new Set(
      Object.keys(cleaned.properties as Record<string, unknown>)
    );
    cleaned.required = (cleaned.required as unknown[]).filter(
      (name) => typeof name === "string" && validProps.has(name)
    );
    if ((cleaned.required as unknown[]).length === 0) {
      delete cleaned.required;
    }
  }

  return cleaned;
}

const KNOWN_CLAUDE_TOOLS: Record<string, string> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  bash: "Bash",
  glob: "Glob",
  grep: "Grep",
  todomvc: "TodoMVC",
  websearch: "WebSearch",
  fetch: "Fetch",
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  execute_command: "Bash",
};

function sanitizeGoogleOutputText(text: string): string {
  if (!text) return text;
  if (text.includes("<GenerateWidget")) {
    text = text.replace(/<GenerateWidget[^>]*>([\s\S]*?)<\/GenerateWidget>/gi, (_, inner) => {
      try {
        const parsed = JSON.parse(inner.trim());
        if (parsed.widgetSpec?.prompt) {
          return parsed.widgetSpec.prompt;
        }
      } catch {}
      return "";
    });
    text = text.replace(/<GenerateWidget[^>]*>[\s\S]*/gi, (match) => {
      const jsonStart = match.indexOf("{");
      if (jsonStart !== -1) {
        try {
          const parsed = JSON.parse(match.slice(jsonStart).trim());
          if (parsed.widgetSpec?.prompt) return parsed.widgetSpec.prompt;
        } catch {}
      }
      return "";
    });
  }
  return text;
}

function extractToolNameMap(body?: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(KNOWN_CLAUDE_TOOLS)) {
    map.set(k.toLowerCase(), v);
    map.set(k.toLowerCase().replace(/[_\s-]/g, ""), v);
  }
  if (!body) return map;

  if (Array.isArray(body.tools)) {
    for (const t of body.tools as any[]) {
      const name = t?.function?.name || t?.name;
      if (typeof name === "string" && name.trim()) {
        const exact = name.trim();
        const lower = exact.toLowerCase();
        const normalized = lower.replace(/[_\s-]/g, "");
        map.set(exact, exact);
        map.set(lower, exact);
        map.set(normalized, exact);
      }
    }
  }
  return map;
}

function isDeclaredTool(rawName: string, map: Map<string, string>): boolean {
  if (!rawName) return false;
  const trimmed = rawName.trim();
  const lower = trimmed.toLowerCase();
  const normalized = lower.replace(/[_\s-]/g, "");
  if (trimmed.includes(":") || trimmed.startsWith("image_agent") || trimmed.startsWith("google_search") || trimmed.startsWith("python")) {
    return false;
  }
  return map.has(trimmed) || map.has(lower) || map.has(normalized) || !!KNOWN_CLAUDE_TOOLS[lower];
}

function restoreToolName(rawName: string, map: Map<string, string>): string {
  if (!rawName) return rawName;
  const trimmed = rawName.trim();
  const lower = trimmed.toLowerCase();
  const normalized = lower.replace(/[_\s-]/g, "");
  return map.get(trimmed) || map.get(lower) || map.get(normalized) || KNOWN_CLAUDE_TOOLS[lower] || trimmed;
}

function anthropicToGoogle(
  body: Record<string, unknown>,
  _modelId: string
): Record<string, unknown> {
  const contents: Array<{
    role: string;
    parts: Array<Record<string, unknown>>;
  }> = [];

  const toolNameMap = extractToolNameMap(body);
  const toolUseMap = new Map<string, string>();

  const inMsgs = (body.messages ?? []) as Array<{
    role: string;
    content: string | Array<Record<string, unknown>>;
  }>;

  for (const msg of inMsgs) {
    const role = msg.role === "assistant" ? "model" : "user";
    const parts: Array<Record<string, unknown>> = [];

    if (typeof msg.content === "string") {
      if (msg.content.trim()) {
        parts.push({ text: msg.content });
      }
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (
          block.type === "text" &&
          typeof block.text === "string" &&
          block.text.trim()
        ) {
          parts.push({ text: block.text });
        } else if (block.type === "tool_use") {
          const id = String(block.id ?? "");
          const name = String(block.name ?? "");
          if (id && name) toolUseMap.set(id, name);
          parts.push({
            functionCall: {
              name,
              args:
                block.input && typeof block.input === "object"
                  ? block.input
                  : {},
            },
          });
        } else if (block.type === "tool_result") {
          const toolUseId = String(block.tool_use_id ?? "");
          let name = toolUseMap.get(toolUseId);
          if (!name) {
            const firstDeclared = (body.tools as any[])?.[0]?.name;
            name = firstDeclared || "tool_result";
          }
          name = restoreToolName(name ?? "tool_result", toolNameMap);
          let resultText = "";
          if (typeof block.content === "string") {
            resultText = block.content;
          } else if (Array.isArray(block.content)) {
            resultText = (block.content as Array<Record<string, unknown>>)
              .filter((x) => x.type === "text")
              .map((x) => String(x.text ?? ""))
              .join("\n");
          } else {
            resultText = String(block.content ?? "");
          }
          parts.push({
            functionResponse: {
              name,
              response: { name, output: resultText },
            },
          });
        }
      }
    }

    if (parts.length === 0) continue;

    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push(...parts);
    } else {
      contents.push({ role, parts });
    }
  }

  if (contents.length > 0 && contents[0].role !== "user") {
    contents.unshift({ role: "user", parts: [{ text: "Hello" }] });
  }

  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "Hello" }] });
  }

  const googleBody: Record<string, unknown> = { contents };

  const sys = body.system;
  let sysText =
    typeof sys === "string"
      ? sys
      : Array.isArray(sys)
      ? (sys as Array<{ text?: string }>).map((b) => b.text ?? "").join("\n")
      : "";
  const noWidgetInstruction = "You are an AI assistant. Output standard markdown text or execute tools. Only call tools that have been explicitly provided in the tools/function declarations. Never call undeclared internal tools (such as image_agent, fetch_images, python, or web search). Never output frontend web UI tags like <GenerateWidget>, widgetSpec, or component placeholders.";
  sysText = sysText ? `${sysText}\n\n${noWidgetInstruction}` : noWidgetInstruction;
  googleBody.systemInstruction = { parts: [{ text: sysText }] };

  const tools = body.tools as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(tools) && tools.length) {
    googleBody.tools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description ?? "",
          parameters: cleanSchemaForGoogle(
            t.input_schema ?? { type: "object", properties: {} }
          ),
        })),
      },
    ];
  }

  const generationConfig: Record<string, unknown> = {};
  if (body.max_tokens != null)
    generationConfig.maxOutputTokens = body.max_tokens;
  if (body.temperature != null)
    generationConfig.temperature = body.temperature;
  if (body.top_p != null) generationConfig.topP = body.top_p;
  if (Object.keys(generationConfig).length > 0) {
    googleBody.generationConfig = generationConfig;
  }

  return googleBody;
}

async function translateGoogleResponseToAnthropic(
  upstream: Response,
  wantsStream: boolean,
  modelId: string,
  requestBody?: Record<string, unknown>
): Promise<CoreResponse> {
  if (upstream.status !== 200) {
    const errText = await safeText(upstream);
    let message = errText;
    try {
      const parsed = JSON.parse(errText) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {}
    return formatGatewayError(
      upstream.status,
      message || `Upstream error ${upstream.status}.`,
      true
    );
  }

  if (wantsStream) {
    return translateGoogleStreamToAnthropic(upstream, modelId, requestBody);
  }

  // Google's responses vary by endpoint (v1beta generateContent, the CloudCode
  // internal/companion shapes, alt=sse, etc.), so treat the parsed body as
  // `any` — the code below safely probes many optional shapes (candidates,
  // response.reply/message, result.usageMetadata, …). This mirrors
  // translateGoogleResponseToOpenAI, which does the same.
  let googleResp: any;
  try {
    googleResp = await safeJson(upstream);
  } catch (e) {
    return formatGatewayError(
      502,
      e instanceof Error ? e.message : "Failed to parse upstream response.",
      true
    );
  }

  const toolNameMap = extractToolNameMap(requestBody);
  const candidate = googleResp.response?.candidates?.[0] || googleResp.candidates?.[0] || googleResp.result?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const content: Array<Record<string, unknown>> = [];
  let hasToolCall = false;

  for (const p of parts) {
    if (p.text) {
      const clean = sanitizeGoogleOutputText(p.text);
      if (clean) {
        if ((p as any).thought) {
          content.push({ type: "thinking", thinking: clean });
        } else {
          content.push({ type: "text", text: clean });
        }
      }
    }
    if (p.functionCall?.name && isDeclaredTool(p.functionCall.name, toolNameMap)) {
      hasToolCall = true;
      const exactName = restoreToolName(p.functionCall.name, toolNameMap);
      content.push({
        type: "tool_use",
        id: `toolu_g_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: exactName,
        input: p.functionCall.args ?? {},
      });
    }
  }

  if (content.length === 0) {
    const fallbackText = sanitizeGoogleOutputText(
      googleResp.response?.reply || googleResp.reply || googleResp.response?.message || googleResp.message || ""
    );
    content.push({ type: "text", text: fallbackText || "" });
  }

  const usageMeta = googleResp.response?.usageMetadata || googleResp.usageMetadata || googleResp.result?.usageMetadata;

  return {
    status: 200,
    headers: { "Content-Type": "application/json" },
    jsonBody: {
      id: `msg_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: modelId,
      content,
      stop_reason: hasToolCall ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: usageMeta?.promptTokenCount ?? 0,
        output_tokens: usageMeta?.candidatesTokenCount ?? 0,
      },
    },
  };
}

function translateGoogleStreamToAnthropic(
  upstream: Response,
  modelId: string,
  requestBody?: Record<string, unknown>
): CoreResponse {
  const encoder = new TextEncoder();
  const msgId = `msg_${Date.now()}`;
  const toolNameMap = extractToolNameMap(requestBody);
  const ev = (obj: unknown, name: string) =>
    encoder.encode(`event: ${name}\ndata: ${JSON.stringify(obj)}\n\n`);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let nextIndex = 0;
      let textIndex = -1;
      let textOpen = false;
      let thinkingIndex = -1;
      let thinkingOpen = false;
      let toolCount = 0;

      const closeThinking = () => {
        if (thinkingOpen) {
          controller.enqueue(
            ev({ type: "content_block_stop", index: thinkingIndex }, "content_block_stop")
          );
          thinkingOpen = false;
        }
      };

      // Real usage: CloudCode/Gemini attach usageMetadata only to the FINAL
      // stream chunk — capture it so Claude Code (and the combo logs, via the
      // wire tap) see real token counts instead of hardcoded zeros.
      let usageIn = 0;
      let usageOut = 0;

      const closeText = () => {
        if (textOpen) {
          controller.enqueue(
            ev({ type: "content_block_stop", index: textIndex }, "content_block_stop")
          );
          textOpen = false;
        }
      };

      controller.enqueue(
        ev(
          {
            type: "message_start",
            message: {
              id: msgId,
              type: "message",
              role: "assistant",
              model: modelId,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 },
            },
          },
          "message_start"
        )
      );

      try {
        const reader = upstream.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // 1. Process SSE data: lines if present
          if (buffer.includes("data:")) {
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const chunk = JSON.parse(payload);
                processGoogleChunk(chunk);
              } catch {}
            }
          }

          // 2. Process raw JSON chunks / bracketed objects from CloudCode
          let startIdx = 0;
          while (startIdx < buffer.length) {
            const objStart = buffer.indexOf("{", startIdx);
            if (objStart === -1) break;

            let braceCount = 0;
            let objEnd = -1;
            for (let i = objStart; i < buffer.length; i++) {
              if (buffer[i] === "{") braceCount++;
              if (buffer[i] === "}") {
                braceCount--;
                if (braceCount === 0) {
                  objEnd = i + 1;
                  break;
                }
              }
            }

            if (objEnd !== -1) {
              const chunkText = buffer.substring(objStart, objEnd);
              try {
                const chunk = JSON.parse(chunkText);
                processGoogleChunk(chunk);
              } catch {}
              startIdx = objEnd;
            } else {
              break;
            }
          }
          buffer = buffer.substring(startIdx);
        }

        function processGoogleChunk(chunk: any) {
          // usageMetadata rides on the final Google/CloudCode frame — stash it.
          const um =
            chunk?.response?.usageMetadata ||
            chunk?.usageMetadata ||
            chunk?.result?.usageMetadata;
          if (um) {
            if (um.promptTokenCount) usageIn = um.promptTokenCount;
            if (um.candidatesTokenCount) usageOut = um.candidatesTokenCount;
          }
          const candidate =
            chunk.response?.candidates?.[0] ||
            chunk.candidates?.[0] ||
            chunk.result?.candidates?.[0];

          if (candidate) {
            const parts = candidate?.content?.parts ?? [];
            for (const p of parts) {
              if (p.text) {
                const clean = sanitizeGoogleOutputText(p.text);
                if (!clean) continue;
                if ((p as any).thought) {
                  closeText();
                  if (!thinkingOpen) {
                    thinkingIndex = nextIndex++;
                    thinkingOpen = true;
                    controller.enqueue(
                      ev(
                        {
                          type: "content_block_start",
                          index: thinkingIndex,
                          content_block: { type: "thinking", thinking: "" },
                        },
                        "content_block_start"
                      )
                    );
                  }
                  controller.enqueue(
                    ev(
                      {
                        type: "content_block_delta",
                        index: thinkingIndex,
                        delta: { type: "thinking_delta", thinking: clean },
                      },
                      "content_block_delta"
                    )
                  );
                } else {
                  closeThinking();
                  if (!textOpen) {
                    textIndex = nextIndex++;
                    textOpen = true;
                    controller.enqueue(
                      ev(
                        {
                          type: "content_block_start",
                          index: textIndex,
                          content_block: { type: "text", text: "" },
                        },
                        "content_block_start"
                      )
                    );
                  }
                  controller.enqueue(
                    ev(
                      {
                        type: "content_block_delta",
                        index: textIndex,
                        delta: { type: "text_delta", text: clean },
                      },
                      "content_block_delta"
                    )
                  );
                }
              }
              if (p.functionCall?.name && isDeclaredTool(p.functionCall.name, toolNameMap)) {
                closeThinking();
                closeText();
                const anthIndex = nextIndex++;
                toolCount += 1;
                const exactName = restoreToolName(p.functionCall.name, toolNameMap);
                controller.enqueue(
                  ev(
                    {
                      type: "content_block_start",
                      index: anthIndex,
                      content_block: {
                        type: "tool_use",
                        id: `toolu_g_${msgId}_${anthIndex}`,
                        name: exactName,
                        input: {},
                      },
                    },
                    "content_block_start"
                  )
                );
                controller.enqueue(
                  ev(
                    {
                      type: "content_block_delta",
                      index: anthIndex,
                      delta: {
                        type: "input_json_delta",
                        partial_json: JSON.stringify(p.functionCall.args ?? {}),
                      },
                    },
                    "content_block_delta"
                  )
                );
                controller.enqueue(
                  ev(
                    { type: "content_block_stop", index: anthIndex },
                    "content_block_stop"
                  )
                );
              }
            }
          } else if (
            chunk.response?.reply ||
            chunk.reply ||
            chunk.response?.message ||
            chunk.message
          ) {
            const directText = sanitizeGoogleOutputText(
              chunk.response?.reply ||
                chunk.reply ||
                chunk.response?.message ||
                chunk.message ||
                ""
            );
            if (directText) {
              closeThinking();
              if (!textOpen) {
                textIndex = nextIndex++;
                textOpen = true;
                controller.enqueue(
                  ev(
                    {
                      type: "content_block_start",
                      index: textIndex,
                      content_block: { type: "text", text: "" },
                    },
                    "content_block_start"
                  )
                );
              }
              controller.enqueue(
                ev(
                  {
                    type: "content_block_delta",
                    index: textIndex,
                    delta: { type: "text_delta", text: directText },
                  },
                  "content_block_delta"
                )
              );
            }
          }
        }

        closeThinking();
        closeText();
      } catch {}

      closeText();

      const stopReason = toolCount ? "tool_use" : "end_turn";
      controller.enqueue(
        ev(
          {
            type: "message_delta",
            delta: { stop_reason: stopReason, stop_sequence: null },
            usage: { output_tokens: usageOut, input_tokens: usageIn },
          },
          "message_delta"
        )
      );
      controller.enqueue(ev({ type: "message_stop" }, "message_stop"));
      controller.close();
    },
  });

  return {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
    streamBody: stream,
  };
}

function openAIToGoogle(
  body: Record<string, unknown>,
  _modelId: string
): Record<string, unknown> {
  const contents: Array<{
    role: string;
    parts: Array<Record<string, unknown>>;
  }> = [];

  const inMsgs = (body.messages ?? []) as Array<{
    role: string;
    content: string | Array<Record<string, unknown>>;
  }>;

  let systemInstruction: string | undefined;

  for (const msg of inMsgs) {
    if (msg.role === "system") {
      if (typeof msg.content === "string") {
        systemInstruction = msg.content;
      }
      continue;
    }

    const role = msg.role === "assistant" ? "model" : "user";
    const parts: Array<Record<string, unknown>> = [];

    if (typeof msg.content === "string") {
      if (msg.content.trim()) parts.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
          parts.push({ text: part.text });
        } else if (part.type === "image_url") {
          const url = (part.image_url as { url?: string })?.url || "";
          if (url.startsWith("data:")) {
            const match = url.match(/^data:(.*?);base64,(.*)$/);
            if (match) {
              parts.push({
                inlineData: { mimeType: match[1], data: match[2] },
              });
            }
          }
        }
      }
    }

    // Handle OpenAI assistant tool_calls
    if (msg.role === "assistant" && Array.isArray((msg as any).tool_calls)) {
      for (const tc of (msg as any).tool_calls) {
        let args = {};
        try {
          args = typeof tc.function?.arguments === "string" ? JSON.parse(tc.function.arguments) : (tc.function?.arguments || {});
        } catch {}
        parts.push({
          functionCall: {
            name: tc.function?.name || "",
            args,
          },
        });
      }
    } else if (msg.role === "tool") {
      const name = (msg as any).name || "tool_result";
      const resultText = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");
      parts.push({
        functionResponse: {
          name,
          response: { name, output: resultText },
        },
      });
    }

    if (parts.length === 0) continue;

    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push(...parts);
    } else {
      contents.push({ role, parts });
    }
  }

  if (contents.length > 0 && contents[0].role !== "user") {
    contents.unshift({ role: "user", parts: [{ text: "Hello" }] });
  }
  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "Hello" }] });
  }

  const googleBody: Record<string, unknown> = { contents };
  const noWidgetInstruction = "You are an AI assistant. Output standard markdown text or execute tools. Only call tools that have been explicitly provided in the tools/function declarations. Never call undeclared internal tools (such as image_agent, fetch_images, python, or web search). Never output frontend web UI tags like <GenerateWidget>, widgetSpec, or component placeholders.";
  const finalSys = systemInstruction ? `${systemInstruction}\n\n${noWidgetInstruction}` : noWidgetInstruction;
  googleBody.systemInstruction = { parts: [{ text: finalSys }] };

  if (Array.isArray(body.tools) && body.tools.length > 0) {
    googleBody.tools = [
      {
        functionDeclarations: (body.tools as any[]).map((t) => ({
          name: t.function?.name || t.name,
          description: t.function?.description || t.description || "",
          parameters: cleanSchemaForGoogle(
            t.function?.parameters || t.parameters || { type: "object", properties: {} }
          ),
        })),
      },
    ];
  }

  const generationConfig: Record<string, unknown> = {};
  if (body.temperature !== undefined) generationConfig.temperature = body.temperature;
  if (body.max_tokens != null || body.max_completion_tokens != null) {
    generationConfig.maxOutputTokens = body.max_tokens ?? body.max_completion_tokens;
  }
  if (body.top_p !== undefined) generationConfig.topP = body.top_p;
  if (Object.keys(generationConfig).length > 0) {
    googleBody.generationConfig = generationConfig;
  }

  return googleBody;
}

async function translateGoogleResponseToOpenAI(
  upstream: Response,
  wantsStream: boolean,
  modelId: string,
  requestBody?: Record<string, unknown>
): Promise<CoreResponse> {
  if (upstream.status !== 200) {
    const errText = await safeText(upstream);
    let message = errText;
    try {
      const parsed = JSON.parse(errText) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {}
    return formatGatewayError(
      upstream.status,
      message || `Upstream error ${upstream.status}.`,
      false
    );
  }

  if (wantsStream) {
    return translateGoogleStreamToOpenAI(upstream, modelId, requestBody);
  }

  let googleResp: any;
  try {
    googleResp = await safeJson(upstream);
  } catch (e) {
    return formatGatewayError(
      502,
      e instanceof Error ? e.message : "Failed to parse upstream response.",
      false
    );
  }
  const candidate = googleResp.response?.candidates?.[0] || googleResp.candidates?.[0] || googleResp.result?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const textParts: string[] = [];
  const reasoningParts: string[] = [];
  const toolCalls: any[] = [];
  const toolNameMap = extractToolNameMap(requestBody);

  for (const p of parts) {
    if (p.text) {
      const clean = sanitizeGoogleOutputText(p.text);
      if (clean) {
        if ((p as any).thought) {
          reasoningParts.push(clean);
        } else {
          textParts.push(clean);
        }
      }
    }
    if (p.functionCall?.name && isDeclaredTool(p.functionCall.name, toolNameMap)) {
      const exactName = restoreToolName(p.functionCall.name, toolNameMap);
      toolCalls.push({
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: "function",
        function: {
          name: exactName,
          arguments: JSON.stringify(p.functionCall.args || {}),
        },
      });
    }
  }

  let text = textParts.join("");
  const reasoningText = reasoningParts.join("");
  if (!text && !toolCalls.length) {
    if (typeof candidate?.message?.content === "string") text = sanitizeGoogleOutputText(candidate.message.content);
    else if (typeof googleResp.response?.reply === "string") text = sanitizeGoogleOutputText(googleResp.response.reply);
    else if (typeof googleResp.reply === "string") text = sanitizeGoogleOutputText(googleResp.reply);
    else if (typeof googleResp.response?.message === "string") text = sanitizeGoogleOutputText(googleResp.response.message);
    else if (typeof googleResp.message === "string") text = sanitizeGoogleOutputText(googleResp.message);
    else if (typeof googleResp.response === "string") text = sanitizeGoogleOutputText(googleResp.response);
  }

  const messageObj: Record<string, unknown> = {
    role: "assistant",
    content: text || (toolCalls.length ? null : ""),
  };
  if (reasoningText) {
    messageObj.reasoning_content = reasoningText;
  }
  if (toolCalls.length) {
    messageObj.tool_calls = toolCalls;
  }

  const usageMeta = googleResp.response?.usageMetadata || googleResp.usageMetadata || googleResp.result?.usageMetadata;

  return {
    status: 200,
    headers: { "Content-Type": "application/json" },
    jsonBody: {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [
        {
          index: 0,
          message: messageObj,
          finish_reason: toolCalls.length
            ? "tool_calls"
            : candidate?.finishReason?.toLowerCase() || "stop",
        },
      ],
      usage: {
        prompt_tokens: usageMeta?.promptTokenCount ?? 0,
        completion_tokens: usageMeta?.candidatesTokenCount ?? 0,
        total_tokens: usageMeta?.totalTokenCount ?? 0,
      },
    },
  };
}

function translateGoogleStreamToOpenAI(
  upstream: Response,
  modelId: string,
  requestBody?: Record<string, unknown>
): CoreResponse {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const chatId = `chatcmpl-${Date.now()}`;
  const toolNameMap = extractToolNameMap(requestBody);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const reader = upstream.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        let buffer = "";
        let toolIndex = 0;
        // Stream-wide flags: Gemini delivers finishReason in a separate final
        // chunk with EMPTY parts (the functionCall came in an earlier chunk),
        // so per-chunk tool detection would emit finish_reason "stop" after a
        // tool call — making agent clients (Cline, OpenCode, etc.) end their
        // tool loop after a single step instead of continuing.
        let sawToolCall = false;
        let roleSent = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let startIdx = 0;
          while (startIdx < buffer.length) {
            const objStart = buffer.indexOf("{", startIdx);
            if (objStart === -1) break;

            let braceCount = 0;
            let objEnd = -1;
            for (let i = objStart; i < buffer.length; i++) {
              if (buffer[i] === "{") braceCount++;
              if (buffer[i] === "}") {
                braceCount--;
                if (braceCount === 0) {
                  objEnd = i + 1;
                  break;
                }
              }
            }

            if (objEnd !== -1) {
              const chunk = buffer.substring(objStart, objEnd);
              try {
                const googleChunk = JSON.parse(chunk);
                const candidate = (googleChunk as any).response?.candidates?.[0] || googleChunk.candidates?.[0] || (googleChunk as any).result?.candidates?.[0];
                if (candidate) {
                  const parts = candidate?.content?.parts || [];
                  for (const p of parts) {
                    if (p.text) {
                      const cleanText = sanitizeGoogleOutputText(p.text);
                      if (cleanText) {
                        const delta: Record<string, unknown> = (p as any).thought
                          ? { reasoning_content: cleanText }
                          : { content: cleanText };
                        if (!roleSent) {
                          delta.role = "assistant";
                          roleSent = true;
                        }
                        controller.enqueue(
                          encoder.encode(
                            `data: ${JSON.stringify({
                              id: chatId,
                              object: "chat.completion.chunk",
                              created: Math.floor(Date.now() / 1000),
                              model: modelId,
                              choices: [
                                { index: 0, delta, finish_reason: null },
                              ],
                            })}\n\n`
                          )
                        );
                      }
                    }
                  }
                  for (const p of parts) {
                    if (p.functionCall?.name && isDeclaredTool(p.functionCall.name, toolNameMap)) {
                      const exactName = restoreToolName(p.functionCall.name, toolNameMap);
                      sawToolCall = true;
                      const delta: Record<string, unknown> = {
                        tool_calls: [
                          {
                            index: toolIndex++,
                            id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                            type: "function",
                            function: {
                              name: exactName,
                              arguments: JSON.stringify(p.functionCall.args || {}),
                            },
                          },
                        ],
                      };
                      if (!roleSent) {
                        delta.role = "assistant";
                        roleSent = true;
                      }
                      controller.enqueue(
                        encoder.encode(
                          `data: ${JSON.stringify({
                            id: chatId,
                            object: "chat.completion.chunk",
                            created: Math.floor(Date.now() / 1000),
                            model: modelId,
                            choices: [
                              {
                                index: 0,
                                delta,
                                finish_reason: null,
                              },
                            ],
                          })}\n\n`
                        )
                      );
                    }
                  }
                  if (candidate?.finishReason) {
                    // Whole-stream flag (see sawToolCall above): finishReason
                    // arrives in a later, tool-less chunk, so `parts` here
                    // almost never contains the functionCall.
                    const hasTool = sawToolCall || parts.some((p: any) => p.functionCall);
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({
                          id: chatId,
                          object: "chat.completion.chunk",
                          created: Math.floor(Date.now() / 1000),
                          model: modelId,
                          choices: [
                            {
                              index: 0,
                              delta: {},
                              finish_reason: hasTool ? "tool_calls" : candidate.finishReason.toLowerCase(),
                            },
                          ],
                        })}\n\n`
                      )
                    );
                  }
                } else if ((googleChunk as any).response?.reply || googleChunk.reply || (googleChunk as any).response?.message || googleChunk.message) {
                  const directText = sanitizeGoogleOutputText((googleChunk as any).response?.reply || googleChunk.reply || (googleChunk as any).response?.message || googleChunk.message || "");
                  if (directText) {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({
                          id: chatId,
                          object: "chat.completion.chunk",
                          created: Math.floor(Date.now() / 1000),
                          model: modelId,
                          choices: [{ index: 0, delta: { content: directText }, finish_reason: null }],
                        })}\n\n`
                      )
                    );
                  }
                }

                const usageMeta = (googleChunk as any).response?.usageMetadata || googleChunk.usageMetadata || (googleChunk as any).result?.usageMetadata;
                if (usageMeta) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({
                        id: chatId,
                        object: "chat.completion.chunk",
                        created: Math.floor(Date.now() / 1000),
                        model: modelId,
                        choices: [],
                        usage: {
                          prompt_tokens: usageMeta.promptTokenCount || 0,
                          completion_tokens: usageMeta.candidatesTokenCount || 0,
                          total_tokens: usageMeta.totalTokenCount || 0,
                        },
                      })}\n\n`
                    )
                  );
                }
              } catch {}
              startIdx = objEnd;
            } else {
              break;
            }
          }
          buffer = buffer.substring(startIdx);
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        try {
          controller.error(err);
        } catch {}
      }
    },
  });

  return {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
    streamBody: stream,
  };
}

async function translateResponseToAnthropic(
  upstream: Response,
  wantsStream: boolean,
  modelId: string
): Promise<CoreResponse> {
  if (upstream.status !== 200) {
    const errText = await safeText(upstream);
    let message = errText;
    try {
      const parsed = JSON.parse(errText) as {
        error?: { message?: string } | string;
      };
      if (typeof parsed.error === "string") message = parsed.error;
      else if (parsed.error?.message) message = parsed.error.message;
    } catch {}
    return formatGatewayError(
      upstream.status,
      message || `Upstream error ${upstream.status}.`,
      true
    );
  }

  if (wantsStream) {
    return translateStreamToAnthropic(upstream, modelId);
  }

  let openai: {
    choices?: Array<{
      message?: {
        role?: string;
        content?: string;
        tool_calls?: Array<{
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
      finish_reason?: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    openai = await safeJson(upstream);
  } catch (e) {
    return formatGatewayError(
      502,
      e instanceof Error ? e.message : "Failed to parse upstream response.",
      true
    );
  }

  const choice = openai.choices?.[0];
  const text = choice?.message?.content ?? "";
  const toolCalls = choice?.message?.tool_calls ?? [];

  const content: Array<Record<string, unknown>> = [];
  if (text) content.push({ type: "text", text });
  for (const tc of toolCalls) {
    let input: unknown = {};
    try {
      input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch {
      input = {};
    }
    content.push({
      type: "tool_use",
      id: tc.id ?? `toolu_${Date.now()}`,
      name: tc.function?.name ?? "",
      input,
    });
  }
  if (content.length === 0) content.push({ type: "text", text: "" });

  let stopReason: string;
  if (toolCalls.length) stopReason = "tool_use";
  else if (choice?.finish_reason === "length") stopReason = "max_tokens";
  else stopReason = "end_turn";

  const anthropicBody = {
    id: `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: modelId,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: openai.usage?.prompt_tokens ?? 0,
      output_tokens: openai.usage?.completion_tokens ?? 0,
    },
  };

  return {
    status: 200,
    headers: { "Content-Type": "application/json" },
    jsonBody: anthropicBody,
  };
}

// Translate an Anthropic Messages response into an OpenAI /chat/completions
// response. The inverse of openAIToAnthropic â€” used when a caller that speaks
// OpenAI (Claude Desktop, SDKs, combos) is served by an Anthropic provider.
async function translateAnthropicResponseToOpenAI(
  upstream: Response,
  wantsStream: boolean,
  modelId: string
): Promise<CoreResponse> {
  if (upstream.status !== 200) {
    const errText = await safeText(upstream);
    let message = errText;
    try {
      const parsed = JSON.parse(errText) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {}
    return formatGatewayError(
      upstream.status,
      message || `Upstream error ${upstream.status}.`,
      false
    );
  }

  if (wantsStream) {
    return translateAnthropicStreamToOpenAI(upstream, modelId);
  }

  let anth: {
    content?: Array<{
      type: string;
      id?: string;
      text?: string;
      name?: string;
      input?: unknown;
    }>;
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  try {
    anth = await safeJson(upstream);
  } catch (e) {
    return formatGatewayError(
      502,
      e instanceof Error ? e.message : "Failed to parse upstream response.",
      false
    );
  }

  const text = (anth.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text ?? "")
    .join("");
  const toolUses = (anth.content ?? []).filter((b) => b.type === "tool_use");

  const message: Record<string, unknown> = { role: "assistant", content: text };
  if (toolUses.length) {
    message.tool_calls = toolUses.map((t) => ({
      id: t.id ?? `call_${Date.now()}`,
      type: "function",
      function: {
        name: t.name ?? "",
        arguments: JSON.stringify(t.input ?? {}),
      },
    }));
  }

  let finishReason: string;
  switch (anth.stop_reason) {
    case "tool_use":
      finishReason = "tool_calls";
      break;
    case "max_tokens":
      finishReason = "length";
      break;
    default:
      finishReason = "stop";
  }

  return {
    status: 200,
    headers: { "Content-Type": "application/json" },
    jsonBody: {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [
        {
          index: 0,
          message,
          finish_reason: finishReason,
        },
      ],
      usage: {
        prompt_tokens: anth.usage?.input_tokens ?? 0,
        completion_tokens: anth.usage?.output_tokens ?? 0,
        total_tokens:
          (anth.usage?.input_tokens ?? 0) + (anth.usage?.output_tokens ?? 0),
      },
    },
  };
}

// SSE bridge: Anthropic event stream â†’ OpenAI chat.completion.chunk stream.
// Consumes the upstream Anthropic stream and re-emits OpenAI chunks so an
// OpenAI-shaped client (Claude Desktop app chat, combos) parses it natively.
function translateAnthropicStreamToOpenAI(
  upstream: Response,
  modelId: string
): CoreResponse {
  const encoder = new TextEncoder();
  const chatId = `chatcmpl-${Date.now()}`;
  const sse = (obj: unknown) =>
    encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const reader = upstream.body?.getReader();
        if (!reader) {
          controller.enqueue(sse({ id: chatId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: modelId, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }
        const decoder = new TextDecoder();
        let buffer = "";
        let textOpen = false;
        let stopReason = "stop";
        let usageIn = 0;
        let usageOut = 0;

        const closeText = () => {
          if (textOpen) {
            controller.enqueue(
              sse({
                id: chatId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: modelId,
                choices: [{ index: 0, delta: {}, finish_reason: null }],
              })
            );
            textOpen = false;
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let evt: {
              type?: string;
              delta?: { type?: string; text?: string; stop_reason?: string };
              message?: {
                usage?: { input_tokens?: number; output_tokens?: number };
              };
              usage?: { output_tokens?: number };
            };
            try {
              evt = JSON.parse(payload);
            } catch {
              continue;
            }
            if (evt.type === "content_block_delta" && evt.delta?.text) {
              if (!textOpen) {
                textOpen = true;
                controller.enqueue(
                  sse({
                    id: chatId,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: modelId,
                    choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
                  })
                );
              }
              controller.enqueue(
                sse({
                  id: chatId,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: modelId,
                  choices: [{ index: 0, delta: { content: evt.delta.text }, finish_reason: null }],
                })
              );
            } else if (evt.type === "message_delta") {
              // Carry the Anthropic stop reason + output usage forward.
              if (evt.delta?.stop_reason) {
                stopReason =
                  evt.delta.stop_reason === "tool_use"
                    ? "tool_calls"
                    : evt.delta.stop_reason === "max_tokens"
                    ? "length"
                    : "stop";
              }
              usageOut = evt.usage?.output_tokens ?? usageOut;
            } else if (evt.type === "message_start") {
              usageIn = evt.message?.usage?.input_tokens ?? usageIn;
            } else if (evt.type === "message_stop") {
              closeText();
            }
          }
        }

        // Final chunk + usage.
        controller.enqueue(
          sse({
            id: chatId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: modelId,
            choices: [],
            usage: {
              prompt_tokens: usageIn,
              completion_tokens: usageOut,
              total_tokens: usageIn + usageOut,
            },
          })
        );
        controller.enqueue(sse({ id: chatId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: modelId, choices: [{ index: 0, delta: {}, finish_reason: stopReason }] }));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch {
        try {
          controller.enqueue(sse({ id: chatId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: modelId, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch {}
      }
    },
  });

  return {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
    streamBody: stream,
  };
}

function translateStreamToAnthropic(
  upstream: Response,
  modelId: string
): CoreResponse {
  const encoder = new TextEncoder();
  const msgId = `msg_${Date.now()}`;
  const ev = (obj: unknown, name: string) =>
    encoder.encode(`event: ${name}\ndata: ${JSON.stringify(obj)}\n\n`);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let nextIndex = 0;
      let textIndex = -1;
      let textOpen = false;
      const toolBlocks = new Map<number, { anthIndex: number }>();
      let finishReason: string | null = null;
      let closed = false;

      const closeText = () => {
        if (textOpen) {
          controller.enqueue(
            ev({ type: "content_block_stop", index: textIndex }, "content_block_stop")
          );
          textOpen = false;
        }
      };

      controller.enqueue(
        ev(
          {
            type: "message_start",
            message: {
              id: msgId,
              type: "message",
              role: "assistant",
              model: modelId,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 },
            },
          },
          "message_start"
        )
      );

      try {
        const reader = upstream.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              let chunk: {
                choices?: Array<{
                  delta?: {
                    content?: string;
                    tool_calls?: Array<{
                      index?: number;
                      id?: string;
                      function?: { name?: string; arguments?: string };
                    }>;
                  };
                  text?: string;
                  finish_reason?: string | null;
                }>;
              };
              try {
                chunk = JSON.parse(payload);
              } catch {
                continue;
              }
              const choice = chunk.choices?.[0];
              if (!choice) continue;
              if (choice.finish_reason) finishReason = choice.finish_reason;

              const td = choice.delta?.content ?? choice.text;
              if (td) {
                if (!textOpen) {
                  textIndex = nextIndex++;
                  textOpen = true;
                  controller.enqueue(
                    ev(
                      {
                        type: "content_block_start",
                        index: textIndex,
                        content_block: { type: "text", text: "" },
                      },
                      "content_block_start"
                    )
                  );
                }
                controller.enqueue(
                  ev(
                    {
                      type: "content_block_delta",
                      index: textIndex,
                      delta: { type: "text_delta", text: td },
                    },
                    "content_block_delta"
                  )
                );
              }

              for (const tc of choice.delta?.tool_calls ?? []) {
                const k = tc.index ?? 0;
                let block = toolBlocks.get(k);
                if (!block) {
                  closeText();
                  block = { anthIndex: nextIndex++ };
                  toolBlocks.set(k, block);
                  controller.enqueue(
                    ev(
                      {
                        type: "content_block_start",
                        index: block.anthIndex,
                        content_block: {
                          type: "tool_use",
                          id: tc.id || `toolu_${msgId}_${k}`,
                          name: tc.function?.name ?? "",
                          input: {},
                        },
                      },
                      "content_block_start"
                    )
                  );
                }
                if (tc.function?.arguments) {
                  controller.enqueue(
                    ev(
                      {
                        type: "content_block_delta",
                        index: block.anthIndex,
                        delta: {
                          type: "input_json_delta",
                          partial_json: tc.function.arguments,
                        },
                      },
                      "content_block_delta"
                    )
                  );
                }
              }
            }
          }
        }
      } catch {}

      closeText();
      for (const { anthIndex } of Array.from(toolBlocks.values()).sort(
        (a, b) => a.anthIndex - b.anthIndex
      )) {
        controller.enqueue(
          ev({ type: "content_block_stop", index: anthIndex }, "content_block_stop")
        );
      }

      const stopReason = toolBlocks.size
        ? "tool_use"
        : finishReason === "length"
        ? "max_tokens"
        : "end_turn";
      controller.enqueue(
        ev(
          {
            type: "message_delta",
            delta: { stop_reason: stopReason, stop_sequence: null },
            usage: { output_tokens: 0 },
          },
          "message_delta"
        )
      );
      controller.enqueue(ev({ type: "message_stop" }, "message_stop"));
      if (!closed) {
        controller.close();
        closed = true;
      }
    },
  });

  return {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
    streamBody: stream,
  };
}

function formatGatewayError(
  status: number,
  message: string,
  isAnthropic: boolean
): CoreResponse {
  const code = status === 404 ? 400 : status;
  let cleanMsg = message;
  if (
    cleanMsg.includes("404 page not found") ||
    cleanMsg.includes("404 Not Found")
  ) {
    cleanMsg = `Upstream API returned 404 Page Not Found. Check provider Base URL (ensure /v1 is included) and model ID in AI Provider Hub. Details: ${message}`;
  } else if (/<\/?[a-z][\s\S]*>/i.test(cleanMsg)) {
    // Never surface raw HTML from an upstream error body.
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(cleanMsg);
    cleanMsg = title?.[1]?.trim()
      ? `Upstream returned an HTML page (${title[1].trim()}). Check the provider Base URL (include /v1).`
      : "Upstream returned an HTML page instead of an API response. Check the provider Base URL (include /v1).";
  }
  if (isAnthropic) {
    return jsonResponse(code, {
      type: "error",
      error: {
        type:
          status === 401 ? "authentication_error" : "invalid_request_error",
        message: cleanMsg,
      },
    });
  }
  return jsonResponse(code, {
    error: { message: cleanMsg, type: "invalid_request_error" },
  });
}

function displayModelId(modelId: string): string {
  const id = (modelId ?? "").trim();
  if (!id) return id;
  const slash = id.indexOf("/");
  const bare = slash > 0 && id.startsWith("aip/") ? id.slice(slash + 1) : id;
  return bare;
}

function matchEndpoint(path: string): string | null {
  const p = path.replace(/^v1\//, "").replace(/\/$/, "");
  if (p === "chat/completions") return "/chat/completions";
  if (p === "completions") return "/completions";
  if (p === "embeddings") return "/embeddings";
  if (p === "messages") return "/messages";
  return null;
}

function relay(upstream: Response, _wantsStream: boolean, isAnthropic = false): CoreResponse {
  const headers: Record<string, string> = {};
  upstream.headers.forEach((v, k) => {
    const lk = k.toLowerCase();
    if (HOP_BY_HOP.has(lk)) return;
    if (lk === "content-encoding" || lk === "content-length") return;
    headers[k] = v;
  });
  // An upstream HTML response means we hit a web page, not an API
  if ((headers["content-type"] ?? "").toLowerCase().includes("text/html")) {
    return formatGatewayError(
      502,
      `Upstream returned an HTML page instead of an API response (${upstream.status}). Check the provider Base URL (include /v1) and that it's an API endpoint, not a website.`,
      isAnthropic
    );
  }
  return {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
    streamBody: upstream.body,
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 500);
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

/**
 * Heuristic: does this body look like HTML rather than JSON/SSE? Used to catch
 * HTML pages that come back with a mislabeled or missing content-type header
 * (WAFs, captive portals, misconfigured proxies), so the gateway never relays
 * raw HTML to a client whose JSON parser would then throw "Unexpected token <".
 */
function isHtmlLike(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return /^</.test(t) || /<!doctype html/i.test(t) || /<html[\s>]/i.test(t);
}

/** Safely parse upstream JSON response. Throws a clear error if the body is HTML. */
async function safeJson<T>(upstream: Response): Promise<T> {
  const ct = (upstream.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("text/html")) {
    throw new Error(
      `Upstream returned an HTML page (Error ${upstream.status}). Check the provider Base URL (include /v1).`
    );
  }
  const text = await upstream.text();
  if (!text || text.trim().startsWith("<")) {
    throw new Error(
      `Upstream returned non-JSON (${upstream.status}): ${text.slice(0, 100)}`
    );
  }
  return JSON.parse(text) as T;
}

async function recordUsage(
  uid: string,
  providerId: string,
  modelId: string,
  nowMs: number
): Promise<void> {
  const KEY = "gatewayUsage";
  const list = await readKV<
    Array<{ providerId: string; modelId: string; at: number }>
  >(uid, KEY, []);
  list.push({ providerId, modelId, at: nowMs });
  const trimmed = list.slice(-500);
  await writeKV(uid, KEY, trimmed, nowMs);
}

async function recordComboLog(
  uid: string,
  entry: {
    id: string;
    comboId: string;
    comboName: string;
    respondingModelId: string;
    respondingProviderId: string;
    respondingModelName?: string;
    attempts: Array<{
      providerId: string;
      modelId: string;
      displayName?: string;
      status: "success" | "failed";
      error?: string;
      durationMs?: number;
    }>;
    tokensIn: number;
    tokensOut: number;
    durationMs: number;
    createdAt: number;
  }
): Promise<void> {
  const KEY = "combo_logs";
  const list = await readKV<any[]>(uid, KEY, []);
  const nextList = [entry, ...list].slice(0, 1000);
  await writeKV(uid, KEY, nextList, entry.createdAt);
}

/**
 * Patch an already-recorded combo log with REAL token usage + true end-to-end
 * duration once the upstream response actually finishes. The initial entry is
 * written with zeros so the Logs UI shows the attempt immediately (it polls
 * every few seconds); this fills in the real numbers right after.
 */
async function updateComboLog(
  uid: string,
  id: string,
  patch: { tokensIn?: number; tokensOut?: number; durationMs?: number }
): Promise<void> {
  const KEY = "combo_logs";
  const list = await readKV<any[]>(uid, KEY, []);
  const idx = list.findIndex((e) => e && e.id === id);
  if (idx === -1) return;
  list[idx] = { ...list[idx], ...patch };
  await writeKV(uid, KEY, list, Date.now());
}

/** Last non-zero regex capture in `s` (message_start reports 0s; the real
 * numbers arrive in later frames). */
/** Last non-zero capture-group-1 of `re` in `s`: message_start reports 0s,
 * the real numbers arrive in later frames — keep the LAST non-zero hit. */
function lastNonZeroMatch(re: RegExp, s: string): number {
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(s))) {
    const v = parseInt(m[1], 10);
    if (v > 0) last = v;
  }
  return last;
}

// NOTE: these MUST stay regex literals — building them from strings silently
// mangles "\s"/"\d" into "s"/"d" (JS drops unknown string escapes) and the
// patterns would quietly never match.
function extractStreamUsage(text: string): { tin: number; tout: number } {
  return {
    tin:
      lastNonZeroMatch(/"input_tokens"\s*:\s*(\d+)/g, text) ||
      lastNonZeroMatch(/"prompt_tokens"\s*:\s*(\d+)/g, text) ||
      lastNonZeroMatch(/"promptTokenCount"\s*:\s*(\d+)/g, text),
    tout:
      lastNonZeroMatch(/"output_tokens"\s*:\s*(\d+)/g, text) ||
      lastNonZeroMatch(/"completion_tokens"\s*:\s*(\d+)/g, text) ||
      lastNonZeroMatch(/"candidatesTokenCount"\s*:\s*(\d+)/g, text),
  };
}

function extractJsonUsage(obj: any): { tin: number; tout: number } {
  const u = obj?.usage ?? {};
  const gm =
    obj?.response?.usageMetadata ??
    obj?.usageMetadata ??
    obj?.result?.usageMetadata ??
    {};
  return {
    tin: u.input_tokens ?? u.prompt_tokens ?? gm.promptTokenCount ?? 0,
    tout: u.output_tokens ?? u.completion_tokens ?? gm.candidatesTokenCount ?? 0,
  };
}

/**
 * Pass-through wrapper around the outgoing gateway response: observes bytes
 * flowing to the client and, when the stream completes (or a JSON body is
 * known), patches the combo log entry created at response start with the real
 * usage + wall-clock duration. Zero overhead for non-combo requests.
 */
function tapComboLogUsage(
  res: any,
  opts: { uid: string; logId: string; startedAt: number; requestBytes: number }
): any {
  let finished = false;
  const persist = (tinRaw: number, toutRaw: number, outBytes: number) => {
    if (finished) return;
    finished = true;
    let tin = Math.trunc(tinRaw) || 0;
    let tout = Math.trunc(toutRaw) || 0;
    if (!tout && outBytes > 0) tout = Math.ceil(outBytes / 4); // ~4 bytes/token
    if (!tin) tin = Math.ceil(opts.requestBytes / 4); // prompt-size estimate
    void updateComboLog(opts.uid, opts.logId, {
      tokensIn: tin,
      tokensOut: tout,
      durationMs: Date.now() - opts.startedAt,
    }).catch(() => {});
  };

  if (!res) return res;
  if (res.jsonBody !== undefined) {
    const { tin, tout } = extractJsonUsage(res.jsonBody);
    persist(tin, tout, 0);
    return res;
  }
  if (typeof res.streamBody?.getReader !== "function") return res;

  const reader = res.streamBody.getReader();
  const dec = new TextDecoder();
  let head = "";
  let tail = "";
  let outBytes = 0;

  const wrapped = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          const { tin, tout } = extractStreamUsage(head + tail);
          persist(tin, tout, outBytes);
          controller.close();
          return;
        }
        outBytes += value?.byteLength ?? 0;
        const text = dec.decode(value, { stream: true });
        // Anthropic/OpenAI usage frames sit at the very START (message_start)
        // and the very END (message_delta / final OpenAI usage chunk) of the
        // stream — a 8KB head + 16KB tail window captures both without
        // buffering the entire response in memory.
        if (head.length < 4096) head = (head + text).slice(0, 8192);
        else tail = (tail + text).slice(-16384);
        controller.enqueue(value);
      } catch {
        try { controller.close(); } catch {}
      }
    },
    cancel() {
      const { tin, tout } = extractStreamUsage(head + tail);
      persist(tin, tout, outBytes);
      void reader.cancel().catch(() => {});
    },
  });
  return { ...res, streamBody: wrapped };
}

/**
 * fetch() wrapper that bounds only the time-to-first-byte (response headers).
 * The abort timer is cleared the moment headers arrive, so long SSE streams
 * and slow buffered generations keep flowing — but an upstream that never
 * starts responding is abandoned after `ttfbMs`, letting the fallback loop
 * move on to the next candidate URL / key / combo member.
 */
async function fetchUpstream(
  url: string,
  init: RequestInit,
  ttfbMs: number
): Promise<Response> {
  if (!Number.isFinite(ttfbMs) || ttfbMs <= 0) return fetch(url, init);

  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort(
      new Error(
        `Upstream did not start responding within ${ttfbMs}ms (GATEWAY_UPSTREAM_TTFB_MS). Trying next option.`
      )
    );
  }, ttfbMs);
  if (typeof timer.unref === "function") timer.unref();

  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    // Headers received — stop the clock so the response body can take as
    // long as the model needs (non-stream 15s+ generations stay intact).
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/** Serialize the collected phase timings into a Server-Timing header value. */
function formatServerTiming(entries: GwTiming[]): string {
  return entries
    .map((e) => {
      const dur = Math.max(0, e.dur).toFixed(1);
      const desc = e.desc
        ? `;desc="${e.desc.replace(/[^a-zA-Z0-9_./+-]/g, "")}"`
        : "";
      return `${e.name};dur=${dur}${desc}`;
    })
    .join(", ");
}

/**
 * Exchange a Google OAuth refresh token for a fresh access token.
 * Returns null on any failure (caller keeps the old token; the upstream 401
 * response will then carry the provider's real error message to the client).
 */
async function refreshGoogleOAuthToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresInSec: number } | null> {
  const cfg = OAUTH_PROVIDERS.antigravity;
  if (!cfg?.tokenUrl || !cfg.clientId) return null;
  try {
    const res = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: cfg.clientId,
        ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}),
        refresh_token: refreshToken,
      }),
    });
    const data = (await res.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    } | null;
    if (!res.ok || !data?.access_token) {
      console.warn(
        `[gateway] OAuth token refresh failed (${res.status}): ${data?.error ?? "no access_token"}`
      );
      return null;
    }
    return {
      accessToken: data.access_token,
      expiresInSec: Number(data.expires_in) || 3600,
    };
  } catch (err) {
    console.warn("[gateway] OAuth token refresh error:", err);
    return null;
  }
}

/**
 * Scan the loaded providers for Google OAuth tokens past their expiry and
 * refresh them in-place; persist the providers KV doc if anything changed.
 * Runs before routing so every attempt/route picks up the fresh token.
 */
async function refreshExpiredOAuthTokens(
  providers: GwProvider[],
  ownerUid: string
): Promise<void> {
  let changed = false;

  for (const p of providers) {
    if (!p || p.authMode !== "oauth") continue;
    const isGoogleOAuth =
      p.key === "google" ||
      p.key === "antigravity" ||
      (p.baseURL ?? "").includes("googleapis.com");
    if (!isGoogleOAuth) continue;
    if (!p.refreshToken || !p.tokenExpiry) continue;

    // Older UIs may have stored epoch SECONDS — normalize to ms.
    let expiryMs = Number(p.tokenExpiry);
    if (Number.isFinite(expiryMs) && expiryMs > 0 && expiryMs < 1e12) {
      expiryMs *= 1000;
    }
    // Not expired (60s safety margin) → leave alone.
    if (!Number.isFinite(expiryMs) || Date.now() < expiryMs - 60_000) continue;

    const usedToken = providerKeys(p)[0] || p.apiKey || "";
    const fresh = await refreshGoogleOAuthToken(p.refreshToken);
    if (!fresh) continue;

    p.apiKey = fresh.accessToken;
    p.tokenExpiry = Date.now() + fresh.expiresInSec * 1000;
    if (Array.isArray(p.apiKeys)) {
      p.apiKeys = p.apiKeys.map((k) => (k === usedToken ? fresh.accessToken : k));
    }
    changed = true;
    console.log(
      `[gateway] refreshed expired OAuth access token for provider "${p.displayName ?? p.id ?? p.key}"`
    );
  }

  if (changed) {
    // Persist so later requests and other readers see the fresh token.
    void writeKV(ownerUid, "providers", providers, Date.now()).catch(() => {});
  }
}
