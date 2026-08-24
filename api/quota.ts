// /api/quota — provider account quota snapshot (Antigravity cloudcode-pa).
// Node runtime.
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleQuota } from "./_lib/quota-core.js";
import { sendCoreResponse, toCoreRequest, sendError } from "./_lib/node-adapter.js";

export const config = { runtime: "nodejs" };

export default async function handler(
  req: IncomingMessage & { url?: string },
  res: ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const core = toCoreRequest(req, "", url.searchParams);
    const result = await handleQuota(core, Date.now());
    await sendCoreResponse(res, result);
  } catch (err) {
    sendError(res, err);
  }
}
