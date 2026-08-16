import { requireUser } from "./auth.js";
import { readKV, writeKV } from "./kv.js";
import { listApiKeys } from "./api-keys.js";
import { getAllLocalKV } from "./local-db.js";
import { jsonResponse, type CoreRequest, type CoreResponse } from "./http.js";

const STORE_KEYS = [
  "providers",
  "models",
  "combos",
  "keystore",
  "chats",
];

export async function handleBackup(
  req: CoreRequest,
  nowMs: number
): Promise<CoreResponse> {
  const uid = await requireUser(req);
  if (!uid) return jsonResponse(401, { error: "Unauthorized" });

  const method = req.method.toUpperCase();

  // Export
  if (method === "GET") {
    const data: Record<string, unknown> = {
      version: 1,
      exportedAt: nowMs,
    };

    // Read all store keys
    for (const key of STORE_KEYS) {
      const val = await readKV<unknown>(uid, key, null);
      if (val !== null) {
        data[key] = val;
      }
    }

    // Also include local KV items if any
    const localAll = await getAllLocalKV(uid);
    for (const [k, v] of Object.entries(localAll)) {
      if (data[k] === undefined && v !== null) {
        data[k] = v;
      }
    }

    // Include gateway keys metadata
    try {
      const keys = await listApiKeys(uid);
      data["gatewayKeys"] = keys;
    } catch {
      // ignore
    }

    return jsonResponse(200, { data });
  }

  // Import
  if (method === "PUT" || method === "POST") {
    let payload: { data?: Record<string, unknown>; overwrite?: boolean };
    try {
      payload = await req.json<{ data?: Record<string, unknown>; overwrite?: boolean }>();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON payload." });
    }

    const incoming = payload.data || {};
    let restoredCount = 0;

    for (const key of STORE_KEYS) {
      if (incoming[key] !== undefined) {
        await writeKV(uid, key, incoming[key], nowMs);
        restoredCount++;
      }
    }

    return jsonResponse(200, {
      ok: true,
      message: `Successfully imported ${restoredCount} datasets.`,
      restoredCount,
    });
  }

  return jsonResponse(405, { error: "Method not allowed." });
}
