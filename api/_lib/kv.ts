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
  if (isFirebaseAdminReady()) {
    try {
      const snap = await docRef(uid, key).get();
      if (snap.exists) {
        const data = snap.data();
        if (data !== undefined) {
          const val = data.v ?? data.value ?? data.data;
          if (val !== undefined) return val as T;
          if (typeof data === "object" && data !== null) {
            return data as T;
          }
        }
      }
    } catch (err) {
      console.warn(`[kv] Firestore read for ${key} failed, checking local:`, err);
    }
  }
  return readLocalKV<T>(uid, key, fallback);
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
