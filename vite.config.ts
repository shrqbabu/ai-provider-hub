import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import type { IncomingMessage, ServerResponse } from "http";

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

export default defineConfig({
  plugins: [
    react(),
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
                outHeaders[key] = Array.isArray(value) ? value.join(",") : value;
              }
              const providerToken = req.headers["x-provider-key"];
              if (providerToken) {
                outHeaders["Authorization"] = `Bearer ${
                  Array.isArray(providerToken) ? providerToken[0] : providerToken
                }`;
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
