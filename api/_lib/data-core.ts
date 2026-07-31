// Data core — the backend for the frontend's `storage` service. Every Zustand
// store (providers, models, chats, prompts, usage, settings) reads/writes one
// JSON blob here, keyed by name, scoped to the authenticated user.
//
//   GET    /api/data?key=providers   → { value }
//   PUT    /api/data?key=providers   → body { value }, stores it
//   DELETE /api/data?key=providers   → removes it
//
// Auth: Firebase ID token (Authorization: Bearer <idToken>).
import { requireUser } from "./auth.js";
import { deleteKV, readKV, writeKV } from "./kv.js";
import { jsonResponse, type CoreRequest, type CoreResponse } from "./http.js";

export async function handleData(
  req: CoreRequest,
  nowMs: number
): Promise<CoreResponse> {
  const uid = await requireUser(req);
  if (!uid) return jsonResponse(401, { error: "Unauthorized" });

  const key = req.query.get("key");
  if (!key || !/^[a-zA-Z0-9_-]{1,64}$/.test(key)) {
    return jsonResponse(400, { error: "Invalid or missing `key`." });
  }

  const method = req.method.toUpperCase();

  if (method === "GET") {
    const value = await readKV<unknown>(uid, key, null);
    return jsonResponse(200, { value });
  }

  if (method === "PUT" || method === "POST") {
    let payload: { value: unknown };
    try {
      payload = await req.json<{ value: unknown }>();
    } catch {
      return jsonResponse(400, { error: "Body must be JSON { value }." });
    }
    await writeKV(uid, key, payload.value ?? null, nowMs);
    return jsonResponse(200, { ok: true });
  }

  if (method === "DELETE") {
    await deleteKV(uid, key);
    return jsonResponse(200, { ok: true });
  }

  return jsonResponse(405, { error: "Method not allowed." });
}
