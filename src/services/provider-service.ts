import OpenAI from "openai";
import type { ConnectedProvider } from "@/types";
import { useProviderStore } from "@/store/provider-store";
import {
  validateKimiWebProvider,
  validateDeepSeekWebProvider,
  validateQwenWebProvider,
  validateBlackboxWebProvider,
} from "@/utils/web-validators";

// All hosted providers go through /api/proxy — same URL in dev (via Vite
// middleware) and prod (via api/proxy/[...path].ts Vercel Edge Function).
// Only localhost endpoints (Ollama, LM Studio) skip the proxy since they
// don't have CORS issues from the browser.
const HOSTED_PROXY_MAP: Array<[RegExp, string]> = [
  [/^https:\/\/api\.openai\.com/i, "/api/proxy/openai"],
  [/^https:\/\/integrate\.api\.nvidia\.com/i, "/api/proxy/nvidia"],
  [/^https:\/\/api\.anthropic\.com/i, "/api/proxy/anthropic"],
  [/^https:\/\/openrouter\.ai/i, "/api/proxy/openrouter"],
  [/^https:\/\/generativelanguage\.googleapis\.com/i, "/api/proxy/google"],
];

interface Resolved {
  baseURL: string;
  proxied: boolean;
  targetHeader?: string;
}

function isLocalhost(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(url);
}

function resolveBaseURL(url: string, _providerKey?: string): Resolved {
  if (isLocalhost(url)) return { baseURL: url, proxied: false };
  const origin = window.location.origin;



  // Known hosted providers → dedicated proxy prefix.
  for (const [pattern, replacement] of HOSTED_PROXY_MAP) {
    if (pattern.test(url)) {
      return {
        baseURL: `${origin}${url.replace(pattern, replacement)}`,
        proxied: true,
      };
    }
  }
  // Any other https endpoint (user-supplied custom base URL) → generic proxy.
  // Target is passed via query param because Edge functions route by path.
  if (/^https:\/\//i.test(url)) {
    try {
      let cleanUrl = url.trim().replace(/\/$/, "");
      cleanUrl = cleanUrl
        .replace(/\/chat\/completions\/?$/i, "")
        .replace(/\/models\/?$/i, "")
        .replace(/\/messages\/?$/i, "")
        .replace(/\/$/, "");

      let parsed = new URL(cleanUrl);
      // Auto-append /v1 for custom OpenAI-compatible gateways if path is empty or root
      if (!parsed.pathname || parsed.pathname === "/") {
        cleanUrl += "/v1";
        parsed = new URL(cleanUrl);
      }

      const remainingPath = parsed.pathname.replace(/\/$/, "");
      const baseHost = `${parsed.protocol}//${parsed.host}`;

      console.log('[Provider Service] Custom provider detected:', {
        original: url,
        cleanUrl,
        baseHost,
        remainingPath,
        proxyPath: `${origin}/api/proxy/custom`
      });
      return {
        baseURL: `${origin}/api/proxy/custom`,
        proxied: true,
        targetHeader: cleanUrl,
      };
    } catch (err) {
      console.error('[Provider Service] Failed to parse custom URL:', url, err);
      return { baseURL: url, proxied: false };
    }
  }
  return { baseURL: url, proxied: false };
}

// Build the fetch URL + headers for a raw request to a provider (used by the
// Anthropic Messages path, which can't go through the OpenAI SDK). Reuses the
// same proxy resolution as createClient so auth + CORS work identically.
// `subPath` is appended to the resolved base, e.g. "/messages".
export function resolveRawRequest(
  provider: ConnectedProvider,
  subPath: string
): { url: string; headers: Record<string, string> } {
  const authMode = provider.authMode ?? "apiKey";
  const key = (provider.apiKey ?? "").trim();
  const cookie = (provider.cookie ?? "").trim();
  const { baseURL, proxied, targetHeader } = resolveBaseURL(provider.baseURL, provider.key);

  let url = baseURL.replace(/\/$/, "") + subPath;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (proxied) {
    if (authMode === "cookie") headers["x-provider-cookie"] = cookie;
    else headers["x-provider-key"] = key;

    // Rewrite path-based proxy URL to query-param format for Vercel.
    const u = new URL(url);
    const proxyMatch = u.pathname.match(/^\/api\/proxy\/(.+)$/);
    if (proxyMatch) {
      u.pathname = "/api/proxy";
      u.searchParams.set("__p", proxyMatch[1]);
    }
    if (targetHeader && !u.searchParams.has("target")) {
      u.searchParams.set("target", targetHeader);
    }
    url = u.toString();
  } else {
    // Direct (localhost) — set auth headers ourselves. Anthropic uses x-api-key.
    if (authMode !== "cookie" && key) {
      headers["Authorization"] = `Bearer ${key}`;
      headers["x-api-key"] = key;
    }
  }

  if (provider.extraHeaders) {
    for (const [k, v] of Object.entries(provider.extraHeaders)) headers[k] = v;
  }
  return { url, headers };
}

