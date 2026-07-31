// /api/v1 — the OpenAI-compatible gateway the user calls with their own "ah-…"
// key. vercel.json rewrites /api/v1/:path* → /api/v1?__p=:path*, so the gateway
// sub-path (e.g. "chat/completions") arrives in the __p query param. Node
// runtime + streaming passthrough for SSE.
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleGateway } from "./_lib/gateway-core.js";
import { sendCoreResponse, toCoreRequest, sendError } from "./_lib/node-adapter.js";

export const config = { runtime: "nodejs" };

export default async function handler(
  req: IncomingMessage & { url?: string },
  res: ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    // Path can come from the rewrite (__p) or the raw pathname.
    let subPath = url.searchParams.get("__p") ?? "";
    if (!subPath) {
      const m = url.pathname.match(/^\/api\/v1\/?(.*)$/);
      subPath = m ? m[1] : "";
    }
    const core = toCoreRequest(req, subPath, url.searchParams);
    const result = await handleGateway(core, Date.now());
    await sendCoreResponse(res, result);
  } catch (err) {
    sendError(res, err);
  }
}
