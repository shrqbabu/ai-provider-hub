// Quota core — read-only provider account quota snapshot for the signed-in
// user. Currently targets Google Antigravity (cloudcode-pa) accounts: it calls
// the same internal endpoints the Antigravity IDE / agy CLI themselves call:
//
//   POST https://<cloudcode-pa host>/v1internal:retrieveUserQuota
//        → authoritative per-account REQUESTS buckets (Gemini line-up)
//   POST https://<cloudcode-pa host>/v1internal:fetchAvailableModels
//        → every callable model (Gemini + Claude + GPT-OSS) with pooled
//          quotaInfo.remainingFraction — the ONLY source for non-Google models
//   POST https://<cloudcode-pa host>/v1internal:loadCodeAssist
//        → account tier (Starter/Pro/Ultra…) and account email
//
//   GET /api/quota?id=<providerId>&refresh=1   (Auth: Firebase ID token)
//
// Rows are merged (REQUESTS beats pool per model id), grouped by family on the
// client, and cached server-side for 60s per provider so a UI auto-refresh
// cannot hammer Google.
import { requireUser } from "./auth.js";
import { jsonResponse, type CoreRequest, type CoreResponse } from "./http.js";
import { readKV, writeKV } from "./kv.js";
import { OAUTH_PROVIDERS } from "./oauth/constants.js";
import { providerKeys, type GwProvider } from "./upstreams.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface CacheEntry {
  at: number;
  payload: Record<string, unknown>;
}

// 60s server-side cache per (uid, provider) — enough for a 5-minute UI
// auto-refresh + manual refreshes without hammering Google's internal API.
const TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

export function _quotaCacheClearForTests(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function familyOf(modelId: string): QuotaFamily {
  const s = modelId.toLowerCase();
  if (s.startsWith("claude") || s.includes("anthropic")) return "anthropic";
  if (s.startsWith("gpt") || s.includes("oss") || /^o[1-9]/.test(s) || s.includes("openai"))
    return "openai";
  if (s.startsWith("gemini") || s.startsWith("tab")) return "google";
  return "other";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** tokenExpiry was historically stored as epoch SECONDS by older UIs. */
function normExpiryMs(v: unknown): number | null {
  let ms = Number(v);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 1e12) ms *= 1000;
  return ms;
}

function isAntigravity(p: GwProvider): boolean {
  return p.key === "antigravity" || /cloudcode-pa\.googleapis\.com/.test(p.baseURL ?? "");
}

// These headers identify us as the Antigravity IDE. They are REQUIRED for the
// non-Google providers (Claude / GPT-OSS): without the Client-Metadata ideType
// marker, the backend answers 404 for those models. Harmless for Gemini.
const ANTIGRAVITY_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Antigravity/1.0.0 Chrome/138.0.7204.235 Electron/37.3.1 Safari/537.36",
  "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
  "Client-Metadata": '{"ideType":"ANTIGRAVITY","platform":"WINDOWS","pluginType":"GEMINI"}',
};

const CLOUDCODE_HOSTS = [
  "daily-cloudcode-pa.googleapis.com",
  "cloudcode-pa.googleapis.com",
];

async function postV1Internal(
  host: string,
  endpoint: string,
  accessToken: string,
  antigravityHeaders: boolean,
  body = "{}"
): Promise<{ status: number; text: string }> {
  const res = await fetch(`https://${host}/v1internal:${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(antigravityHeaders ? ANTIGRAVITY_HEADERS : {}),
    },
    body,
    signal: AbortSignal.timeout(endpoint === "fetchAvailableModels" ? 20_000 : 10_000),
  });
  const text = await res.text().catch(() => "");
  return { status: res.status, text };
}

class UpstreamError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Try hosts in order; retry-able failures (5xx/429) advance to the next host. */
async function callV1Internal(
  hosts: string[],
  endpoint: string,
  accessToken: string,
  antigravityHeaders: boolean,
  body = "{}"
): Promise<Record<string, unknown>> {
  let lastErr = `${endpoint} failed`;
  for (const host of hosts) {
    try {
      const r = await postV1Internal(host, endpoint, accessToken, antigravityHeaders, body);
      if (r.status === 200) {
        return JSON.parse(r.text || "{}") as Record<string, unknown>;
      }
      lastErr = `${endpoint} (HTTP ${r.status}): ${r.text.slice(0, 240)}`;
      if (r.status === 401 || r.status === 403) throw new UpstreamError(r.status, lastErr);
      if (r.status === 404) break; // same shape on both hosts — no point retrying
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      lastErr = `${endpoint}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  throw new Error(lastErr);
}

/** Exchange the OAuth refresh token for a fresh access token (Google OAuth). */
async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresInSec: number } | null> {
  const cfg = OAUTH_PROVIDERS.antigravity;
  if (!cfg?.tokenUrl || !cfg.clientId) return null;
  try {
    const res = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: cfg.clientId,
        ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}),
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
    } | null;
    if (!res.ok || !data?.access_token) return null;
    return {
      accessToken: data.access_token,
      expiresInSec: Number(data.expires_in) || 3600,
    };
  } catch {
    return null;
  }
}

