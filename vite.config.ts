import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import type { IncomingMessage, ServerResponse } from "http";
import { handleData } from "./api/_lib/data-core";
import { handleKeys } from "./api/_lib/keys-core";
import { handleGateway } from "./api/_lib/gateway-core";
import { toCoreRequest, sendCoreResponse } from "./api/_lib/node-adapter";
import type { CoreRequest, CoreResponse } from "./api/_lib/http";

// Dev-mode proxy that mirrors the production Vercel Edge Function
// (api/proxy/[...path].ts). Same URL scheme in both:
//   /api/proxy/openai/v1/chat/completions
//   /api/proxy/nvidia/v1/chat/completions
//   /api/proxy/custom/v1/chat/completions?target=https://x.example.com/v1
// The client sends the API key in `x-provider-key`; both dev and prod
// proxies rewrite it into `Authorization: Bearer <key>`.

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

export default defineConfig(({ mode }) => {
  // Load non-VITE env (e.g. FIREBASE_SERVICE_ACCOUNT) into process.env so the
  // backend _lib code — shared with the Vercel functions — works in dev too.
  const env = loadEnv(mode, process.cwd(), "");
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }

  return {
  plugins: [
    react(),
    // Dev backend — mirrors the Vercel Node functions (api/data.ts, api/keys.ts,
    // api/v1.ts) by calling the exact same _lib core handlers. Registered before
    // the proxy so /api/v1 (gateway) and /api/proxy (CORS) both work in dev.
    {
      name: "ai-provider-hub-dev-backend",
      configureServer(server) {
        const mount = (
          prefix: string,
          handler: (req: CoreRequest, now: number) => Promise<CoreResponse>,
          opts?: { subPathFromUrl?: boolean }
        ) => {
          server.middlewares.use(
            prefix,
            async (req: IncomingMessage, res: ServerResponse) => {
              try {
                const rawUrl = req.url ?? "/";
                const [pathPart, qs = ""] = rawUrl.split("?");
                const query = new URLSearchParams(qs);
                // For the gateway, the sub-path (e.g. "chat/completions") is the
                // URL remainder after the mount prefix.
                const subPath = opts?.subPathFromUrl
                  ? pathPart.replace(/^\//, "")
                  : "";
                const core = toCoreRequest(req, subPath, query);
                const result = await handler(core, Date.now());
                await sendCoreResponse(res, result);
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error(`[dev-backend ${prefix}]`, err);
                res.statusCode = 500;
                res.setHeader("Content-Type", "application/json");
                res.end(
                  JSON.stringify({
                    error: err instanceof Error ? err.message : "Server error",
                  })
                );
              }
            }
          );
        };

        mount("/api/data", handleData);
        mount("/api/keys", handleKeys);
        mount("/api/v1", handleGateway, { subPathFromUrl: true });
      },
    },
    {
      name: "ai-provider-hub-dev-proxy",
      configureServer(server) {
        server.middlewares.use(
          "/api/proxy",
          async (req: IncomingMessage, res: ServerResponse) => {
            try {
              const rawUrl = req.url ?? "/";
              // rawUrl starts with "/..." after the mount prefix "/api/proxy"
              const [pathPart, qs = ""] = rawUrl.split("?");
              const [providerKey, ...rest] = pathPart
                .replace(/^\//, "")
                .split("/");
              const upstreamPath = "/" + rest.join("/");

              let upstreamBase: string | undefined = TARGETS[providerKey];
              const params = new URLSearchParams(qs);
              if (providerKey === "custom") {
                const target = params.get("target");
                if (!target) {
                  send(res, 400, {
                    error: "Missing ?target=<base-url>",
                  });
                  return;
                }
                try {
                  const parsed = new URL(target);
                  upstreamBase = `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, "")}`;
                } catch {
                  send(res, 400, { error: "Invalid ?target URL" });
                  return;
                }
              }
              if (!upstreamBase) {
                send(res, 400, {
                  error: `Unknown provider "${providerKey}"`,
                });
                return;
              }

              params.delete("target");
              const q = params.toString();
              const targetURL = upstreamBase + upstreamPath + (q ? "?" + q : "");

              const outHeaders: Record<string, string> = {};
              for (const [key, value] of Object.entries(req.headers)) {
                if (!value) continue;
                const k = key.toLowerCase();
                if (HOP_BY_HOP.has(k)) continue;
                if (k === "host" || k === "origin" || k === "referer") continue;
                if (k === "x-provider-key") continue;
                if (k === "x-provider-cookie") continue;
                outHeaders[key] = Array.isArray(value) ? value.join(",") : value;
              }
              const providerToken = req.headers["x-provider-key"];
              if (providerToken) {
                const token = Array.isArray(providerToken)
                  ? providerToken[0]
                  : providerToken;
                // Anthropic Messages uses x-api-key; everything else Bearer.
                // Mirror api/proxy.ts (prod) so dev behaves identically.
                if (
                  providerKey === "anthropic" ||
                  upstreamPath.includes("/messages")
                ) {
                  outHeaders["x-api-key"] = token;
                } else {
                  outHeaders["Authorization"] = `Bearer ${token}`;
                }
              }
              // Cookie-based auth (see api/proxy.ts): rewrite x-provider-cookie
              // into a real Cookie header on the upstream request.
              const providerCookie = req.headers["x-provider-cookie"];
              if (providerCookie) {
                outHeaders["Cookie"] = Array.isArray(providerCookie)
                  ? providerCookie[0]
                  : providerCookie;
              }

              const method = (req.method ?? "GET").toUpperCase();
              const hasBody = method !== "GET" && method !== "HEAD";

              const body = hasBody ? await readBody(req) : undefined;

              const upstream = await fetch(targetURL, {
                method,
                headers: outHeaders,
                body: body as BodyInit | undefined,
                redirect: "follow",
              });

              // eslint-disable-next-line no-console
              console.log(
                `[proxy] ${method} ${providerKey}${upstreamPath} → ${upstream.status}`
              );

              res.statusCode = upstream.status;
              upstream.headers.forEach((v, k) => {
                const lk = k.toLowerCase();
                if (HOP_BY_HOP.has(lk)) return;
                if (lk === "content-encoding" || lk === "content-length")
                  return;
                res.setHeader(k, v);
              });

              // Don't stream HTML error pages back — return a readable JSON
              // error instead (same guard as api/proxy.ts in prod).
              const ctype = upstream.headers.get("content-type") ?? "";
              if (ctype.includes("text/html")) {
                const htmlText = await upstream
                  .text()
                  .catch(() => "");
                send(res, upstream.status, {
                  error: `Upstream returned an HTML page instead of an API response (${upstream.status}). Check the Base URL (include /v1) and that it's an API endpoint, not a website.${
                    htmlText ? ` HTML: ${htmlText.slice(0, 200)}` : ""
                  }`,
                });
                return;
              }

              if (!upstream.body) {
                res.end();
                return;
              }
              const reader = upstream.body.getReader();
              const pump = async (): Promise<void> => {
                const { value, done } = await reader.read();
                if (done) {
                  res.end();
                  return;
                }
                res.write(Buffer.from(value));
                return pump();
              };
              await pump();
            } catch (err) {
              // eslint-disable-next-line no-console
              console.error("[proxy error]", err);
              send(res, 502, {
                error: err instanceof Error ? err.message : "Proxy failed",
              });
            }
          }
        );
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    target: "es2020",
    minify: "esbuild",
    sourcemap: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 2000,
  },
  };
});

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}
