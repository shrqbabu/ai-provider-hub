// /api/keys — gateway "ah-…" key management. Node runtime.
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleKeys } from "./_lib/keys-core";
import { sendCoreResponse, toCoreRequest, sendError } from "./_lib/node-adapter";

export const config = { runtime: "nodejs" };

export default async function handler(
  req: IncomingMessage & { url?: string },
  res: ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const core = toCoreRequest(req, "", url.searchParams);
    const result = await handleKeys(core, Date.now());
    await sendCoreResponse(res, result);
  } catch (err) {
    sendError(res, err);
  }
}
