// Client service for the user's gateway "ah-…" keys. Talks to /api/keys with
// the Firebase ID token. The raw key is only ever returned once, at creation.
import { getIdToken, getAuthUid } from "@/store/auth-store";

export interface GatewayKey {
  id: string;
  label: string;
  last4: string;
  createdAt: number;
  revoked: boolean;
}

async function call(endpoint: string, options?: RequestInit): Promise<Response> {
  const token = await getIdToken();
  const uid = getAuthUid();
  const headers = new Headers(options?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (uid) headers.set("x-user-uid", uid);
  headers.set("Content-Type", "application/json");
  return fetch(endpoint, { ...options, headers });
}

export async function listGatewayKeys(): Promise<GatewayKey[]> {
  const res = await call("/api/keys");
  if (!res.ok) throw new Error(await errText(res));
  const data = await res.json();
  return data.keys ?? [];
}

export async function createGatewayKey(
  label: string
): Promise<{ raw: string; key: GatewayKey }> {
  const res = await call("/api/keys", {
    method: "POST",
    body: JSON.stringify({ label }),
  });
  if (!res.ok) throw new Error(await errText(res));
  return res.json();
}

export async function revokeGatewayKey(id: string): Promise<void> {
  const res = await call(`/api/keys?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await errText(res));
}

async function errText(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data.error ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}
