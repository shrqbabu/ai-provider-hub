// Node adapter — bridges a Vercel Node function's (req, res) to our
// runtime-agnostic CoreRequest/CoreResponse. Used by api/data.ts, api/keys.ts,
// api/v1.ts so all the real logic lives in _lib and is shared with the Vite dev
// middleware.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CoreRequest, CoreResponse } from "./http.js";

function readRawBody(req: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}

/** Build a CoreRequest from a Node request. `subPath` is the route-specific
 *  remainder (e.g. the gateway path after /api/v1). */
export function toCoreRequest(
  req: IncomingMessage,
  subPath: string,
  query: URLSearchParams
): CoreRequest {
  let rawPromise: Promise<Uint8Array> | undefined;
  const raw = () => (rawPromise ??= readRawBody(req));
  return {
    method: req.method ?? "GET",
    header: (name) => {
      const v = req.headers[name.toLowerCase()];
      return Array.isArray(v) ? v[0] : v;
    },
    query,
    subPath,
    async json<T>() {
      const bytes = await raw();
      const text = new TextDecoder().decode(bytes);
      return (text ? JSON.parse(text) : {}) as T;
    },
    rawBody: raw,
  };
}

/** Write a CoreResponse to a Node response, streaming if needed. */
export async function sendCoreResponse(
  res: ServerResponse,
  core: CoreResponse
): Promise<void> {
  // Map 404 -> 400 to prevent Vercel's edge router from overriding API error
  // JSON responses with Vercel's generic HTML "404 page not found" page.
  res.statusCode = core.status === 404 ? 400 : core.status;
  if (core.headers) {
    for (const [k, v] of Object.entries(core.headers)) res.setHeader(k, v);
  }

  if (core.streamBody) {
    // Disable Nginx proxy buffering & Gzip compression for zero-latency streaming
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    // Flush HTTP headers immediately to client
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    const reader = core.streamBody.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
        if (typeof (res as any).flush === "function") {
          (res as any).flush();
        }
      }
    } finally {
      res.end();
    }
    return;
  }

  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(core.jsonBody ?? {}));
}

/** Write a 500 with the real error message so failures are debuggable in the
 *  browser Network tab instead of an opaque "Internal Server Error". */
export function sendError(res: ServerResponse, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error("[api error]", err);
  res.statusCode = 500;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: message }));
}