export function createClient(provider: ConnectedProvider): OpenAI {
  const authMode = provider.authMode ?? "apiKey";
  const key = (provider.apiKey ?? "").trim();
  const cookie = (provider.cookie ?? "").trim();

  if (authMode === "cookie") {
    if (!cookie) {
      throw new Error(
        "Cookie is missing. Edit the provider and paste your session cookie string."
      );
    }
  } else if (!key) {
    throw new Error(
      "API key is missing. Edit the provider and re-connect."
    );
  }

  const { baseURL, proxied, targetHeader } = resolveBaseURL(provider.baseURL, provider.key);

  if (authMode === "cookie" && !proxied) {
    // Browsers forbid setting the Cookie header on fetch, so cookie auth must
    // flow through our proxy (which injects it upstream). Localhost endpoints
    // bypass the proxy and therefore can't use cookie auth.
    throw new Error(
      "Cookie auth needs the proxy — it doesn't work with localhost endpoints. Use a hosted https base URL."
    );
  }

  // When going through the proxy we override the SDK's `fetch` so we can
  // GUARANTEE the auth header is set on EVERY request (POST, streaming, all
  // of them). The proxy rewrites `x-provider-key` → `Authorization: Bearer
  // <key>`, and `x-provider-cookie` → `Cookie: <cookie>`.
  const customFetch = proxied
    ? (async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        if (authMode === "cookie") {
          headers.set("x-provider-cookie", cookie);
        } else {
          headers.set("x-provider-key", key);
        }

        // Rewrite path-based proxy URL to query-param format.
        // SDK builds: /api/proxy/openai/v1/models
        // Vercel needs: /api/proxy?__p=openai/v1/models
        const reqUrl =
          typeof input === "string" || input instanceof URL
            ? new URL(input.toString())
            : new URL(input.url);

        const proxyMatch = reqUrl.pathname.match(/^\/api\/proxy\/(.+)$/);
        if (proxyMatch) {
          reqUrl.pathname = "/api/proxy";
          reqUrl.searchParams.set("__p", proxyMatch[1]);
        }

        if (targetHeader && !reqUrl.searchParams.has("target")) {
          reqUrl.searchParams.set("target", targetHeader);
        }

        input = reqUrl.toString();

        headers.delete("authorization");
        if (provider.extraHeaders) {
          for (const [k, v] of Object.entries(provider.extraHeaders)) {
            headers.set(k, v);
          }
        }
        return fetch(input, { ...init, headers });
      }) as typeof fetch
    : undefined;

  return new OpenAI({
    // Any non-empty string keeps the SDK happy; the real key is injected by
    // our custom fetch above.
    apiKey: proxied ? "browser-proxied" : key,
    baseURL,
    organization: provider.organization,
    fetch: customFetch,
    // Disable SDK auto-retries — providers like NVIDIA NIM free tier have
    // very low per-key limits, and each retry counts. If a request fails,
    // the user can click Retry manually.
    maxRetries: 0,
    defaultHeaders: proxied
      ? undefined
      : {
          Authorization: `Bearer ${key}`,
          ...(provider.extraHeaders ?? {}),
        },
    dangerouslyAllowBrowser: true,
  });
}

