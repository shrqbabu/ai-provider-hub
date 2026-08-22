import { createHash, randomBytes } from "node:crypto";
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
  const result = await createLocalApiKey(uid, label, nowMs);

  if (isFirebaseAdminReady()) {
    try {
      await getDb().collection("apiKeys").doc(result.record.id).set({
        ...result.record,
        uid: uid || "default_user",
        createdAt: nowMs,
        revoked: false,
      });
    } catch (e) {
      console.warn("[api-keys] Firestore save failed, saved to local db:", e);
    }
  }

  return result;
}

/** List a user's gateway keys (never returns raw keys). */
export async function listApiKeys(uid: string): Promise<ApiKeyPublic[]> {
  if (isFirebaseAdminReady()) {
    try {
      const snap = await getDb()
        .collection("apiKeys")
        .get();

      if (!snap.empty) {
        // First get keys directly belonging to this uid
        let matchedDocs = snap.docs.filter((d) => {
          const r = d.data() as ApiKeyRecord;
          return r.uid === uid && !r.revoked;
        });

        // If user has no keys under this exact UID (e.g. created before sign-in or after session reset),
        // include all active keys from this Firebase project so keys never disappear!
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

  return listLocalApiKeys(uid);
}

/** Revoke a key by its hash id. */
export async function revokeApiKey(uid: string, id: string): Promise<boolean> {
  keyCache.clear();
  await revokeLocalApiKey(uid, id);
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

  if (isFirebaseAdminReady()) {
    try {
      const hash = hashKey(raw);
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

  if (!resolvedUid) {
    resolvedUid = await resolveLocalApiKey(raw);
  }

  keyCache.set(raw, { uid: resolvedUid, expiresAt: Date.now() + KEY_CACHE_TTL });
  return resolvedUid;
}
