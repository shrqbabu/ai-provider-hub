// Remote KV store — the backend for every Zustand store. Data lives in
// Firestore (users/{uid}/kv/{key}), accessed via our Node backend (/api/data)
// so the client never touches Firestore directly (Admin SDK only). Same
// interface as before, so existing stores work unchanged.
import { getIdToken, getAuthUid } from "@/store/auth-store";

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

export const storage = {
  async get<T>(key: string, fallback: T): Promise<T> {
    try {
      const res = await apiCall(`/api/data?key=${encodeURIComponent(key)}`);
      if (!res.ok) return fallback;
      const data = await res.json();
      return (data.value as T) ?? fallback;
    } catch {
      return fallback;
    }
  },

  async set<T>(key: string, value: T): Promise<void> {
    try {
      await apiCall(`/api/data?key=${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify({ value }),
      });
    } catch (err) {
      console.error("storage.set failed:", err);
      throw err;
    }
  },

  async remove(key: string): Promise<void> {
    try {
      await apiCall(`/api/data?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
      });
    } catch (err) {
      console.error("storage.remove failed:", err);
      throw err;
    }
  },

  async clear(): Promise<void> {
    // Not implemented server-side (would need to list all keys). For now, each
    // store clears individually if needed. In practice, logout is the real clear.
    console.warn("storage.clear not implemented (remote KV).");
  },
};
