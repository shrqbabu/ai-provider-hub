// Gateway core — the OpenAI-compatible endpoint the user hits with their own
// "ah-…" key from anywhere. Flow:
//   1. Authenticate the ah- key → uid.
//   2. Load the user's providers + models from Firestore.
//   3. Resolve which provider serves the requested model (auto-detect).
//   4. Try that provider's keys in order (fallback on 401/403/429/5xx/network).
//   5. Stream the upstream response straight back (SSE passes through unchanged).
//
// Supported sub-paths (OpenAI-compatible):
//   POST chat/completions   → provider /chat/completions
//   POST completions        → provider /completions
//   POST embeddings         → provider /embeddings
//   POST messages           → provider /messages (Anthropic-native)
//   GET  models             → aggregate of the user's saved models + combos
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
import { bearerToken } from "./auth.js";
import { jsonResponse, type CoreRequest, type CoreResponse } from "./http.js";

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

// Status codes worth retrying with the next key. 401/403 → this key is bad;
// 429 → this key is rate-limited; 5xx → upstream hiccup, another key/region
// may succeed.
function shouldFallback(status: number): boolean {
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

export async function handleGateway(
  req: CoreRequest,
  nowMs: number
): Promise<CoreResponse> {
  // ── 1. Auth ────────────────────────────────────────────────────────────
  const raw = bearerToken(req);
  if (!raw) {
    return jsonResponse(401, {
      error: { message: "Missing API key. Send `Authorization: Bearer ah-…`.", type: "auth" },
    });
  }
  const uid = await resolveApiKey(raw);
  if (!uid) {
    return jsonResponse(401, {
      error: { message: "Invalid or revoked API key.", type: "auth" },
    });
  }

  const path = req.subPath.replace(/^\/+/, "").toLowerCase();

  // ── Load the user's connected providers + models + combos ───────────────
  const [providers, models, combos] = await Promise.all([
    readKV<GwProvider[]>(uid, "providers", []),
    readKV<GwModel[]>(uid, "models", []),
    readKV<GwCombo[]>(uid, "combos", []),
  ]);

  // ── GET models: return the user's saved models + combos in list shape ────
  if (path === "models" || path === "v1/models") {
    return jsonResponse(200, {
      object: "list",
      data: [
        ...models.map((m) => ({
          id: displayModelId(m.modelId),
          object: "model",
          owned_by: m.providerKey,
        })),
        ...combos
          .filter((c) => (c.name ?? "").trim())
          .map((c) => ({
            id: c.name,
            object: "model",
            owned_by: "combo",
          })),
      ],
    });
  }

  // ── POST inference endpoints ─────────────────────────────────────────────
  const endpoint = matchEndpoint(path);
  if (!endpoint) {
    return jsonResponse(404, {
      error: { message: `Unsupported gateway path "/${path}".`, type: "invalid_request" },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json<Record<string, unknown>>();
  } catch {
    return jsonResponse(400, {
      error: { message: "Request body must be valid JSON.", type: "invalid_request" },
    });
  }

  const requestedModel = String(body.model ?? "");
  const resolved = resolveAttempts(requestedModel, providers, models, combos);
  if ("error" in resolved) {
    return jsonResponse(resolved.status, {
      error: { message: resolved.error, type: "invalid_request" },
    });
  }

  const wantsStream = body.stream === true;

  // Flatten the ordered attempts (combo members, or a single model) into a
  // flat list of concrete (provider, modelId, cred) tries. Combo priority is
  // the outer order; each member's own multi-key fallback is the inner order.
  type Try = { route: ResolvedRoute; cred: string };
  const tries: Try[] = [];
  for (const route of resolved.attempts) {
    if (!baseURLFor(route.provider)) continue; // no base URL → unusable
    const authList =
      route.provider.authMode === "cookie"
        ? [route.provider.cookie ?? ""].filter(Boolean)
        : route.keys.length
        ? route.keys
        : providerKeys(route.provider);
    for (const cred of authList) tries.push({ route, cred });
  }

  if (!tries.length) {
    return jsonResponse(400, {
      error: {
        message: `No usable provider/key found for "${requestedModel}". Check the provider's base URL and API key in the app.`,
        type: "invalid_request",
      },
    });
  }

  // ── Fallback loop over every (member × key) attempt in priority order ─────
  let lastStatus = 502;
  let lastText = "All provider attempts failed.";
  for (let i = 0; i < tries.length; i++) {
    const { route, cred } = tries[i];
    const { provider, modelId } = route;
    const targetURL = baseURLFor(provider).replace(/\/$/, "") + endpoint;
    const upstreamBody = JSON.stringify({ ...body, model: modelId });
    const headers = buildUpstreamHeaders(provider, cred, endpoint);

    let upstream: Response;
    try {
      upstream = await fetch(targetURL, {
        method: "POST",
        headers,
        body: upstreamBody,
      });
    } catch (err) {
      lastStatus = 502;
      lastText = err instanceof Error ? err.message : "Upstream fetch failed.";
      continue; // network error → try next attempt
    }

    if (shouldFallback(upstream.status) && i < tries.length - 1) {
      lastStatus = upstream.status;
      lastText = await safeText(upstream);
      continue; // try next attempt
    }

    // Success (or final attempt) → relay this response to the caller.
    void recordUsage(uid, provider.id, modelId, nowMs).catch(() => {});
    return relay(upstream, wantsStream);
  }

  return jsonResponse(lastStatus, {
    error: {
      message: `All ${tries.length} attempt(s) failed. Last upstream error: ${lastText}`,
      type: "upstream_error",
    },
  });
}

// Build the auth headers for an upstream request. OpenAI-compatible providers
// use `Authorization: Bearer`; Anthropic-native ones (apiFormat "anthropic",
// or when the caller hit the /messages endpoint directly) use `x-api-key` +
// `anthropic-version`. Cookie-auth providers send a raw Cookie header.
function buildUpstreamHeaders(
  provider: GwProvider,
  cred: string,
  endpoint: string
): Headers {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  const isAnthropic =
    provider.apiFormat === "anthropic" || endpoint === "/messages";
  if (provider.authMode === "cookie") {
    headers.set("Cookie", cred);
  } else if (isAnthropic) {
    headers.set("x-api-key", cred);
    headers.set("anthropic-version", "2023-06-01");
  } else {
    headers.set("Authorization", `Bearer ${cred}`);
  }
  if (provider.organization)
    headers.set("OpenAI-Organization", provider.organization);
  if (provider.extraHeaders) {
    for (const [k, v] of Object.entries(provider.extraHeaders))
      headers.set(k, v);
  }
  return headers;
}

// Normalize a saved model id for the /v1/models listing so every Claude model
// shows up as "aip/<bare-id>" regardless of how it was stored (bare, or with an
// old "anthropic/" prefix). Non-Claude ids pass through unchanged. Routing is
// unaffected: resolveRoute strips the "aip/"/"anthropic/" prefix before the
// request goes upstream.
function displayModelId(modelId: string): string {
  const id = (modelId ?? "").trim();
  if (!id) return id;
  if (!/claude/i.test(id)) return id;
  const slash = id.indexOf("/");
  const bare = slash > 0 ? id.slice(slash + 1) : id;
  return `aip/${bare}`;
}

function matchEndpoint(path: string): string | null {
  const p = path.replace(/^v1\//, "");
  if (p === "chat/completions") return "/chat/completions";
  if (p === "completions") return "/completions";
  if (p === "embeddings") return "/embeddings";
  if (p === "messages") return "/messages";
  return null;
}

function relay(upstream: Response, _wantsStream: boolean): CoreResponse {
  const headers: Record<string, string> = {};
  upstream.headers.forEach((v, k) => {
    const lk = k.toLowerCase();
    if (HOP_BY_HOP.has(lk)) return;
    if (lk === "content-encoding" || lk === "content-length") return;
    headers[k] = v;
  });
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

// Best-effort usage counter. Appends to users/{uid}/kv/gatewayUsage. Never
// blocks or fails the request.
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
  // Keep the last 500 entries to bound document size.
  const trimmed = list.slice(-500);
  await writeKV(uid, KEY, trimmed, nowMs);
}