export async function testSingleModel(
  provider: ConnectedProvider,
  modelId: string
): Promise<boolean> {
  try {
    const rawId = modelId.replace(/^aip\//, "");
    const candidateIds = Array.from(new Set([rawId, modelId].filter(Boolean)));

    if (provider.key === "google" || provider.baseURL.includes("generativelanguage.googleapis.com")) {
      const key = (provider.apiKey ?? "").trim();
      if (!key) return false;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(rawId)}:generateContent?key=${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "hi" }] }],
          generationConfig: { maxOutputTokens: 16 },
        }),
      });
      return res.ok;
    }

    if (provider.apiFormat === "anthropic" || provider.key === "anthropic") {
      const { url, headers } = resolveRawRequest(provider, "/messages");
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: rawId,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 16,
        }),
      });
      return res.ok;
    }

    const client = createClient(provider);

    for (const mId of candidateIds) {
      const attempts = [
        { model: mId, messages: [{ role: "user", content: "hi" }], max_tokens: 16 },
        { model: mId, messages: [{ role: "user", content: "hi" }], max_completion_tokens: 16 },
        { model: mId, messages: [{ role: "user", content: "hi" }] },
      ];

      for (const req of attempts) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const res = await client.chat.completions.create(req as any);
          if (res.choices?.length) return true;
        } catch (err: any) {
          const status = err?.status ?? err?.response?.status;
          // If status is 400 or parameter rejection, try next max_tokens attempt
          if (status === 400) continue;
          // If it's 404 or auth failure, don't keep trying this candidate ID
          break;
        }
      }
    }
    return false;
  } catch (err) {
    console.warn("[testSingleModel] Error testing model:", modelId, err);
    return false;
  }
}

export interface TestResult {
  ok: boolean;
  message: string;
  modelCount?: number;
}

