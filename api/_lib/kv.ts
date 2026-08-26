import { getSupabaseAdmin, isSupabaseAdminReady } from "./supabase-admin.js";
import { getDb, isFirebaseAdminReady } from "./firebase-admin.js";
import {
  readLocalKV,
  writeLocalKV,
  deleteLocalKV,
} from "./local-db.js";

// In-memory TTL cache for KV reads (TTL: 30 seconds)
const CacheTTL = 30000;
const memoryCache = new Map<string, { val: unknown; expiresAt: number }>();

function docRef(uid: string, key: string) {
  return getDb().collection("users").doc(uid).collection("kv").doc(key);
}

export async function readKV<T>(uid: string, key: string, fallback: T): Promise<T> {
  const cacheKey = `${uid}:${key}`;
  const cached = memoryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.val as T;
  }

  let result: T = fallback;
  let resolvedFromCloud = false;

  // 1. Try Supabase
  if (isSupabaseAdminReady()) {
    try {
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("user_kv_store")
        .select("value")
        .eq("user_id", uid)
        .eq("key", key)
        .maybeSingle();

      if (!error && data && data.value !== undefined && data.value !== null) {
        result = data.value as T;
        resolvedFromCloud = true;
      }
    } catch (err) {
      console.warn(`[kv] Supabase read for ${key} failed, checking fallback:`, err);
    }
  }

  // 2. Try Firebase (if Supabase didn't resolve)
  if (!resolvedFromCloud && isFirebaseAdminReady()) {
    try {
      const snap = await docRef(uid, key).get();
      if (snap.exists) {
        const data = snap.data();
        if (data !== undefined) {
          const val = data.v ?? data.value ?? data.data;
          if (val !== undefined) {
            result = val as T;
            resolvedFromCloud = true;
          } else if (typeof data === "object" && data !== null) {
            result = data as T;
            resolvedFromCloud = true;
          }
        }
      }
    } catch (err) {
      console.warn(`[kv] Firestore read for ${key} failed, checking local:`, err);
    }
  }

  // 3. Try Local DB (if cloud didn't resolve)
  if (!resolvedFromCloud) {
    result = await readLocalKV<T>(uid, key, fallback);
  }

  memoryCache.set(cacheKey, { val: result, expiresAt: Date.now() + CacheTTL });
  return result;
}

export async function writeKV(
  uid: string,
  key: string,
  value: unknown,
  nowMs: number
): Promise<void> {
  const cacheKey = `${uid}:${key}`;
  memoryCache.set(cacheKey, { val: value, expiresAt: Date.now() + CacheTTL });

  // Always update local disk DB as cache
  await writeLocalKV(uid, key, value, nowMs);

  // Write to Supabase
  if (isSupabaseAdminReady()) {
    try {
      const supabase = getSupabaseAdmin();
      await supabase.from("user_kv_store").upsert(
        {
          user_id: uid,
          key,
          value,
          updated_at: new Date(nowMs).toISOString(),
        },
        { onConflict: "user_id,key" }
      );
    } catch (err) {
      console.warn(`[kv] Supabase write for ${key} failed:`, err);
    }
  }

  // Write to Firebase
  if (isFirebaseAdminReady()) {
    try {
      const doc = { v: value, value: value, updatedAt: nowMs };
      await docRef(uid, key).set(doc, { merge: true });
    } catch (err) {
      console.warn(`[kv] Firestore write for ${key} failed:`, err);
    }
  }
}

export async function deleteKV(uid: string, key: string): Promise<void> {
  const cacheKey = `${uid}:${key}`;
  memoryCache.delete(cacheKey);

  await deleteLocalKV(uid, key);

  if (isSupabaseAdminReady()) {
    try {
      const supabase = getSupabaseAdmin();
      await supabase.from("user_kv_store").delete().eq("user_id", uid).eq("key", key);
    } catch (err) {
      console.warn(`[kv] Supabase delete for ${key} failed:`, err);
    }
  }

  if (isFirebaseAdminReady()) {
    try {
      await docRef(uid, key).delete();
    } catch {
      // ignore
    }
  }
}
