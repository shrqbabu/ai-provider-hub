// Quota service — calls /api/quota to fetch real-time quota data for connected providers
import { getIdToken, getAuthUid } from "@/store/auth-store";

export type QuotaFamily = "anthropic" | "openai" | "google" | "other";
export type QuotaSource = "requests" | "pool";

export interface QuotaRow {
  model: string;
  family: QuotaFamily;
  /** 0..1 — fraction of the quota still available for this model / pool. */
  remainingFraction: number | null;
  resetTime: string | null;
  source: QuotaSource;
}

export interface QuotaSnapshot {
  ok: boolean;
  provider: {
    id: string;
    key: string;
    name: string;
  };
  account: {
    email: string | null;
    plan: string | null;
  };
  tokenExpiresAt: number | null;
  fetchedAt: number;
  rows: QuotaRow[];
  warnings: string[];
  cached?: boolean;
}

export async function fetchProviderQuota(
  providerId: string,
  opts?: { refresh?: boolean }
): Promise<QuotaSnapshot> {
  const token = await getIdToken();
  const uid = getAuthUid();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (uid) headers.set("x-user-uid", uid);

  const qs = new URLSearchParams({ id: providerId });
  if (opts?.refresh) qs.set("refresh", "1");

  const res = await fetch(`/api/quota?${qs.toString()}`, { headers });
  if (!res.ok) {
    let errMsg = `Failed to fetch quota (${res.status})`;
    try {
      const body = await res.json();
      if (body.error) errMsg = body.error;
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }
  return res.json();
}
