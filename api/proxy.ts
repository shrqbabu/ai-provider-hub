// Vercel Edge Function — proxies browser requests to the target AI provider.
// Injects Authorization from the client's `x-provider-key` header, and passes
// SSE streaming responses back unchanged so OpenAI SDK streaming works.
//
// URL scheme (matches Vite dev middleware):
//   /api/proxy/openai/v1/models
//   /api/proxy/nvidia/v1/chat/completions
//   /api/proxy/anthropic/v1/messages
//   /api/proxy/openrouter/api/v1/models
//   /api/proxy/custom/<path>?target=<upstream-base>
//
// vercel.json rewrites /api/proxy/(.*) → /api/proxy?__p=$1 so this single
// function handles every provider path.

export const config = { runtime: "edge" };

const TARGETS: Record<string, string> = {
  openai: "https://api.openai.com",
  nvidia: "https://integrate.api.nvidia.com",
  anthropic: "https://api.anthropic.com",
  openrouter: "https://openrouter.ai",
};

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

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // Path can come from either the rewrite (__p query) or the original pathname.
  let rawPath = url.searchParams.get("__p") ?? "";
  if (!rawPath) {
    const m = url.pathname.match(/^\/api\/proxy\/?(.*)$/);
    rawPath = m ? m[1] : "";
  }
  if (!rawPath) {
    return json({ error: "Missing proxy path." }, 400);
  }

  const [providerKey, ...rest] = rawPath.split("/");
  const upstreamPath = "/" + rest.join("/");

  let upstreamBase: string | undefined = TARGETS[providerKey];
  if (providerKey === "custom") {
    const target = url.searchParams.get("target");
    if (!target) return json({ error: "Missing ?target=<base-url>" }, 400);
    try {
      const parsed = new URL(target);
      upstreamBase = `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, "")}`;
    } catch {
      return json({ error: "Invalid ?target URL" }, 400);
    }
  }
  if (!upstreamBase) {
    return json({ error: `Unknown provider "${providerKey}"` }, 400);
  }

  const forwardedParams = new URLSearchParams(url.searchParams);
  forwardedParams.delete("target");
  forwardedParams.delete("__p");
  const qs = forwardedParams.toString();
  const targetURL = upstreamBase + upstreamPath + (qs ? "?" + qs : "");

  const outHeaders = new Headers();
  req.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (HOP_BY_HOP.has(k)) return;
    if (k === "host" || k === "origin" || k === "referer") return;
    if (k === "x-provider-key") return;
    if (k === "x-provider-cookie") return;
    if (k.startsWith("x-vercel-") || k.startsWith("cf-")) return;
    outHeaders.set(key, value);
  });

  const providerToken = req.headers.get("x-provider-key");
  if (providerToken) {
    outHeaders.set("Authorization", `Bearer ${providerToken}`);
  }

  // Cookie-based auth: client sends the cookie string in x-provider-cookie
  // (browsers can't set the Cookie header directly from fetch). We rewrite it
  // into a real Cookie header on the upstream request.
  const providerCookie = req.headers.get("x-provider-cookie");
  if (providerCookie) {
    outHeaders.set("Cookie", providerCookie);
  }

  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  try {
    const upstream = await fetch(targetURL, {
      method,
      headers: outHeaders,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: "follow",
    });

    const respHeaders = new Headers();
    upstream.headers.forEach((v, k) => {
      const lk = k.toLowerCase();
      if (HOP_BY_HOP.has(lk)) return;
      if (lk === "content-encoding" || lk === "content-length") return;
      respHeaders.set(k, v);
    });

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Proxy fetch failed" },
      502
    );
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
