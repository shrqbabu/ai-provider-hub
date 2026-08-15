import { getDb } from "./firebase-admin.js";
import {
  isFirebaseConfigured,
  readLocalKV,
  writeLocalKV,
  deleteLocalKV,
} from "./local-db.js";

// Firestore rejects top-level arrays, so we wrap every value in { v: ... }.
interface KVDoc {
  v: unknown;
  updatedAt: number;
}

function docRef(uid: string, key: string) {
  return getDb().collection("users").doc(uid).collection("kv").doc(key);
}

export async function readKV<T>(uid: string, key: string, fallback: T): Promise<T> {
  if (!isFirebaseConfigured()) {
    return readLocalKV<T>(uid, key, fallback);
  }
  try {
    const snap = await docRef(uid, key).get();
    if (!snap.exists) return fallback;
    const data = snap.data() as KVDoc | undefined;
    return (data?.v as T) ?? fallback;
  } catch {
    return readLocalKV<T>(uid, key, fallback);
  }
}

export async function writeKV(
  uid: string,
  key: string,
  value: unknown,
  nowMs: number
): Promise<void> {
  // Always update local disk DB
  await writeLocalKV(uid, key, value, nowMs);

  if (isFirebaseConfigured()) {
    try {
      const doc: KVDoc = { v: value, updatedAt: nowMs };
      await docRef(uid, key).set(doc);
    } catch (err) {
      console.warn("[kv] Firestore write failed, stored in local DB:", err);
    }
  }
}

export async function deleteKV(uid: string, key: string): Promise<void> {
  await deleteLocalKV(uid, key);

  if (isFirebaseConfigured()) {
    try {
      await docRef(uid, key).delete();
    } catch {
      // ignore
    }
  }
}