export async function testConnection(
  provider: ConnectedProvider
): Promise<TestResult> {
  try {
    // Google's Generative Language API with API key (AIza...)
    if (provider.key === "google" || provider.baseURL.includes("generativelanguage.googleapis.com")) {
      const key = (provider.apiKey ?? "").trim();
      if (!key) {
        throw new Error("API key is missing.");
      }

      const testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
      const res = await fetch(testUrl);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status} ${res.statusText}: ${text}`);
      }

      const data = await res.json();
      const count = (data.models ?? []).length;
      return {
        ok: true,
        message: `Connected — ${count} model${count === 1 ? "" : "s"} available.`,
        modelCount: count,
      };
    }

    // Web cookie provider direct validators
    if (provider.key === "kimi" || provider.key === "kimi-web" || provider.baseURL.includes("kimi.com")) {
      const res = await validateKimiWebProvider({ apiKey: provider.apiKey ?? "" });
      if (!res.valid) throw new Error(res.error || "Kimi validation failed");
      return { ok: true, message: `Connected — Kimi session verified (${res.data?.name || "User"}).` };
    }

    if (provider.key === "deepseek-web" || (provider.key === "deepseek" && (provider.apiKey?.startsWith("{") || provider.baseURL.includes("chat.deepseek.com")))) {
      const res = await validateDeepSeekWebProvider({ apiKey: provider.apiKey ?? "" });
      if (!res.valid) throw new Error(res.error || "DeepSeek validation failed");
      return { ok: true, message: "Connected — DeepSeek web session verified." };
    }

    if (provider.key === "qwen-web" || provider.baseURL.includes("chat.qwen.ai")) {
      const res = await validateQwenWebProvider({ apiKey: provider.apiKey ?? "" });
      if (!res.valid) throw new Error(res.error || "Qwen validation failed");
      return { ok: true, message: `Connected — Qwen web session verified (${res.data?.email || "User"}).` };
    }

    if (provider.key === "blackbox-web" || provider.baseURL.includes("blackbox.ai")) {
      const res = await validateBlackboxWebProvider({ apiKey: provider.apiKey ?? "" });
      if (!res.valid) throw new Error(res.error || "Blackbox validation failed");
      return { ok: true, message: "Connected — Blackbox session verified." };
    }

    const client = createClient(provider);
    const count = (res.data ?? []).length;
    return {
      ok: true,
      message: `Connected — ${count} model${count === 1 ? "" : "s"} available.`,
      modelCount: count,
    };
  } catch (err: unknown) {
    const message = extractErrorMessage(err);
    // For providers without /models (e.g. Anthropic), a 404 still means auth might work.
    if (/404/.test(message) || /not.?found/i.test(message)) {
      return {
        ok: true,
        message:
          "Connected. This provider does not expose a /models endpoint — add models manually.",
      };
    }
    return { ok: false, message };
  }
}

// If the error body is actually an HTML page (proxy/web 404, wrong base URL,
// captive portal), never show raw markup — replace it with a readable message.
function cleanBodyMsg(msg: unknown): string {
  if (typeof msg !== "string") return msg == null ? "" : String(msg);
  if (/<\/?[a-z][\s\S]*>/i.test(msg)) {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(msg);
    return title?.[1]?.trim() || "Upstream returned an HTML page instead of an API response. Check the Base URL (include /v1).";
  }
  return msg;
}

export function extractErrorMessage(err: unknown): string {
  if (!err) return "Unknown error.";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyErr = err as any;
  const status = anyErr?.status ?? anyErr?.response?.status;
  const bodyMsg = cleanBodyMsg(
    anyErr?.error?.message ??
      anyErr?.response?.data?.error?.message ??
      anyErr?.response?.data?.message ??
      anyErr?.message
  );
  if (status === 401) {
    return `401 Unauthorized — API key rejected. Check that the key is copied fully (no spaces) and is active. ${
      bodyMsg && bodyMsg !== "401 status code (no body)" ? `Detail: ${bodyMsg}` : ""
    }`.trim();
  }
  if (status === 403) return `403 Forbidden — key valid but lacks access. ${bodyMsg ?? ""}`.trim();
  if (status === 404) {
    return `404 Not Found — the model ID doesn't exist on this provider. Pick a different model, or make sure you're chatting through the correct provider (e.g. OpenRouter models can only run through OpenRouter). ${
      bodyMsg && bodyMsg !== "404 status code (no body)" ? `Detail: ${bodyMsg}` : ""
    }`.trim();
  }
  if (status === 429) return `429 Rate limited. ${bodyMsg ?? ""}`.trim();
  // NVIDIA NIM returns a plain-string 500 with this pattern when the free
  // tier per-key worker pool is exhausted. Real fix is a paid key or wait.
  if (
    typeof bodyMsg === "string" &&
    /Worker local total request limit/i.test(bodyMsg)
  ) {
    return `NVIDIA free-tier limit hit (${bodyMsg}). Your API key is rate-limited by NVIDIA — wait ~30s and retry, or upgrade to a paid key.`;
  }
  if (status === 502 || status === 503 || status === 504) {
    return `${status} — provider is temporarily overloaded. Click Retry in a moment. ${bodyMsg ?? ""}`.trim();
  }
  if (status) return `${status} ${bodyMsg ?? ""}`.trim();
  return bodyMsg ?? String(err);
}

export interface DiscoveredModelInfo {
  id: string;
  created?: number;
  contextLength?: number;
  inputPrice?: number;
  outputPrice?: number;
  supportsVision?: boolean;
  isFree?: boolean;
}

// OpenRouter returns "pricing.prompt" / "pricing.completion" as strings —
// cost per TOKEN. Convert to $ per 1M tokens to match our schema.
function parsePricePerMillion(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n)) return undefined;
  return n * 1_000_000;
}

export async function fetchModelIds(
  provider: ConnectedProvider
): Promise<DiscoveredModelInfo[]> {
  // Google's Generative Language API with API key (AIza...)
  if (provider.key === "google" || provider.baseURL.includes("generativelanguage.googleapis.com")) {
    const key = (provider.apiKey ?? "").trim();
    if (!key) {
      throw new Error("API key is missing.");
    }

    // Google's API uses /v1beta/models endpoint with key as query param
    const testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;

    const res = await fetch(testUrl);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${text}`);
    }

    const data = await res.json();
    return (data.models ?? []).map((m: any) => ({
      id: m.name?.replace("models/", "") ?? m.name,
      created: undefined,
      contextLength: undefined,
      inputPrice: undefined,
      outputPrice: undefined,
      supportsVision: m.supportedGenerationMethods?.includes("generateContent"),
      isFree: undefined,
    }));
  }

  const client = createClient(provider);
  const res = await client.models.list();
  return (res.data ?? [])
    .filter((m) => {
      // Filter out discount, deprecated, or inactive models
      const raw = m as any;
      const id = String(raw?.id ?? "").toLowerCase();
      if (!id) return false;
      if (
        id.includes(":discount") ||
        id.includes("-discount") ||
        id.includes(":deprecated")
      ) {
        return false;
      }
      if (raw?.status === "deprecated" || raw?.deprecated === true) {
        return false;
      }
      return true;
    })
    .map((m) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = m as any;
      const pricing = raw?.pricing ?? {};
      const inputPrice = parsePricePerMillion(pricing.prompt ?? pricing.input);
      const outputPrice = parsePricePerMillion(
        pricing.completion ?? pricing.output
      );
      return {
        id: raw.id,
        created: raw.created,
        contextLength: raw.context_length ?? raw.top_provider?.context_length,
        inputPrice,
        outputPrice,
        supportsVision:
          raw?.architecture?.input_modalities?.includes?.("image") ?? undefined,
        // If provider explicitly gave us pricing data and both are 0, it's free.
        // Undefined pricing → we can't say (treat as unknown, don't guess).
        isFree:
          inputPrice != null && outputPrice != null
            ? inputPrice === 0 && outputPrice === 0
            : undefined,
      };
    });
}
