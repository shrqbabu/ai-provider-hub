// /api/backup — full data export and import
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleBackup } from "./_lib/backup-core.js";
import { sendCoreResponse, toCoreRequest, sendError } from "./_lib/node-adapter.js";

export const config = { runtime: "nodejs" };

export default async function handler(
  req: IncomingMessage & { url?: string },
  res: ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const core = toCoreRequest(req, "", url.searchParams);
    const result = await handleBackup(core, Date.now());
    await sendCoreResponse(res, result);
  } catch (err) {
    sendError(res, err);
  }
}
