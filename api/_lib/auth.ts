import { getAdminAuth } from "./firebase-admin.js";
import { isFirebaseConfigured } from "./local-db.js";
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

  // In self-hosted VPS mode (no Firebase service account), all data belongs to the local user
  if (!isFirebaseConfigured()) {
    if (!token) return "local_user";
    // If client sent a token/dummy token, accept it
    return token.length > 30 ? token.slice(0, 28) : "local_user";
  }

  if (!token) return null;
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}
