// Gateway API keys — the user's own "ah-…" keys that let them call this app as
// a unified OpenAI-compatible gateway from anywhere (OpenAI SDK, curl, etc.).
//
// The raw key is shown to the user exactly once at creation. We only ever store
// its SHA-256 hash, so a leaked database can't reveal usable keys. Lookup on
// each gateway request hashes the presented key and reads apiKeys/{hash}.
import { createHash, randomBytes } from "node:crypto";
import { getDb } from "./firebase-admin.js";

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
  // 30 bytes → 60 hex chars. Plenty of entropy; prefixed for easy identification.
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
  const record: ApiKeyRecord = {
    uid,
    label: label || "Gateway key",
    last4: raw.slice(-4),
    createdAt: nowMs,
    revoked: false,
  };
  await getDb().collection("apiKeys").doc(hash).set(record);
  return { raw, record: { id: hash, ...record } };
}

/** List a user's gateway keys (never returns raw keys). */
export async function listApiKeys(uid: string): Promise<ApiKeyPublic[]> {
  const snap = await getDb()
    .collection("apiKeys")
    .where("uid", "==", uid)
    .get();
  return snap.docs
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
}

/** Revoke a key by its hash id. Only the owning user may revoke it. */
export async function revokeApiKey(uid: string, id: string): Promise<boolean> {
  const ref = getDb().collection("apiKeys").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const r = snap.data() as ApiKeyRecord;
  if (r.uid !== uid) return false;
  await ref.update({ revoked: true });
  return true;
}

/** Resolve a raw "ah-…" key presented on a gateway request → owning uid, or null. */
export async function resolveApiKey(raw: string): Promise<string | null> {
  if (!raw || !raw.startsWith(PREFIX)) return null;
  const hash = hashKey(raw);
  const snap = await getDb().collection("apiKeys").doc(hash).get();
  if (!snap.exists) return null;
  const r = snap.data() as ApiKeyRecord;
  if (r.revoked) return null;
  return r.uid;
}
