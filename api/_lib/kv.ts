// Per-user key/value store backed by Firestore. Mirrors the shape the frontend
// stores previously kept in localforage — each store (providers, models, chats,
// prompts, usage, settings) is one document holding a JSON blob under
// users/{uid}/kv/{key}. Swapping the frontend `storage` service to call these
// keeps every existing Zustand store working unchanged.
import { getDb } from "./firebase-admin.js";

// Firestore rejects top-level arrays, so we wrap every value in { v: ... }.
interface KVDoc {
  v: unknown;
  updatedAt: number;
}

function docRef(uid: string, key: string) {
  return getDb().collection("users").doc(uid).collection("kv").doc(key);
}

export async function readKV<T>(uid: string, key: string, fallback: T): Promise<T> {
  const snap = await docRef(uid, key).get();
  if (!snap.exists) return fallback;
  const data = snap.data() as KVDoc | undefined;
  return (data?.v as T) ?? fallback;
}

export async function writeKV(
  uid: string,
  key: string,
  value: unknown,
  nowMs: number
): Promise<void> {
  const doc: KVDoc = { v: value, updatedAt: nowMs };
  await docRef(uid, key).set(doc);
}

export async function deleteKV(uid: string, key: string): Promise<void> {
  await docRef(uid, key).delete();
}
