// /api/data — per-user KV store (frontend storage backend). Node runtime
// because firebase-admin doesn't run on the edge.
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleData } from "./_lib/data-core";
import { sendCoreResponse, toCoreRequest } from "./_lib/node-adapter";

export const config = { runtime: "nodejs" };

export default async function handler(
  req: IncomingMessage & { url?: string },
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const core = toCoreRequest(req, "", url.searchParams);
  const result = await handleData(core, Date.now());
  await sendCoreResponse(res, result);
}
