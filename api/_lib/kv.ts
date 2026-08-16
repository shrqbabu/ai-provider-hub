import { getDb, isFirebaseAdminReady } from "./firebase-admin.js";
import {
  readLocalKV,
  writeLocalKV,
  deleteLocalKV,
} from "./local-db.js";

// Firestore rejects top-level arrays, so we wrap every value in { v: ... }.
interface KVDoc {
  v: unknown;
  value?: unknown;
  updatedAt: number;
}

function docRef(uid: string, key: string) {
  return getDb().collection("users").doc(uid).collection("kv").doc(key);
}

export async function readKV<T>(uid: string, key: string, fallback: T): Promise<T> {
  let firestoreVal: T | undefined;

  if (isFirebaseAdminReady()) {
    try {
      const snap = await docRef(uid, key).get();
      if (snap.exists) {
        const data = snap.data();
        if (data !== undefined) {
          const val = data.v ?? data.value ?? data.data;
          if (val !== undefined) firestoreVal = val as T;
          else if (typeof data === "object" && data !== null) {
            firestoreVal = data as T;
          }
        }
      }
    } catch (err) {
      console.warn(`[kv] Firestore read for ${key} failed, checking local:`, err);
    }
  }

  if (firestoreVal !== undefined) {
    if (Array.isArray(firestoreVal) && firestoreVal.length === 0) {
      const localVal = await readLocalKV<T>(uid, key, fallback);
      if (Array.isArray(localVal) && localVal.length > 0) return localVal;
      // Also check local_user fallback if uid was different
      const defaultLocal = await readLocalKV<T>("local_user", key, fallback);
      if (Array.isArray(defaultLocal) && defaultLocal.length > 0) return defaultLocal;
    }
    return firestoreVal;
  }

  const localVal = await readLocalKV<T>(uid, key, fallback);
  if (Array.isArray(localVal) && localVal.length > 0) return localVal;

  const defaultLocal = await readLocalKV<T>("local_user", key, fallback);
  if (Array.isArray(defaultLocal) && defaultLocal.length > 0) return defaultLocal;

  return localVal;
}

export async function writeKV(
  uid: string,
  key: string,
  value: unknown,
  nowMs: number
): Promise<void> {
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
  await deleteLocalKV(uid, key);

  if (isFirebaseAdminReady()) {
    try {
      await docRef(uid, key).delete();
    } catch {
      // ignore
    }
  }
}
