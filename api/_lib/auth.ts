// ID-token auth for user-facing routes (/api/data, /api/keys). The frontend
// sends the Firebase ID token as `Authorization: Bearer <token>`; we verify it
// with the Admin SDK and return the uid.
import { getAdminAuth } from "./firebase-admin.js";
import type { CoreRequest } from "./http.js";

export function bearerToken(req: CoreRequest): string | undefined {
  const h = req.header("authorization") ?? req.header("Authorization");
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : undefined;
}

/** Verify the Firebase ID token on the request. Returns uid, or null if invalid/missing. */
export async function requireUser(req: CoreRequest): Promise<string | null> {
  const token = bearerToken(req);
  if (!token) return null;
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}
