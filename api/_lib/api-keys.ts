import { createHash, randomBytes } from "node:crypto";
import { getDb } from "./firebase-admin.js";
import {
  isFirebaseConfigured,
  createLocalApiKey,
  listLocalApiKeys,
  revokeLocalApiKey,
  resolveLocalApiKey,
} from "./local-db.js";

const PREFIX = "ah-";

export interface ApiKeyRecord {
  uid: string;
  label: string;
  last4: string;
  createdAt: number;
  revoked: boolean;
}

export interface ApiKeyPublic {
  id: string; // the hash — safe to expose, it's not the key
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
  const raw = genRawKey();
  const hash = hashKey(raw);
  const record = {
    id: hash,
    uid,
    label: label || "Gateway key",
    last4: raw.slice(-4),
    createdAt: nowMs,
    revoked: false,
  };

  const db = loadDb();
  db.apiKeys[hash] = record;
  saveDb(db);

  if (isFirebaseConfigured()) {
    try {
      await getDb().collection("apiKeys").doc(hash).set(record);
    } catch (e) {
      console.warn("[api-keys] Firestore save failed, saved to local db:", e);
    }
  }

  return { raw, record };
}

/** List a user's gateway keys (never returns raw keys). */
export async function listApiKeys(uid: string): Promise<ApiKeyPublic[]> {
  const localList = await listLocalApiKeys(uid);
  if (localList.length > 0 || !isFirebaseConfigured()) {
    return localList;
  }
  try {
    const snap = await getDb()
      .collection("apiKeys")
      .where("uid", "==", uid)
      .get();
    const firestoreList = snap.docs
      .map((d) => {
        const r = d.data() as ApiKeyRecord;
        return {
          id: d.id,
          label: r.label,
          last4: r.last4,
          createdAt: r.createdAt,
          revoked: r.revoked,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    return firestoreList.length > 0 ? firestoreList : localList;
  } catch {
    return localList;
  }
}

/** Revoke a key by its hash id. Only the owning user may revoke it. */
export async function revokeApiKey(uid: string, id: string): Promise<boolean> {
  await revokeLocalApiKey(uid, id);
  if (isFirebaseConfigured()) {
    try {
      const ref = getDb().collection("apiKeys").doc(id);
      const snap = await ref.get();
      if (snap.exists) {
        const r = snap.data() as ApiKeyRecord;
        if (r.uid === uid) {
          await ref.update({ revoked: true });
        }
      }
    } catch {
      // ignore
    }
  }
  return true;
}

/** Resolve a raw "ah-…" key presented on a gateway request → owning uid, or null. */
export async function resolveApiKey(raw: string): Promise<string | null> {
  if (!raw || !raw.startsWith(PREFIX)) return null;
  const localRes = await resolveLocalApiKey(raw);
  if (localRes) return localRes;

  if (isFirebaseConfigured()) {
    try {
      const hash = hashKey(raw);
      const snap = await getDb().collection("apiKeys").doc(hash).get();
      if (!snap.exists) return null;
      const r = snap.data() as ApiKeyRecord;
      if (r.revoked) return null;
      return r.uid;
    } catch {
      return null;
    }
  }
  return null;
}
