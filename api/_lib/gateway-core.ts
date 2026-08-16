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
import { bearerToken, requireUser } from "./auth.js";
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

export async function handleGateway(
  req: CoreRequest,
  nowMs: number
): Promise<CoreResponse> {
  const isAnthropicReq = req.subPath.toLowerCase().includes("messages");

  // ── 1. Auth ────────────────────────────────────────────────────────────
  const raw =
    bearerToken(req) ||
    req.header("x-api-key") ||
    req.header("api-key") ||
    req.query.get("key") ||
    req.query.get("api_key");

  if (!raw) {
    return formatGatewayError(
      401,
      "Missing API key. Send `Authorization: Bearer ah-…` or `x-api-key: ah-…`.",
      isAnthropicReq
    );
  }

  let uid = await resolveApiKey(raw);
  if (!uid) {
    // Also accept direct Firebase session token or authenticated user
    uid = await requireUser(req);
  }

  if (!uid) {
    return formatGatewayError(401, "Invalid or revoked API key.", isAnthropicReq);
  }

  const path = req.subPath.replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase();

  // ── Load the user's connected providers + models + combos ───────────────
  const [providers, models, combos] = await Promise.all([
    readKV<GwProvider[]>(uid, "providers", []),
    readKV<GwModel[]>(uid, "models", []),
    readKV<GwCombo[]>(uid, "combos", []),
  ]);

  // ── GET models: return the user's saved models + combos in list shape ────
  if (path === "models" || path === "v1/models") {
    const data: Array<{ id: string; object: string; owned_by: string }> = [];
    if (Array.isArray(models)) {
      for (const m of models) {
        if (m && m.modelId) {
          data.push({
            id: m.modelId,
            object: "model",
            owned_by: m.providerKey || m.providerId || "system",
          });
        }
      }
    }
    if (Array.isArray(combos)) {
      for (const c of combos) {
        const comboName = (c?.name || (c as any)?.comboName || (c as any)?.id || "").trim();
        if (comboName) {
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

  // ── POST inference endpoints ─────────────────────────────────────────────
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

  // ── Fallback loop over attempt(s) ────────────────────────────────────────
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
    //   - /messages request → OpenAI provider: translate request → OpenAI,
    //     response → Anthropic (needsTranslation).
    //   - /chat/completions request → Anthropic provider (e.g. a combo member):
    //     translate request → Anthropic, response → OpenAI (toAnthropicProvider).
    const needsTranslation = endpoint === "/messages" && !isAnthropicProvider;
    const toAnthropicProvider =
      endpoint === "/chat/completions" && isAnthropicProvider;
    const isGoogleProvider =
      provider.key === "google" ||
      provider.key === "antigravity" ||
      (provider.baseURL ?? "").includes("generativelanguage.googleapis.com");
    const isOAuth =
      provider.authMode === "oauth" ||
      provider.key === "antigravity" ||
      cred.startsWith("ya29.");

    let actualEndpoint: string;
    let targetURL: string;
    let upstreamBody: string;

    const cleanModelId = modelId.replace(/^(antigravity\/|google\/|aip\/)/i, "");
    const candidateUrls: string[] = [];

    if (needsTranslation && isGoogleProvider) {
      const googleRequest = anthropicToGoogle(body, cleanModelId);
      const streamEndpoint = wantsStream
        ? "streamGenerateContent"
        : "generateContent";
      const sseParam = wantsStream ? (isOAuth ? "?alt=sse" : "&alt=sse") : "";

      if (isOAuth) {
        candidateUrls.push(
          `https://cloudcode-pa.googleapis.com/v1internal:${streamEndpoint}${sseParam}`,
          `https://cloudcode-pa.googleapis.com/v1alpha/models/${cleanModelId}:${streamEndpoint}${sseParam}`,
          `https://generativelanguage.googleapis.com/v1beta/models/${cleanModelId}:${streamEndpoint}${sseParam}`,
          `https://generativelanguage.googleapis.com/v1/models/${cleanModelId}:${streamEndpoint}${sseParam}`
        );
        if (cleanModelId.startsWith("claude-")) {
          const gemFallback = cleanModelId.includes("sonnet") || cleanModelId.includes("opus") ? "gemini-2.5-pro" : "gemini-2.0-flash";
          candidateUrls.push(
            `https://cloudcode-pa.googleapis.com/v1internal:${streamEndpoint}${sseParam}`,
            `https://cloudcode-pa.googleapis.com/v1alpha/models/${gemFallback}:${streamEndpoint}${sseParam}`,
            `https://generativelanguage.googleapis.com/v1beta/models/${gemFallback}:${streamEndpoint}${sseParam}`
          );
        }
      } else {
        candidateUrls.push(
          `https://generativelanguage.googleapis.com/v1beta/models/${cleanModelId}:${streamEndpoint}?key=${encodeURIComponent(cred)}${sseParam}`,
          `https://generativelanguage.googleapis.com/v1/models/${cleanModelId}:${streamEndpoint}?key=${encodeURIComponent(cred)}${sseParam}`
        );
      }
      upstreamBody = JSON.stringify({ model: cleanModelId, ...googleRequest });
      actualEndpoint = endpoint;
    } else if (isGoogleProvider) {
      const googleRequest = openAIToGoogle(body, cleanModelId);
      const streamEndpoint = wantsStream
        ? "streamGenerateContent"
        : "generateContent";
      const sseParam = wantsStream ? (isOAuth ? "?alt=sse" : "&alt=sse") : "";

      if (isOAuth) {
        candidateUrls.push(
          `https://cloudcode-pa.googleapis.com/v1internal:${streamEndpoint}${sseParam}`,
          `https://cloudcode-pa.googleapis.com/v1alpha/models/${cleanModelId}:${streamEndpoint}${sseParam}`,
          `https://generativelanguage.googleapis.com/v1beta/models/${cleanModelId}:${streamEndpoint}${sseParam}`,
          `https://generativelanguage.googleapis.com/v1/models/${cleanModelId}:${streamEndpoint}${sseParam}`
        );
        if (cleanModelId.startsWith("claude-")) {
          const gemFallback = cleanModelId.includes("sonnet") || cleanModelId.includes("opus") ? "gemini-2.5-pro" : "gemini-2.0-flash";
          candidateUrls.push(
            `https://cloudcode-pa.googleapis.com/v1internal:${streamEndpoint}${sseParam}`,
            `https://cloudcode-pa.googleapis.com/v1alpha/models/${gemFallback}:${streamEndpoint}${sseParam}`,
            `https://generativelanguage.googleapis.com/v1beta/models/${gemFallback}:${streamEndpoint}${sseParam}`
          );
        }
      } else {
        candidateUrls.push(
          `https://generativelanguage.googleapis.com/v1beta/models/${cleanModelId}:${streamEndpoint}?key=${encodeURIComponent(cred)}${sseParam}`,
          `https://generativelanguage.googleapis.com/v1/models/${cleanModelId}:${streamEndpoint}?key=${encodeURIComponent(cred)}${sseParam}`
        );
      }
      upstreamBody = JSON.stringify({ model: cleanModelId, ...googleRequest });
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

    for (const url of candidateUrls) {
      try {
        const candidateResp = await fetch(url, {
          method: "POST",
          headers,
          body: upstreamBody,
        });

        if (candidateResp.ok) {
          upstream = candidateResp;
          break;
        }

        lastStatus = candidateResp.status;
        lastText = await safeText(candidateResp);

        // If candidate url returned 404 or 403 or 400 on CloudCode endpoint, try next candidate
        if (candidateUrls.length > 1 && (candidateResp.status === 404 || candidateResp.status === 403 || candidateResp.status === 400)) {
          continue;
        }

        upstream = candidateResp;
        break;
      } catch (err) {
        lastStatus = 502;
        lastText = err instanceof Error ? err.message : "Upstream fetch failed.";
      }
    }

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
      lastText = await safeText(upstream);
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
    // a 2xx as success — otherwise the combo log would show "responded" while
    // the client actually receives the upstream error.
    const succeeded = upstream.ok;

    if (succeeded) {
      void recordUsage(uid, provider.id, modelId, nowMs).catch(() => {});
    } else {
      lastStatus = upstream.status;
    }

    if (isCombo && resolved.combo) {
      // Read the error body from a clone so the original stream still relays
      // to the client intact.
      const attemptError = succeeded
        ? undefined
        : await safeText(upstream.clone()).catch(() => `HTTP ${upstream.status}`);
      comboAttempts.push({
        providerId: provider.id,
        modelId: modelId,
        displayName: modelId,
        status: succeeded ? "success" : "failed",
        error: attemptError,
        durationMs: Date.now() - attemptStart,
      });
      void recordComboLog(uid, {
        id: `glog_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
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

    if (needsTranslation && isGoogleProvider) {
      return await translateGoogleResponseToAnthropic(upstream, wantsStream, modelId);
    }
    if (isGoogleProvider) {
      return await translateGoogleResponseToOpenAI(upstream, wantsStream, cleanModelId);
    }
    if (needsTranslation) {
      return await translateResponseToAnthropic(upstream, wantsStream, modelId);
    }
    if (toAnthropicProvider) {
      return await translateAnthropicResponseToOpenAI(
        upstream,
        wantsStream,
        cleanModelId
      );
    }
    return relay(upstream, wantsStream);
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

  if (provider.key === "antigravity" || provider.key === "google") {
    headers.set("User-Agent", "antigravity/1.0.0");
    headers.set("x-goog-api-client", "gl-js/ antigravity/1.0.0");
  }

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
    // Anthropic has no system message role — system content is collected into
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
          // data:image/...;base64,... → Anthropic inline image block.
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

  // OpenAI tool_calls → Anthropic tools. The first system message in the
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

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (!GOOGLE_ALLOWED_SCHEMA_KEYS.has(key)) {
      continue;
    }
    cleaned[key] = cleanSchemaForGoogle(value);
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

function anthropicToGoogle(
  body: Record<string, unknown>,
  _modelId: string
): Record<string, unknown> {
  const contents: Array<{
    role: string;
    parts: Array<Record<string, unknown>>;
  }> = [];

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
          const name = toolUseMap.get(toolUseId) || "tool_result";
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
  if (sys) {
    const sysText =
      typeof sys === "string"
        ? sys
        : Array.isArray(sys)
        ? (sys as Array<{ text?: string }>).map((b) => b.text ?? "").join("\n")
        : "";
    if (sysText) {
      googleBody.systemInstruction = { parts: [{ text: sysText }] };
    }
  }

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
      true
    );
  }

  if (wantsStream) {
    return translateGoogleStreamToAnthropic(upstream, modelId);
  }

  const googleResp = (await upstream.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          functionCall?: { name?: string; args?: Record<string, unknown> };
        }>;
      };
      finishReason?: string;
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
  };

  const candidate = googleResp.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const content: Array<Record<string, unknown>> = [];
  let hasToolCall = false;

  for (const p of parts) {
    if (p.text) {
      content.push({ type: "text", text: p.text });
    }
    if (p.functionCall) {
      hasToolCall = true;
      content.push({
        type: "tool_use",
        id: `toolu_g_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: p.functionCall.name ?? "",
        input: p.functionCall.args ?? {},
      });
    }
  }

  if (content.length === 0) content.push({ type: "text", text: "" });

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
        input_tokens: googleResp.usageMetadata?.promptTokenCount ?? 0,
        output_tokens: googleResp.usageMetadata?.candidatesTokenCount ?? 0,
      },
    },
  };
}

function translateGoogleStreamToAnthropic(
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
      let toolCount = 0;

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
                candidates?: Array<{
                  content?: {
                    parts?: Array<{
                      text?: string;
                      functionCall?: {
                        name?: string;
                        args?: Record<string, unknown>;
                      };
                    }>;
                  };
                }>;
              };
              try {
                chunk = JSON.parse(payload);
              } catch {
                continue;
              }
              const parts = chunk.candidates?.[0]?.content?.parts ?? [];
              for (const p of parts) {
                if (p.text) {
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
                        delta: { type: "text_delta", text: p.text },
                      },
                      "content_block_delta"
                    )
                  );
                }
                if (p.functionCall?.name) {
                  closeText();
                  const anthIndex = nextIndex++;
                  toolCount += 1;
                  controller.enqueue(
                    ev(
                      {
                        type: "content_block_start",
                        index: anthIndex,
                        content_block: {
                          type: "tool_use",
                          id: `toolu_g_${msgId}_${anthIndex}`,
                          name: p.functionCall.name,
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
            }
          }
        }
      } catch {}

      closeText();

      const stopReason = toolCount ? "tool_use" : "end_turn";
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
  if (systemInstruction) {
    googleBody.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

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
    return translateGoogleStreamToOpenAI(upstream, modelId);
  }

  const googleResp = (await upstream.json()) as any;
  const candidate = googleResp.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const textParts: string[] = [];
  const toolCalls: any[] = [];

  for (const p of parts) {
    if (p.text) textParts.push(p.text);
    if (p.functionCall) {
      toolCalls.push({
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: "function",
        function: {
          name: p.functionCall.name || "",
          arguments: JSON.stringify(p.functionCall.args || {}),
        },
      });
    }
  }

  const text = textParts.join("");
  const messageObj: Record<string, unknown> = {
    role: "assistant",
    content: text || (toolCalls.length ? null : ""),
  };
  if (toolCalls.length) {
    messageObj.tool_calls = toolCalls;
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
          message: messageObj,
          finish_reason: toolCalls.length
            ? "tool_calls"
            : candidate?.finishReason?.toLowerCase() || "stop",
        },
      ],
      usage: {
        prompt_tokens: googleResp.usageMetadata?.promptTokenCount ?? 0,
        completion_tokens: googleResp.usageMetadata?.candidatesTokenCount ?? 0,
        total_tokens: googleResp.usageMetadata?.totalTokenCount ?? 0,
      },
    },
  };
}

