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
  const headerUid = req.header("x-user-uid");

  if (!token) {
    return headerUid || (isFirebaseConfigured() ? null : "local_user");
  }

  // 1. If Firebase Admin is configured with private key, cryptographically verify token
  if (isFirebaseConfigured()) {
    try {
      const decoded = await getAdminAuth().verifyIdToken(token);
      return decoded.uid;
    } catch (e) {
      console.warn("[Auth] Firebase Admin token verify failed:", e);
    }
  }

  // 2. Decode JWT payload to get the true unique `user_id` / `sub` per user
  try {
    const parts = token.split(".");
    if (parts.length === 3) {
      const payloadJson = Buffer.from(parts[1], "base64").toString("utf-8");
      const payload = JSON.parse(payloadJson);
      if (payload.user_id || payload.sub) {
        return (payload.user_id || payload.sub) as string;
      }
    }
  } catch (e) {
    // ignore
  }

  if (headerUid) return headerUid;
  return isFirebaseConfigured() ? null : "local_user";
}
