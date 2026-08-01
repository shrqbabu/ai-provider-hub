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

  // When the caller uses /messages (Anthropic-native, e.g. Claude Desktop) but
  // the target provider speaks OpenAI format, we auto-translate the request body
  // and response so combos "just work" regardless of provider format.

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

    // Determine if we need to translate between Anthropic ↔ OpenAI formats.
    const isAnthropicProvider = (provider.apiFormat ?? "openai") === "anthropic";
    const needsTranslation = endpoint === "/messages" && !isAnthropicProvider;
    const isGoogleProvider = provider.key === "google" ||
      (provider.baseURL ?? "").includes("generativelanguage.googleapis.com");

    let actualEndpoint: string;
    let targetURL: string;
    let upstreamBody: string;

    if (needsTranslation && isGoogleProvider) {
      // Google uses its own API format — translate Anthropic → Google directly.
      const googleRequest = anthropicToGoogle(body, modelId);
      const streamEndpoint = wantsStream ? "streamGenerateContent" : "generateContent";
      targetURL = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:${streamEndpoint}?key=${encodeURIComponent(cred)}`;
      upstreamBody = JSON.stringify(googleRequest);
      actualEndpoint = endpoint; // just for header building — we override URL
    } else if (needsTranslation) {
      // Standard OpenAI-format provider — translate Anthropic → OpenAI.
      actualEndpoint = "/chat/completions";
      targetURL = baseURLFor(provider).replace(/\/$/, "") + actualEndpoint;
      upstreamBody = JSON.stringify(anthropicToOpenAI(body, modelId));
    } else {
      actualEndpoint = endpoint;
      targetURL = baseURLFor(provider).replace(/\/$/, "") + actualEndpoint;
      upstreamBody = JSON.stringify({ ...body, model: modelId });
    }

    // Google uses query-param auth, not headers.
    const headers = isGoogleProvider && needsTranslation
      ? new Headers({ "Content-Type": "application/json" })
      : buildUpstreamHeaders(provider, cred, actualEndpoint);

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

    if (needsTranslation && isGoogleProvider) {
      return await translateGoogleResponseToAnthropic(upstream, wantsStream, modelId);
    }
    if (needsTranslation) {
      // Translate the OpenAI response back to Anthropic Messages format
      return await translateResponseToAnthropic(upstream, wantsStream, modelId);
    }
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

// ── Format translation: Anthropic Messages ↔ OpenAI chat/completions ────────
// When Claude Desktop calls /v1/messages but the combo member uses an
// OpenAI-format provider (Google, OpenAI, NVIDIA, etc.), we convert on the fly.

function anthropicToOpenAI(
  body: Record<string, unknown>,
  modelId: string
): Record<string, unknown> {
  const messages: Array<{ role: string; content: string | unknown[] }> = [];

  // Anthropic puts system text in a top-level `system` field.
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

  // Convert messages.
  const inMsgs = (body.messages ?? []) as Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; source?: unknown }>;
  }>;

  for (const msg of inMsgs) {
    const role = msg.role === "assistant" ? "assistant" : "user";
    let content: string;
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n");
    } else {
      content = String(msg.content ?? "");
    }
    messages.push({ role, content });
  }

  const result: Record<string, unknown> = {
    model: modelId,
    messages,
  };

  if (body.stream === true) result.stream = true;
  if (body.max_tokens != null) result.max_tokens = body.max_tokens;
  if (body.temperature != null) result.temperature = body.temperature;
  if (body.top_p != null) result.top_p = body.top_p;
  if (body.stop_sequences != null) result.stop = body.stop_sequences;

  return result;
}

// ── Anthropic → Google Generative Language API ──────────────────────────────

function anthropicToGoogle(
  body: Record<string, unknown>,
  _modelId: string
): Record<string, unknown> {
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

  const inMsgs = (body.messages ?? []) as Array<{
    role: string;
    content: string | Array<{ type: string; text?: string }>;
  }>;

  for (const msg of inMsgs) {
    const role = msg.role === "assistant" ? "model" : "user";
    let text: string;
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n");
    } else {
      text = String(msg.content ?? "");
    }
    contents.push({ role, parts: [{ text }] });
  }

  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "Hello" }] });
  }

  const googleBody: Record<string, unknown> = { contents };

  // System instruction
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

  // Generation config
  const generationConfig: Record<string, unknown> = {};
  if (body.max_tokens != null) generationConfig.maxOutputTokens = body.max_tokens;
  if (body.temperature != null) generationConfig.temperature = body.temperature;
  if (body.top_p != null) generationConfig.topP = body.top_p;
  if (Object.keys(generationConfig).length > 0) {
    googleBody.generationConfig = generationConfig;
  }

  return googleBody;
}

// ── Google response → Anthropic Messages format ─────────────────────────────

async function translateGoogleResponseToAnthropic(
  upstream: Response,
  wantsStream: boolean,
  modelId: string
): Promise<CoreResponse> {
  if (upstream.status !== 200) {
    // Pass through error as-is, wrapped in Anthropic error shape.
    const errText = await safeText(upstream);
    return {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
      jsonBody: {
        type: "error",
        error: { type: "api_error", message: errText },
      },
    };
  }

  if (wantsStream) {
    return translateGoogleStreamToAnthropic(upstream, modelId);
  }

  // Non-streaming Google response
  const googleResp = (await upstream.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
  };

  const candidate = googleResp.candidates?.[0];
  const text =
    candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

  return {
    status: 200,
    headers: { "Content-Type": "application/json" },
    jsonBody: {
      id: `msg_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: modelId,
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
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
  const reader = upstream.body?.getReader();
  if (!reader) {
    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      jsonBody: {
        id: `msg_${Date.now()}`,
        type: "message",
        role: "assistant",
        model: modelId,
        content: [{ type: "text", text: "" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    };
  }

  const msgId = `msg_${Date.now()}`;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let sentStart = false;
  let buffer = "";

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sentStart) {
        sentStart = true;
        const startEvents = [
          `event: message_start\ndata: ${JSON.stringify({
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
          })}\n\n`,
          `event: content_block_start\ndata: ${JSON.stringify({
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          })}\n\n`,
        ];
        controller.enqueue(encoder.encode(startEvents.join("")));
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          const endEvents = [
            `event: content_block_stop\ndata: ${JSON.stringify({
              type: "content_block_stop",
              index: 0,
            })}\n\n`,
            `event: message_delta\ndata: ${JSON.stringify({
              type: "message_delta",
              delta: { stop_reason: "end_turn", stop_sequence: null },
              usage: { output_tokens: 0 },
            })}\n\n`,
            `event: message_stop\ndata: ${JSON.stringify({
              type: "message_stop",
            })}\n\n`,
          ];
          controller.enqueue(encoder.encode(endEvents.join("")));
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });

        // Google streams JSON array chunks — parse complete JSON objects
        // using brace counting.
        let searchFrom = 0;
        while (searchFrom < buffer.length) {
          const objStart = buffer.indexOf("{", searchFrom);
          if (objStart < 0) break;

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

          if (objEnd < 0) break; // incomplete object — wait for more data

          const jsonStr = buffer.slice(objStart, objEnd);
          searchFrom = objEnd;

          try {
            const chunk = JSON.parse(jsonStr) as {
              candidates?: Array<{
                content?: { parts?: Array<{ text?: string }> };
              }>;
            };
            const text =
              chunk.candidates?.[0]?.content?.parts
                ?.map((p) => p.text ?? "")
                .join("") ?? "";
            if (text) {
              const evt = `event: content_block_delta\ndata: ${JSON.stringify({
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text },
              })}\n\n`;
              controller.enqueue(encoder.encode(evt));
            }
          } catch {
            // skip malformed chunks
          }
        }

        // Keep only the unprocessed remainder
        if (searchFrom > 0) {
          buffer = buffer.slice(searchFrom);
        }
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
    return relay(upstream, wantsStream);
  }

  if (wantsStream) {
    return translateStreamToAnthropic(upstream, modelId);
  }

  // Non-streaming: read the full OpenAI response and convert.
  const openai = (await upstream.json()) as {
    choices?: Array<{
      message?: { role?: string; content?: string };
      finish_reason?: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const choice = openai.choices?.[0];
  const text = choice?.message?.content ?? "";
  const stopReason =
    choice?.finish_reason === "length" ? "max_tokens" : "end_turn";

  const anthropicBody = {
    id: `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: modelId,
    content: [{ type: "text", text }],
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

function translateStreamToAnthropic(
  upstream: Response,
  modelId: string
): CoreResponse {
  const reader = upstream.body?.getReader();
  if (!reader) {
    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      jsonBody: {
        id: `msg_${Date.now()}`,
        type: "message",
        role: "assistant",
        model: modelId,
        content: [{ type: "text", text: "" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    };
  }

  const msgId = `msg_${Date.now()}`;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let sentStart = false;
  let buffer = "";

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // Send opening events before the first content delta.
      if (!sentStart) {
        sentStart = true;
        const startEvents = [
          `event: message_start\ndata: ${JSON.stringify({
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
          })}\n\n`,
          `event: content_block_start\ndata: ${JSON.stringify({
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          })}\n\n`,
        ];
        controller.enqueue(encoder.encode(startEvents.join("")));
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Stream finished — send closing events.
          const endEvents = [
            `event: content_block_stop\ndata: ${JSON.stringify({
              type: "content_block_stop",
              index: 0,
            })}\n\n`,
            `event: message_delta\ndata: ${JSON.stringify({
              type: "message_delta",
              delta: { stop_reason: "end_turn", stop_sequence: null },
              usage: { output_tokens: 0 },
            })}\n\n`,
            `event: message_stop\ndata: ${JSON.stringify({
              type: "message_stop",
            })}\n\n`,
          ];
          controller.enqueue(encoder.encode(endEvents.join("")));
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE lines from the OpenAI stream.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;

          try {
            const chunk = JSON.parse(payload) as {
              choices?: Array<{
                delta?: { content?: string };
                finish_reason?: string | null;
              }>;
            };
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              const evt = `event: content_block_delta\ndata: ${JSON.stringify({
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: delta },
              })}\n\n`;
              controller.enqueue(encoder.encode(evt));
            }
          } catch {
            // skip malformed chunks
          }
        }
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
