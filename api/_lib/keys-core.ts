// Keys core — CRUD for the user's gateway "ah-…" keys. Auth via Firebase ID
// token. The raw key is returned only on creation and never stored in the clear.
//
//   GET    /api/keys            → { keys: [...] }   (metadata only)
//   POST   /api/keys            → body { label? }, returns { raw, key }
//   DELETE /api/keys?id=<hash>  → revokes
import { requireUser } from "./auth";
import { createApiKey, listApiKeys, revokeApiKey } from "./api-keys";
import { jsonResponse, type CoreRequest, type CoreResponse } from "./http";

export async function handleKeys(
  req: CoreRequest,
  nowMs: number
): Promise<CoreResponse> {
  const uid = await requireUser(req);
  if (!uid) return jsonResponse(401, { error: "Unauthorized" });

  const method = req.method.toUpperCase();

  if (method === "GET") {
    const keys = await listApiKeys(uid);
    return jsonResponse(200, { keys });
  }

  if (method === "POST") {
    let label = "Gateway key";
    try {
      const body = await req.json<{ label?: string }>();
      if (body?.label) label = String(body.label).slice(0, 60);
    } catch {
      // no body → default label
    }
    const { raw, record } = await createApiKey(uid, label, nowMs);
    return jsonResponse(201, { raw, key: record });
  }

  if (method === "DELETE") {
    const id = req.query.get("id");
    if (!id) return jsonResponse(400, { error: "Missing `id`." });
    const ok = await revokeApiKey(uid, id);
    return jsonResponse(ok ? 200 : 404, { ok });
  }

  return jsonResponse(405, { error: "Method not allowed." });
}