function translateGoogleStreamToOpenAI(
  upstream: Response,
  modelId: string
): CoreResponse {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const chatId = `chatcmpl-${Date.now()}`;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const reader = upstream.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        let buffer = "";

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
                const candidate = googleChunk.candidates?.[0];
                if (candidate) {
                  const parts = candidate?.content?.parts || [];
                  const text = parts.map((p: any) => p.text || "").join("");
                  if (text) {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({
                          id: chatId,
                          object: "chat.completion.chunk",
                          created: Math.floor(Date.now() / 1000),
                          model: modelId,
                          choices: [
                            { index: 0, delta: { content: text }, finish_reason: null },
                          ],
                        })}\n\n`
                      )
                    );
                  }
                  if (candidate?.finishReason) {
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
                              finish_reason: candidate.finishReason.toLowerCase(),
                            },
                          ],
                        })}\n\n`
                      )
                    );
                  }
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

  const openai = (await upstream.json()) as {
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
// response. The inverse of openAIToAnthropic — used when a caller that speaks
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

  const anth = (await upstream.json()) as {
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

// SSE bridge: Anthropic event stream → OpenAI chat.completion.chunk stream.
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

function relay(upstream: Response, _wantsStream: boolean): CoreResponse {
  const headers: Record<string, string> = {};
  upstream.headers.forEach((v, k) => {
    const lk = k.toLowerCase();
    if (HOP_BY_HOP.has(lk)) return;
    if (lk === "content-encoding" || lk === "content-length") return;
    headers[k] = v;
  });
  // An upstream HTML response means we hit a web page, not an API — usually a
  // wrong base URL (missing /v1), a captive portal, or the provider's own 404
  // page. Streaming raw HTML to an OpenAI/Anthropic client shows garbage.
  if ((headers["content-type"] ?? "").toLowerCase().includes("text/html")) {
    return formatGatewayError(
      upstream.status,
      `Upstream returned an HTML page instead of an API response (${upstream.status}). Check the provider Base URL (include /v1) and that it's an API endpoint, not a website.`,
      false
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
