import { createHash, randomBytes } from "node:crypto";
import { getDb, isFirebaseAdminReady } from "./firebase-admin.js";
import {
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
  const result = await createLocalApiKey(uid, label, nowMs);

  if (isFirebaseAdminReady()) {
    try {
      await getDb().collection("apiKeys").doc(result.record.id).set({
        ...result.record,
        uid,
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
        .where("uid", "==", uid)
        .get();
      if (!snap.empty) {
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
          .filter((k) => !k.revoked)
          .sort((a, b) => b.createdAt - a.createdAt);
        return firestoreList;
      }
    } catch (err) {
      console.warn("[api-keys] Firestore listApiKeys failed, checking local:", err);
    }
  }

  return listLocalApiKeys(uid);
}

/** Revoke a key by its hash id. Only the owning user may revoke it. */
export async function revokeApiKey(uid: string, id: string): Promise<boolean> {
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

  if (isFirebaseAdminReady()) {
    try {
      const hash = hashKey(raw);
      const snap = await getDb().collection("apiKeys").doc(hash).get();
      if (snap.exists) {
        const r = snap.data() as ApiKeyRecord;
        if (!r.revoked) {
          if (r.uid) return r.uid;

          // Auto-heal legacy keys without stored uid
          try {
            const usersSnap = await getDb().collection("users").limit(5).get();
            if (!usersSnap.empty) {
              const targetUid = usersSnap.docs[0].id;
              await snap.ref.set({ uid: targetUid }, { merge: true });
              return targetUid;
            }
          } catch {}
        }
      }
    } catch (err) {
      console.warn("[api-keys] Firestore resolveApiKey failed, checking local:", err);
    }
  }

  return resolveLocalApiKey(raw);
}
