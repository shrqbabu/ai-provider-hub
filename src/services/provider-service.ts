import OpenAI from "openai";
import type { ConnectedProvider } from "@/types";

// All hosted providers go through /api/proxy — same URL in dev (via Vite
// middleware) and prod (via api/proxy/[...path].ts Vercel Edge Function).
// Only localhost endpoints (Ollama, LM Studio) skip the proxy since they
// don't have CORS issues from the browser.
const HOSTED_PROXY_MAP: Array<[RegExp, string]> = [
  [/^https:\/\/api\.openai\.com/i, "/api/proxy/openai"],
  [/^https:\/\/integrate\.api\.nvidia\.com/i, "/api/proxy/nvidia"],
  [/^https:\/\/api\.anthropic\.com/i, "/api/proxy/anthropic"],
  [/^https:\/\/openrouter\.ai/i, "/api/proxy/openrouter"],
];

interface Resolved {
  baseURL: string;
  proxied: boolean;
  targetHeader?: string;
}

function isLocalhost(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(url);
}

function resolveBaseURL(url: string): Resolved {
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
  // Target is passed via a header (SDK drops query params from baseURL).
  if (/^https:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      const base = `${parsed.protocol}//${parsed.host}`;
      const remainingPath = parsed.pathname.replace(/\/$/, "");
      return {
        baseURL: `${origin}/api/proxy/custom${remainingPath}`,
        proxied: true,
        targetHeader: base,
      };
    } catch {
      return { baseURL: url, proxied: false };
    }
  }
  return { baseURL: url, proxied: false };
}

export function createClient(provider: ConnectedProvider): OpenAI {
  const key = (provider.apiKey ?? "").trim();
  if (!key) {
    throw new Error(
      "API key is missing. Edit the provider and paste your API key."
    );
  }
  const { baseURL, proxied, targetHeader } = resolveBaseURL(provider.baseURL);

  // When going through the proxy we override the SDK's `fetch` so we can
  // GUARANTEE `x-provider-key` is set on EVERY request (POST, streaming, all
  // of them). The proxy rewrites this header into `Authorization: Bearer
  // <key>` before forwarding to the upstream provider.
  const customFetch = proxied
    ? (async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        headers.set("x-provider-key", key);
        if (targetHeader) {
          // Append ?target=<upstream-base> so the proxy knows where to route
          // custom endpoints. Must live on the URL because Edge functions
          // route by path, not by header.
          const targetUrl =
            typeof input === "string" || input instanceof URL
              ? new URL(input.toString())
              : new URL(input.url);
          if (!targetUrl.searchParams.has("target")) {
            targetUrl.searchParams.set("target", targetHeader);
          }
          input = targetUrl.toString();
        }
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

export interface TestResult {
  ok: boolean;
  message: string;
  modelCount?: number;
}

export async function testConnection(
  provider: ConnectedProvider
): Promise<TestResult> {
  try {
    const client = createClient(provider);
    const res = await client.models.list();
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

export function extractErrorMessage(err: unknown): string {
  if (!err) return "Unknown error.";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyErr = err as any;
  const status = anyErr?.status ?? anyErr?.response?.status;
  const bodyMsg =
    anyErr?.error?.message ??
    anyErr?.response?.data?.error?.message ??
    anyErr?.response?.data?.message ??
    anyErr?.message;
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
  const client = createClient(provider);
  const res = await client.models.list();
  return (res.data ?? []).map((m) => {
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
