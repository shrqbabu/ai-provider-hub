// Remote KV store — the backend for every Zustand store. Data lives in
// Firestore (users/{uid}/kv/{key}), accessed via our Node backend (/api/data)
// so the client never touches Firestore directly (Admin SDK only). Same
// interface as before, so existing stores work unchanged.
//
// When Firebase is not configured or auth fails, falls back to localStorage
// so the app works fully offline/locally without any cloud dependency.
//
// Reliability: writes are serialized through a promise queue so concurrent
// stores can't complete out of order and clobber newer data, and a non-2xx
// server response throws instead of silently dropping the write.
import { getIdToken, getAuthUid, getEffectiveUid } from "@/store/auth-store";

const LOCAL_STORAGE_PREFIX = "ai-provider-hub:";

// Scope every client-side key by user so two different users on the same
// browser/device never see (or overwrite) each other's data.
function localKey(key: string): string {
  return `${LOCAL_STORAGE_PREFIX}${getEffectiveUid()}:${key}`;
}

function localGet<T>(key: string, fallback: T): T {
  // 1. Current uid-scoped key
  try {
    const raw = localStorage.getItem(localKey(key));
    if (raw) {
      const parsed = JSON.parse(raw) as T;
      if (parsed !== undefined && parsed !== null) return parsed;
    }
  } catch {
    // ignore parse errors
  }

  // 2. Legacy un-scoped key (pre-uid-scoping builds stored data at
  //    "ai-provider-hub:<key>"). Adopt & migrate it so existing users don't
  //    "lose" their providers/combos/keystore after the format change.
  try {
    const legacyRaw = localStorage.getItem(LOCAL_STORAGE_PREFIX + key);
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw) as T;
      if (parsed !== undefined && parsed !== null) {
        localSet(key, parsed); // migrate to the scoped key
        return parsed;
      }
    }
  } catch {
    // ignore
  }

  return fallback;
}

function localSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(localKey(key), JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

function localRemove(key: string): void {
  try {
    localStorage.removeItem(localKey(key));
  } catch {
    // ignore
  }
}

// Serialize remote writes per-key so an in-flight write from an older snapshot
// can't resolve after a newer one and overwrite it.
const writeQueues: Record<string, Promise<unknown>> = {};

function enqueueWrite<T>(key: string, work: () => Promise<T>): Promise<T> {
  const prev = writeQueues[key] ?? Promise.resolve();
  const next = prev.then(work).catch((e) => {
    // Surface the error to the caller of the failing write
    console.error(`storage write "${key}" failed:`, e);
    throw e;
  });
  // Keep the chain alive (never reject the shared tail), so a single failed
  // write doesn't poison the queue for later writes.
  writeQueues[key] = next.catch(() => {});
  return next;
}

async function apiCall(
  endpoint: string,
  options?: RequestInit,
  retries = 2
): Promise<Response> {
  const token = await getIdToken();
  const uid = getAuthUid();
  const headers = new Headers(options?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (uid) headers.set("x-user-uid", uid);
  headers.set("Content-Type", "application/json");

  try {
    return await fetch(endpoint, { ...options, headers });
  } catch (err) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 400));
      return apiCall(endpoint, options, retries - 1);
    }
    throw err;
  }
}

function useRemote(): boolean {
  // Use remote storage only if Firebase is configured AND we have a valid auth token/uid
  return typeof window !== "undefined" && !!getAuthUid();
}

// Treat null / missing / empty array / empty object as "empty".
function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

export const storage = {
  async get<T>(key: string, fallback: T): Promise<T> {
    // Local is the instant, crash-safe copy; remote is the backup/sync source.
    const localValue = localGet<T>(key, fallback);

    if (useRemote()) {
      try {
        const res = await apiCall(`/api/data?key=${encodeURIComponent(key)}`);
        if (res.ok) {
          const data = await res.json();
          const remoteValue = (data.value as T) ?? fallback;

          // Remote has data → remote is authoritative (cross-device backup).
          if (!isEmptyValue(remoteValue)) {
            localSet(key, remoteValue);
            return remoteValue;
          }

          // Remote is empty but local has data → the earlier remote write must
          // have failed. Local wins (NEVER clobber non-empty local with empty
          // remote — that's how data kept disappearing on refresh), and we
          // quietly re-push local back to remote to repair the backup.
          if (!isEmptyValue(localValue)) {
            await apiCall(`/api/data?key=${encodeURIComponent(key)}`, {
              method: "PUT",
              body: JSON.stringify({ value: localValue }),
            }).catch(() => {});
            return localValue;
          }

          // Both empty → genuine fallback.
          return fallback;
        }
      } catch {
        // Network error - return local
      }
    }

    return localValue;
  },

  async set<T>(key: string, value: T): Promise<void> {
    // Always write locally first for instant persistence
    localSet(key, value);

    if (useRemote()) {
      await enqueueWrite(key, async () => {
        const res = await apiCall(`/api/data?key=${encodeURIComponent(key)}`, {
          method: "PUT",
          body: JSON.stringify({ value }),
        });
        if (!res.ok) {
          throw new Error(`Server rejected write (${res.status}) for key "${key}"`);
        }
      });
      // After a successful remote write, reconcile local so they never diverge
      // (e.g. a prior failed write left old local data).
      localSet(key, value);
    }
  },

  async remove(key: string): Promise<void> {
    localRemove(key);

    if (useRemote()) {
      await enqueueWrite(key, async () => {
        const res = await apiCall(`/api/data?key=${encodeURIComponent(key)}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          throw new Error(`Server rejected delete (${res.status}) for key "${key}"`);
        }
      });
    }
  },

  async clear(): Promise<void> {
    // Clear only THIS user's local keys (never other users' on a shared browser)
    const scope = getEffectiveUid();
    const scopePrefix = `${LOCAL_STORAGE_PREFIX}${scope}:`;
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(scopePrefix)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    } catch {
      // ignore
    }

    // Note: remote clear not implemented (would need to list all keys)
    console.warn("storage.clear: remote clear not implemented");
  },
};