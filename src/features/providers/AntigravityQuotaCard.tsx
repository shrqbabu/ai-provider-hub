import { useEffect, useMemo, useState } from "react";
import { Clock, RefreshCw, AlertTriangle } from "lucide-react";
import { fetchProviderQuota, type QuotaRow, type QuotaSnapshot } from "@/services/quota-service";
import type { ConnectedProvider } from "@/types";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** "1d 20h 23m" style relative duration. */
function fmtDuration(ms: number): string {
  if (ms <= 0) return "now";
  const m = Math.floor(ms / 60_000);
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** sha************@*****com style masking (first 3 local chars + TLD). */
export function maskEmail(email?: string | null): string {
  if (!email) return "";
  const at = email.indexOf("@");
  if (at < 0) return email.slice(0, 3) + "…";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const tldIdx = domain.lastIndexOf(".");
  const tld = tldIdx >= 0 ? domain.slice(tldIdx + 1) : domain;
  return (
    local.slice(0, 3) +
    "*".repeat(Math.max(8, local.length - 3)) +
    "@" +
    "*".repeat(Math.max(3, domain.length - tld.length - 1)) +
    tld
  );
}

function barColor(frac: number | null): string {
  if (frac == null) return "bg-secondary";
  if (frac >= 0.5) return "bg-emerald-500";
  if (frac >= 0.2) return "bg-amber-500";
  return "bg-rose-500";
}

function pctColor(frac: number | null): string {
  if (frac == null) return "text-muted-foreground";
  if (frac >= 0.5) return "text-emerald-500";
  if (frac >= 0.2) return "text-amber-500";
  return "text-rose-500";
}

const FAMILY_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  other: "Other",
};

const FAMILY_NOTE: Record<string, string> = {
  anthropic: "shares one Vertex pool with OpenAI models — any request burns both equally",
  openai: "shares one Vertex pool with Anthropic models — any request burns both equally",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  provider: ConnectedProvider;
}

/**
 * Antigravity (cloudcode-pa) account quota tracker — the same numbers the
 * Antigravity IDE itself shows: per-model/plan remaining %, reset countdowns,
 * plan badge and OAuth token expiry.
 */
export function AntigravityQuotaCard({ provider }: Props) {
  const [data, setData] = useState<QuotaSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = async (force = false) => {
    if (force) setRefreshing(true);
    try {
      const snap = await fetchProviderQuota(provider.id, { refresh: force });
      setData(snap);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
      setNow(Date.now());
    }
  };

  // Initial fetch + silent 5-minute auto-refresh.
  useEffect(() => {
    void load();
    const iv = setInterval(() => void load(), 5 * 60_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.id]);

  // 30s tick so "Resets in …" / "Token expires in …" stay live.
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(iv);
  }, []);

  const groups = useMemo(() => {
    const g = new Map<string, QuotaRow[]>();
    for (const row of data?.rows ?? []) {
      const list = g.get(row.family) ?? [];
      list.push(row);
      g.set(row.family, list);
    }
    return g;
  }, [data]);

  const tokenLeftMs =
    data?.tokenExpiresAt != null ? data.tokenExpiresAt - now : null;
  const tokenSoon = tokenLeftMs != null && tokenLeftMs < 10 * 60_000;

  return (
    <div className="mt-3 rounded-xl border border-emerald-500/30 border-l-4 border-l-emerald-500 bg-card/40 backdrop-blur-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Account quota</span>
            {data?.account.plan && (
              <span className="px-1.5 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-500 text-[10px] font-semibold">
                {data.account.plan}
              </span>
            )}
            {data?.cached && (
              <span className="text-[10px] text-muted-foreground">cached</span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground truncate font-mono">
            {maskEmail(data?.account.email ?? provider.email)}
          </div>
          <div
            className={`text-[11px] mt-0.5 flex items-center gap-1 ${
              tokenSoon ? "text-amber-500 font-medium" : "text-sky-500"
            }`}
          >
            <Clock className="w-3 h-3 shrink-0" />
            {tokenLeftMs == null
              ? "Token expiry unknown"
              : tokenLeftMs <= 0
              ? "Token expired — auto-refresh on next use"
              : `Token expires in ${fmtDuration(tokenLeftMs)}`}
          </div>
        </div>
        <button
          onClick={() => void load(true)}
          disabled={refreshing || loading}
          title="Force refresh quota"
          className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-40 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Body */}
      <div className="px-3 pb-3">
        {loading && !data && (
          <div className="py-6 text-center text-xs text-muted-foreground">
            Fetching quota from Antigravity…
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/5 p-2.5 text-[11px] text-rose-400">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span className="[overflow-wrap:anywhere]">{error}</span>
          </div>
        )}

        {data &&
          [...groups.entries()].map(([family, rows]) => (
            <div key={family} className="mt-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {FAMILY_LABEL[family] ?? family}
                </span>
                {FAMILY_NOTE[family] && (
                  <span
                    className="text-[10px] text-muted-foreground/70 text-right"
                    title={FAMILY_NOTE[family]}
                  >
                    shared pool
                  </span>
                )}
              </div>
              <div className="mt-1 space-y-2.5">
                {rows.map((row) => {
                  const frac = row.remainingFraction;
                  const pct = frac == null ? null : Math.round(frac * 1000) / 10;
                  const resetMs = row.resetTime
                    ? new Date(row.resetTime).getTime() - now
                    : null;
                  return (
                    <div key={row.model + row.source}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium truncate">{row.model}</span>
                        <span
                          className={`text-xs font-semibold shrink-0 ${pctColor(frac)}`}
                        >
                          {pct == null ? "n/a" : `${Math.round(pct)}% left`}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-secondary/80 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${barColor(frac)}`}
                          style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }}
                        />
                      </div>
                      <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{row.source === "requests" ? "requests bucket" : "pooled"}</span>
                        {resetMs != null && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5" />
                            Resets in {fmtDuration(resetMs)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

        {data && data.rows.length === 0 && (
          <div className="py-4 text-center text-xs text-muted-foreground">
            No quota data returned by the account.
          </div>
        )}

        {data && data.warnings.length > 0 && (
          <div className="mt-2 text-[10px] text-muted-foreground/80 [overflow-wrap:anywhere]">
            {data.warnings[0]}
          </div>
        )}

        {data && (
          <div className="mt-2 text-[10px] text-muted-foreground/60 text-right">
            live every 5 min
          </div>
        )}
      </div>
    </div>
  );
}
