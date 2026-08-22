import { getDb, isFirebaseAdminReady } from "./firebase-admin.js";
import {
  readLocalKV,
  writeLocalKV,
  deleteLocalKV,
} from "./local-db.js";

interface KVDoc {
  v: unknown;
  value?: unknown;
  updatedAt: number;
}

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

  if (isFirebaseAdminReady()) {
    try {
      const snap = await docRef(uid, key).get();
      if (snap.exists) {
        const data = snap.data();
        if (data !== undefined) {
          const val = data.v ?? data.value ?? data.data;
          if (val !== undefined) {
            result = val as T;
          } else if (typeof data === "object" && data !== null) {
            result = data as T;
          }
        }
      } else {
        result = await readLocalKV<T>(uid, key, fallback);
      }
    } catch (err) {
      console.warn(`[kv] Firestore read for ${key} failed, checking local:`, err);
      result = await readLocalKV<T>(uid, key, fallback);
    }
  } else {
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

  if (isFirebaseAdminReady()) {
    try {
      await docRef(uid, key).delete();
    } catch {
      // ignore
    }
  }
}
