import { createHash, randomBytes } from "node:crypto";
import { getSupabaseAdmin, isSupabaseAdminReady } from "./supabase-admin.js";
import { getDb, isFirebaseAdminReady } from "./firebase-admin.js";
import {
  createLocalApiKey,
  listLocalApiKeys,
  revokeLocalApiKey,
  resolveLocalApiKey,
} from "./local-db.js";

const PREFIX = "ah-";

// In-memory cache for API key validation (TTL: 60 seconds)
const keyCache = new Map<string, { uid: string | null; expiresAt: number }>();
const KEY_CACHE_TTL = 60000;

export interface ApiKeyRecord {
  uid: string;
  label: string;
  last4: string;
  createdAt: number;
  revoked: boolean;
}

export interface ApiKeyPublic {
  id: string; // the hash - safe to expose, it's not the key
  label: string;
  last4: string;
  createdAt: number;
  revoked: boolean;
}

export function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function genRawKey(): string {
  return PREFIX + randomBytes(30).toString("hex");
}

/** Create a new gateway key for a user. Returns the RAW key (show once) + record. */
export async function createApiKey(
  uid: string,
  label: string,
  nowMs: number
): Promise<{ raw: string; record: ApiKeyPublic }> {
  const result = await createLocalApiKey(uid, label, nowMs);

  // 1. Supabase
  if (isSupabaseAdminReady()) {
    try {
      const supabase = getSupabaseAdmin();
      await supabase.from("api_keys").upsert({
        id: result.record.id,
        user_id: uid || "default_user",
        label: result.record.label,
        last4: result.record.last4,
        created_at: nowMs,
        revoked: false,
      });
    } catch (e) {
      console.warn("[api-keys] Supabase save failed:", e);
    }
  }

  // 2. Firebase
  if (isFirebaseAdminReady()) {
    try {
      await getDb().collection("apiKeys").doc(result.record.id).set({
        ...result.record,
        uid: uid || "default_user",
        createdAt: nowMs,
        revoked: false,
      });
    } catch (e) {
      console.warn("[api-keys] Firestore save failed:", e);
    }
  }

  return result;
}

/** List a user's gateway keys (never returns raw keys). */
export async function listApiKeys(uid: string): Promise<ApiKeyPublic[]> {
  // 1. Supabase
  if (isSupabaseAdminReady()) {
    try {
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("api_keys")
        .select("id, label, last4, created_at, revoked")
        .eq("user_id", uid)
        .eq("revoked", false)
        .order("created_at", { ascending: false });

      if (!error && data && data.length > 0) {
        return data.map((d: any) => ({
          id: d.id,
          label: d.label || "Gateway key",
          last4: d.last4 || "****",
          createdAt: Number(d.created_at) || Date.now(),
          revoked: Boolean(d.revoked),
        }));
      }
    } catch (err) {
      console.warn("[api-keys] Supabase listApiKeys failed, checking fallback:", err);
    }
  }

  // 2. Firebase
  if (isFirebaseAdminReady()) {
    try {
      const snap = await getDb().collection("apiKeys").get();

      if (!snap.empty) {
        let matchedDocs = snap.docs.filter((d) => {
          const r = d.data() as ApiKeyRecord;
          return r.uid === uid && !r.revoked;
        });

        if (matchedDocs.length === 0) {
          matchedDocs = snap.docs.filter((d) => !(d.data() as ApiKeyRecord).revoked);
        }

        const firestoreList = matchedDocs
          .map((d) => {
            const r = d.data() as ApiKeyRecord;
            return {
              id: d.id,
              label: r.label || "Gateway key",
              last4: r.last4 || "****",
              createdAt: r.createdAt || Date.now(),
              revoked: !!r.revoked,
            };
          })
          .sort((a, b) => b.createdAt - a.createdAt);

        if (firestoreList.length > 0) return firestoreList;
      }
    } catch (err) {
      console.warn("[api-keys] Firestore listApiKeys failed, checking local:", err);
    }
  }

  // 3. Local DB
  return listLocalApiKeys(uid);
}

/** Revoke a key by its hash id. */
export async function revokeApiKey(uid: string, id: string): Promise<boolean> {
  keyCache.clear();
  await revokeLocalApiKey(uid, id);

  if (isSupabaseAdminReady()) {
    try {
      const supabase = getSupabaseAdmin();
      await supabase.from("api_keys").update({ revoked: true }).eq("id", id);
    } catch {
      // ignore
    }
  }

  if (isFirebaseAdminReady()) {
    try {
      const ref = getDb().collection("apiKeys").doc(id);
      await ref.delete();
    } catch {
      // ignore
    }
  }
  return true;
}

export async function resolveApiKey(raw: string): Promise<string | null> {
  if (!raw || !raw.startsWith(PREFIX)) return null;

  const cached = keyCache.get(raw);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.uid;
  }

  let resolvedUid: string | null = null;
  const hash = hashKey(raw);

  // 1. Supabase
  if (isSupabaseAdminReady()) {
    try {
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("api_keys")
        .select("user_id, revoked")
        .eq("id", hash)
        .maybeSingle();

      if (!error && data && !data.revoked) {
        resolvedUid = data.user_id || "default_user";
      }
    } catch (err) {
      console.warn("[api-keys] Supabase resolveApiKey failed, checking fallback:", err);
    }
  }

  // 2. Firebase
  if (!resolvedUid && isFirebaseAdminReady()) {
    try {
      const snap = await getDb().collection("apiKeys").doc(hash).get();
      if (snap.exists) {
        const r = snap.data() as ApiKeyRecord;
        if (!r.revoked) {
          resolvedUid = r.uid || "default_user";
        }
      }
    } catch (err) {
      console.warn("[api-keys] Firestore resolveApiKey failed, checking local:", err);
    }
  }

  // 3. Local DB
  if (!resolvedUid) {
    resolvedUid = await resolveLocalApiKey(raw);
  }

  keyCache.set(raw, { uid: resolvedUid, expiresAt: Date.now() + KEY_CACHE_TTL });
  return resolvedUid;
}
