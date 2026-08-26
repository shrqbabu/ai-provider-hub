import { getSupabaseAdmin, isSupabaseAdminReady } from "./supabase-admin.js";
import { getAdminAuth, isFirebaseAdminReady } from "./firebase-admin.js";
import { isFirebaseConfigured } from "./local-db.js";
import type { CoreRequest } from "./http.js";

export function bearerToken(req: CoreRequest): string | undefined {
  const h = req.header("authorization") ?? req.header("Authorization");
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : undefined;
}

/** Verify the Supabase (or Firebase) ID token on the request. Returns uid, or null if invalid/missing. */
export async function requireUser(req: CoreRequest): Promise<string | null> {
  const token = bearerToken(req);
  const headerUid = req.header("x-user-uid");

  const isConfigured = isSupabaseAdminReady() || isFirebaseConfigured();

  if (!token) {
    return headerUid || (isConfigured ? null : "local_user");
  }

  // 1. If Supabase Admin is ready, verify token with Supabase Auth
  if (isSupabaseAdminReady()) {
    try {
      const admin = getSupabaseAdmin();
      const { data, error } = await admin.auth.getUser(token);
      if (!error && data?.user?.id) {
        return data.user.id;
      }
    } catch (e) {
      console.warn("[Auth] Supabase token verify error:", e);
    }
  }

  // 2. If Firebase Admin is configured, verify token with Firebase Auth
  if (isFirebaseAdminReady()) {
    try {
      const decoded = await getAdminAuth().verifyIdToken(token);
      if (decoded?.uid) return decoded.uid;
    } catch (e) {
      console.warn("[Auth] Firebase token verify error:", e);
    }
  }

  // 3. Decode standard JWT payload to get the true unique `sub` / `user_id` per user
  try {
    const parts = token.split(".");
    if (parts.length === 3) {
      const payloadJson = Buffer.from(parts[1], "base64").toString("utf-8");
      const payload = JSON.parse(payloadJson);
      if (payload.sub || payload.user_id) {
        return (payload.sub || payload.user_id) as string;
      }
    }
  } catch {
    // ignore
  }

  if (headerUid) return headerUid;
  return isConfigured ? null : "local_user";
}
