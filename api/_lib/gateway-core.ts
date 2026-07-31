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
//   GET  models             → aggregate of the user's saved models
import { resolveApiKey } from "./api-keys";
import { readKV, writeKV } from "./kv";
import {
  baseURLFor,
  resolveRoute,
  type GwModel,
  type GwProvider,
} from "./upstreams";
import { bearerToken } from "./auth";
import { jsonResponse, type CoreRequest, type CoreResponse } from "./http";

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

  // ── Load the user's connected providers + models ─────────────────────────
  const [providers, models] = await Promise.all([
    readKV<GwProvider[]>(uid, "providers", []),
    readKV<GwModel[]>(uid, "models", []),
  ]);

  // ── GET models: return the user's saved models in OpenAI list shape ──────
  if (path === "models" || path === "v1/models") {
    return jsonResponse(200, {
      object: "list",
      data: models.map((m) => ({
        id: m.modelId,
        object: "model",
        owned_by: m.providerKey,
      })),
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
  const route = resolveRoute(requestedModel, providers, models);
  if ("error" in route) {
    return jsonResponse(route.status, {
      error: { message: route.error, type: "invalid_request" },
    });
  }

  const { provider, modelId, keys } = route;
  const base = baseURLFor(provider);
  if (!base) {
    return jsonResponse(400, {
      error: { message: `Provider "${provider.displayName ?? provider.key}" has no base URL.`, type: "invalid_request" },
    });
  }

  // Send upstream with the resolved (prefix-stripped) model id.
  const upstreamBody = JSON.stringify({ ...body, model: modelId });
  const wantsStream = body.stream === true;
  const targetURL = base.replace(/\/$/, "") + endpoint;

  const authList =
    provider.authMode === "cookie"
      ? [provider.cookie ?? ""].filter(Boolean)
      : keys;

  if (!authList.length) {
    return jsonResponse(400, {
      error: {
        message: `Provider "${provider.displayName ?? provider.key}" has no API key configured.`,
        type: "invalid_request",
      },
    });
  }

  // ── Fallback loop over the provider's keys ───────────────────────────────
  let lastStatus = 502;
  let lastText = "All provider keys failed.";
  for (let i = 0; i < authList.length; i++) {
    const cred = authList[i];
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    if (provider.authMode === "cookie") headers.set("Cookie", cred);
    else headers.set("Authorization", `Bearer ${cred}`);
    if (provider.organization) headers.set("OpenAI-Organization", provider.organization);
    if (provider.extraHeaders) {
      for (const [k, v] of Object.entries(provider.extraHeaders)) headers.set(k, v);
    }

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
      continue; // network error → try next key
    }

    if (shouldFallback(upstream.status) && i < authList.length - 1) {
      lastStatus = upstream.status;
      lastText = await safeText(upstream);
      continue; // try next key
    }

    // Success (or final attempt) → relay this response to the caller.
    void recordUsage(uid, provider.id, modelId, nowMs).catch(() => {});
    return relay(upstream, wantsStream);
  }

  return jsonResponse(lastStatus, {
    error: {
      message: `All ${authList.length} key(s) for this provider failed. Last upstream error: ${lastText}`,
      type: "upstream_error",
    },
  });
}

function matchEndpoint(path: string): string | null {
  const p = path.replace(/^v1\//, "");
  if (p === "chat/completions") return "/chat/completions";
  if (p === "completions") return "/completions";
  if (p === "embeddings") return "/embeddings";
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