/**
 * Refresh the provider's access token when expired (or force=true) and persist
 * the providers doc. Returns true when the provider now holds a fresh token.
 */
async function refreshProviderToken(
  p: GwProvider,
  providers: GwProvider[],
  uid: string,
  force = false
): Promise<boolean> {
  if (!p.refreshToken) return false;
  const expiryMs = normExpiryMs(p.tokenExpiry);
  if (!force && expiryMs && Date.now() < expiryMs - 60_000) return false;

  const usedToken = providerKeys(p)[0] || p.apiKey || "";
  const fresh = await refreshAccessToken(p.refreshToken);
  if (!fresh) return false;

  p.apiKey = fresh.accessToken;
  p.tokenExpiry = Date.now() + fresh.expiresInSec * 1000;
  if (Array.isArray(p.apiKeys)) {
    p.apiKeys = p.apiKeys.map((k) => (k === usedToken ? fresh.accessToken : k));
  }
  await writeKV(uid, "providers", providers, Date.now()).catch(() => {});
  return true;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

// Exported (pure) for tests.
export function parseRequestBuckets(data: Record<string, unknown>): QuotaRow[] {
  const buckets = Array.isArray(data.buckets) ? data.buckets : [];
  return buckets.map((b: Record<string, unknown>) => ({
    model: String((b.modelId as string) || "unknown"),
    family: familyOf(String(b.modelId || "")),
    remainingFraction: num(b.remainingFraction),
    resetTime: typeof b.resetTime === "string" ? b.resetTime : null,
    source: "requests" as const,
  }));
}

// Exported (pure) for tests.
export function parseAvailableModels(data: Record<string, unknown>): QuotaRow[] {
  const raw = (data.models ?? {}) as Record<string, unknown> | unknown[];
  const entries: [string, Record<string, unknown>][] = Array.isArray(raw)
    ? (raw as Record<string, unknown>[]).map((m) => [String(m.name || m.id || ""), m])
    : Object.entries(raw as Record<string, unknown>).map(([k, v]) => [
        k,
        (v ?? {}) as Record<string, unknown>,
      ]);

  const rows: QuotaRow[] = [];
  for (const [id, m] of entries) {
    if (!id || m.isInternal === true || /^tab[_-]/.test(id)) continue;
    const qi = (m.quotaInfo ?? {}) as Record<string, unknown>;
    rows.push({
      model: id,
      family: familyOf(id),
      remainingFraction: num(qi.remainingFraction),
      resetTime: typeof qi.resetTime === "string" ? qi.resetTime : null,
      source: "pool",
    });
  }
  return rows;
}

/** Friendly plan badge: "Starter" for free/legacy tiers, paid tier name otherwise. */
// Exported (pure) for tests.
export function planLabel(ca: Record<string, unknown> | null): string | null {
  if (!ca) return null;
  const obj = (k: string) => (ca[k] ?? {}) as Record<string, unknown>;
  const paid = obj("paidTier");
  const paidName = (paid.name ?? paid.id) as string | undefined;
  if (paidName) {
    return paidName.replace(/^Gemini Code Assist in Google One AI\s*/i, "").trim() || "Paid";
  }
  const cur = obj("currentTier");
  const curName = String(cur.name ?? cur.id ?? "");
  if (!curName) return null;
  if (/free|legacy|starter/i.test(curName)) return "Starter";
  return curName.replace(/[-_]/g, " ").replace(/\s*tier\s*$/i, "").trim() || "Starter";
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleQuota(req: CoreRequest, nowMs: number): Promise<CoreResponse> {
  const uid = await requireUser(req);
  if (!uid) return jsonResponse(401, { error: "Unauthorized" });
  if (req.method.toUpperCase() !== "GET") return jsonResponse(405, { error: "Method not allowed." });

  const providers = await readKV<GwProvider[]>(uid, "providers", []);
  let candidates = providers.filter((p) => isAntigravity(p) && p.authMode === "oauth");
  if (!candidates.length) candidates = providers.filter(isAntigravity);
  if (!candidates.length) {
    return jsonResponse(404, {
      error: "No Antigravity (cloudcode-pa) provider found. Connect one via OAuth first.",
    });
  }

  const wanted = req.query.get("id") || req.query.get("provider");
  const provider =
    (wanted ? candidates.find((p) => p.id === wanted || p.key === wanted) : undefined) ??
    candidates[0];

  const cacheKey = `${uid}:${provider.id}`;
  const forceRefresh = req.query.get("refresh") === "1";
  const hit = cache.get(cacheKey);
  if (!forceRefresh && hit && nowMs - hit.at < TTL_MS) {
    return jsonResponse(200, { ...hit.payload, cached: true });
  }

  // Order hosts so the provider's own baseURL host is tried first.
  const hostMatch = /(?:daily-)?cloudcode-pa\.googleapis\.com/.exec(provider.baseURL ?? "");
  const hosts = [
    ...(hostMatch ? [hostMatch[0]] : []),
    ...CLOUDCODE_HOSTS.filter((h) => h !== hostMatch?.[0]),
  ];

  const warnings: string[] = [];

  // Ensure a fresh access token up front.
  try {
    await refreshProviderToken(provider, providers, uid);
  } catch (err) {
    warnings.push(`token refresh: ${err instanceof Error ? err.message : String(err)}`);
  }

  const run = async (): Promise<{
    quota: Record<string, unknown> | null;
    modelsEnv: Record<string, unknown> | null;
    codeAssist: Record<string, unknown> | null;
  }> => {
    const accessToken = providerKeys(provider)[0] || provider.apiKey || "";
    if (!accessToken) throw new Error("Provider has no access token stored.");

    // Tier/account + REQUESTS buckets in parallel; model listing too.
    const [quotaRes, codeAssistRes, modelsRes] = await Promise.allSettled([
      callV1Internal(hosts, "retrieveUserQuota", accessToken, false),
      callV1Internal(hosts, "loadCodeAssist", accessToken, false),
      callV1Internal(hosts, "fetchAvailableModels", accessToken, true),
    ]);

    const quota = quotaRes.status === "fulfilled" ? quotaRes.value : null;
    if (quotaRes.status === "rejected") warnings.push(String(quotaRes.reason?.message ?? quotaRes.reason));

    let codeAssist = codeAssistRes.status === "fulfilled" ? codeAssistRes.value : null;

    let modelsEnv = modelsRes.status === "fulfilled" ? modelsRes.value : null;
    // fetchAvailableModels sometimes demands the account's companion project id
    // (available via loadCodeAssist). Retry once with it when the bare call failed.
    if (!modelsEnv) {
      const project = codeAssist?.cloudaicompanionProject;
      if (typeof project === "string" && project) {
        try {
          modelsEnv = await callV1Internal(
            hosts,
            "fetchAvailableModels",
            accessToken,
            true,
            JSON.stringify({ project })
          );
        } catch (err) {
          warnings.push(err instanceof Error ? err.message : String(err));
        }
      } else {
        warnings.push(
          modelsRes.status === "rejected"
            ? String(modelsRes.reason?.message ?? modelsRes.reason)
            : "fetchAvailableModels returned nothing"
        );
      }
    }

    // A 401 on the authoritative call after our upfront refresh attempt
    // usually means the refresh-token expired — surface the actual reason.
    return { quota, modelsEnv, codeAssist };
  };

  let result = await run();
  // One retry: if the main call 401'd and we can still refresh, redo once.
  if (
    !result.quota &&
    warnings.some((w) => /retrieveUserQuota \(HTTP 401\)/.test(w))
  ) {
    const refreshed = await refreshProviderToken(provider, providers, uid, true);
    if (refreshed) {
      warnings.length = 0;
      result = await run();
    }
  }

  const rows: QuotaRow[] = [];
  const byModel = new Map<string, QuotaRow>();
  if (result.quota) {
    for (const row of parseRequestBuckets(result.quota)) {
      byModel.set(row.model, row);
      rows.push(row);
    }
  }
  if (result.modelsEnv) {
    for (const row of parseAvailableModels(result.modelsEnv)) {
      if (byModel.has(row.model)) continue; // REQUESTS buckets are authoritative
      byModel.set(row.model, row);
      rows.push(row);
    }
  }

  if (!rows.length) {
    const first = warnings[0] ?? "Upstream returned no quota data.";
    return jsonResponse(502, { error: first, warnings });
  }

  const FAMILY_ORDER: QuotaFamily[] = ["anthropic", "openai", "google", "other"];
  rows.sort((a, b) => {
    const fo = FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family);
    if (fo !== 0) return fo;
    const fa = a.remainingFraction ?? 2;
    const fb = b.remainingFraction ?? 2;
    if (fa !== fb) return fa - fb; // lowest remaining first — that's what users watch
    return a.model.localeCompare(b.model);
  });

  const payload: Record<string, unknown> = {
    ok: true,
    provider: {
      id: provider.id,
      key: provider.key,
      name: provider.displayName || provider.key,
    },
    account: {
      // Email from loadCodeAssist's manageSubscriptionUri (…&Email=<x>) is the
      // freshest source; fall back to what OAuth stored at connect time.
      email:
        (() => {
          const uri = (result.codeAssist?.manageSubscriptionUri as string) ?? "";
          const m = /Email=([^&]+)/.exec(uri);
          return m ? decodeURIComponent(m[1]) : provider.email ?? null;
        })(),
      plan: planLabel(result.codeAssist),
    },
    tokenExpiresAt: normExpiryMs(provider.tokenExpiry),
    fetchedAt: nowMs,
    rows,
    warnings,
  };

  cache.set(cacheKey, { at: nowMs, payload });
  return jsonResponse(200, payload);
}
