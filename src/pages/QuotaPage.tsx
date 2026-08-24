import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Gauge,
  RefreshCw,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Plug2,
  Search,
  Battery,
  Zap,
  ShieldCheck,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProviderLogo } from "@/components/ProviderLogo";
import { useProviderStore } from "@/store/provider-store";
import { fetchProviderQuota, type QuotaRow, type QuotaSnapshot } from "@/services/quota-service";
import type { ConnectedProvider } from "@/types";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Helpers (shared with AntigravityQuotaCard but extended)
// ---------------------------------------------------------------------------

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

function maskEmail(email?: string | null): string {
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

const INITIAL_VISIBLE = 4;

// ---------------------------------------------------------------------------
// Single provider quota card with Show More
// ---------------------------------------------------------------------------

function QuotaProviderCard({
  provider,
  searchQuery,
  refreshSignal,
}: {
  provider: ConnectedProvider;
  searchQuery: string;
  refreshSignal: number;
}) {
  const [data, setData] = useState<QuotaSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [expandedFamilies, setExpandedFamilies] = useState<Record<string, boolean>>({});
  const [expandedAll, setExpandedAll] = useState(false);

  const load = async (force = false) => {
    if (provider.disabled) {
      setLoading(false);
      return;
    }
    if (force) setRefreshing(true);
    else if (!data) setLoading(true);
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

  // initial + auto refresh every 5 min
  useEffect(() => {
    void load();
    const iv = setInterval(() => void load(), 5 * 60_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.id, provider.disabled]);

  // tick for live countdowns
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(iv);
  }, []);

  // global refresh signal
  useEffect(() => {
    if (refreshSignal > 0) void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const filteredRows = useMemo(() => {
    if (!data?.rows) return [];
    if (!searchQuery.trim()) return data.rows;
    const q = searchQuery.toLowerCase();
    return data.rows.filter((r) => r.model.toLowerCase().includes(q) || r.family.toLowerCase().includes(q));
  }, [data?.rows, searchQuery]);

  const groups = useMemo(() => {
    const g = new Map<string, QuotaRow[]>();
    for (const row of filteredRows) {
      const list = g.get(row.family) ?? [];
      list.push(row);
      g.set(row.family, list);
    }
    // sort families: anthropic, openai, google, other
    const order = ["anthropic", "openai", "google", "other"];
    return new Map([...g.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])));
  }, [filteredRows]);

  const tokenLeftMs = data?.tokenExpiresAt != null ? data.tokenExpiresAt - now : null;
  const tokenSoon = tokenLeftMs != null && tokenLeftMs < 10 * 60_000;

  const totalModels = data?.rows.length ?? 0;
  const visibleTotal = filteredRows.length;
  const avgRemaining = useMemo(() => {
    if (!filteredRows.length) return null;
    const vals = filteredRows.map((r) => r.remainingFraction).filter((v): v is number => v != null);
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [filteredRows]);

  const toggleFamily = (family: string) => {
    setExpandedFamilies((prev) => ({ ...prev, [family]: !prev[family] }));
  };

  if (provider.disabled) {
    return (
      <Card className="overflow-hidden border-amber-500/20">
        <CardContent className="p-5">
          <div className="flex items-start gap-4">
            <ProviderLogo provider={provider.key} customUrl={provider.customLogo} className="w-12 h-12 opacity-60" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold truncate">{provider.displayName || provider.name}</h3>
                <Badge variant="destructive" className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[11px]">
                  Disconnected
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Reconnect this provider to view quota.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card className="overflow-hidden relative group border-emerald-500/20 border-l-4 border-l-emerald-500">
        {/* subtle gradient */}
        <div className="absolute inset-0 opacity-[0.03] bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600 pointer-events-none" />
        <CardContent className="p-0 relative">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 p-4 pb-3 border-b border-border/50 bg-card/50">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <ProviderLogo provider={provider.key} customUrl={provider.customLogo} className="w-12 h-12 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold truncate text-[15px]">{provider.displayName || provider.name}</h3>
                  {data?.account.plan && (
                    <span className="px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-500 text-[10px] font-bold tracking-wide uppercase">
                      {data.account.plan}
                    </span>
                  )}
                  {data?.cached && (
                    <span className="px-1.5 py-0.5 rounded bg-secondary text-[10px] text-muted-foreground">cached</span>
                  )}
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-[10px] font-medium flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> OAuth
                  </span>
                </div>

                <div className="text-[11px] text-muted-foreground truncate font-mono mt-1">
                  {maskEmail(data?.account.email ?? provider.email) || "email hidden"}
                </div>

                <div
                  className={`text-[11px] mt-1 flex items-center gap-1.5 ${tokenSoon ? "text-amber-500 font-medium" : "text-sky-500"}`}
                >
                  <Clock className="w-3 h-3 shrink-0" />
                  {tokenLeftMs == null
                    ? "Token expiry unknown"
                    : tokenLeftMs <= 0
                    ? "Token expired — auto-refresh on next use"
                    : `Token expires in ${fmtDuration(tokenLeftMs)}`}
                </div>

                {/* stats row */}
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-[11px] flex items-center gap-1 text-muted-foreground">
                    <Battery className="w-3 h-3" /> {totalModels} models
                    {searchQuery && visibleTotal !== totalModels && (
                      <span className="text-primary">• {visibleTotal} matched</span>
                    )}
                  </span>
                  {avgRemaining != null && (
                    <span className={`text-[11px] flex items-center gap-1 font-medium ${pctColor(avgRemaining)}`}>
                      <Zap className="w-3 h-3" /> {Math.round(avgRemaining * 100)}% avg left
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void load(true)}
                disabled={refreshing || loading}
                title="Force refresh quota"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {/* Body */}
          <div className="p-4">
            {loading && !data && (
              <div className="py-10 text-center">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto text-muted-foreground mb-2" />
                <div className="text-xs text-muted-foreground">Fetching quota from Antigravity…</div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-[12px] text-rose-400">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="flex-1 [overflow-wrap:anywhere]">
                  <div className="font-medium mb-0.5">Failed to fetch quota</div>
                  <div className="text-[11px] opacity-90">{error}</div>
                </div>
                <Button variant="outline" size="sm" className="shrink-0 h-7 text-[11px]" onClick={() => void load(true)}>
                  Retry
                </Button>
              </div>
            )}

            {data && groups.size === 0 && (
              <div className="py-8 text-center">
                <div className="w-12 h-12 rounded-2xl bg-secondary/60 mx-auto flex items-center justify-center mb-3">
                  <Search className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="text-sm font-medium">
                  {searchQuery ? `No models match "${searchQuery}"` : "No quota data returned"}
                </div>
                <div className="text-xs text-muted-foreground mt-1 max-w-[28ch] mx-auto">
                  {searchQuery ? "Try a different search term or clear the filter." : "This account returned an empty quota list."}
                </div>
                {searchQuery && (
                  <div className="mt-3 text-xs text-muted-foreground">Total models in account: {totalModels}</div>
                )}
              </div>
            )}

            {data && groups.size > 0 && (
              <div className="space-y-5">
                {/* Expand All toggle */}
                {totalModels > INITIAL_VISIBLE && (
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                      <Info className="w-3 h-3" />
                      Showing {searchQuery ? visibleTotal : totalModels} models across {groups.size} families
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px] gap-1"
                      onClick={() => {
                        const shouldExpand = !expandedAll;
                        setExpandedAll(shouldExpand);
                        const next: Record<string, boolean> = {};
                        for (const [family] of groups) next[family] = shouldExpand;
                        setExpandedFamilies(next);
                      }}
                    >
                      {expandedAll ? (
                        <>
                          <ChevronUp className="w-3 h-3" /> Show less
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-3 h-3" /> Show all models
                        </>
                      )}
                    </Button>
                  </div>
                )}

                {[...groups.entries()].map(([family, rows]) => {
                  const isExpanded = expandedFamilies[family] ?? expandedAll ?? false;
                  const shouldCollapse = !searchQuery && rows.length > INITIAL_VISIBLE;
                  const visibleRows = shouldCollapse && !isExpanded ? rows.slice(0, INITIAL_VISIBLE) : rows;
                  const hiddenCount = rows.length - visibleRows.length;

                  return (
                    <div key={family} className="rounded-xl border border-border/50 bg-secondary/20 overflow-hidden">
                      <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-secondary/30 border-b border-border/30">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="text-[11px] font-bold uppercase tracking-wider">
                            {FAMILY_LABEL[family] ?? family}
                          </span>
                          <span className="text-[11px] text-muted-foreground">{rows.length} models</span>
                          {FAMILY_NOTE[family] && (
                            <span
                              className="hidden sm:inline text-[10px] text-muted-foreground/60 italic truncate max-w-[24ch]"
                              title={FAMILY_NOTE[family]}
                            >
                              • {FAMILY_NOTE[family]}
                            </span>
                          )}
                        </div>
                        {shouldCollapse && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[11px] gap-1 px-2"
                            onClick={() => toggleFamily(family)}
                          >
                            {isExpanded ? (
                              <>
                                <ChevronUp className="w-3 h-3" /> Less
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-3 h-3" /> +{hiddenCount} more
                              </>
                            )}
                          </Button>
                        )}
                      </div>

                      <div className="p-2.5 space-y-3">
                        {visibleRows.map((row) => {
                          const frac = row.remainingFraction;
                          const pct = frac == null ? null : Math.round(frac * 1000) / 10;
                          const resetMs = row.resetTime ? new Date(row.resetTime).getTime() - now : null;
                          return (
                            <div key={row.model + row.source} className="group/row">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[13px] font-medium truncate pr-2" title={row.model}>
                                  {row.model}
                                </span>
                                <span className={`text-[12px] font-bold shrink-0 ${pctColor(frac)}`}>
                                  {pct == null ? "n/a" : `${Math.round(pct as number)}% left`}
                                </span>
                              </div>
                              <div className="mt-1.5 h-1.5 rounded-full bg-secondary/80 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${barColor(frac)}`}
                                  style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }}
                                />
                              </div>
                              <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                                <span className="flex items-center gap-1.5">
                                  <span
                                    className={`px-1 py-0.5 rounded text-[9px] font-medium border ${
                                      row.source === "requests"
                                        ? "bg-sky-500/10 border-sky-500/20 text-sky-600"
                                        : "bg-violet-500/10 border-violet-500/20 text-violet-600"
                                    }`}
                                  >
                                    {row.source === "requests" ? "requests" : "pooled"}
                                  </span>
                                  <span className="hidden sm:inline">{row.source === "requests" ? "bucket" : "shared pool"}</span>
                                </span>
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

                        <AnimatePresence>
                          {shouldCollapse && !isExpanded && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              className="pt-1"
                            >
                              <button
                                onClick={() => toggleFamily(family)}
                                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-secondary/40 hover:bg-secondary/70 border border-dashed border-border/60 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <ChevronDown className="w-3.5 h-3.5" />
                                Show {hiddenCount} more {FAMILY_LABEL[family] ?? family} models
                              </button>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {isExpanded && shouldCollapse && (
                          <button
                            onClick={() => toggleFamily(family)}
                            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-secondary/20 hover:bg-secondary/40 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                            Show less
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {data.warnings.length > 0 && (
                  <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-2.5 text-[11px] text-amber-700 dark:text-amber-300">
                    <div className="flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span className="[overflow-wrap:anywhere]">{data.warnings[0]}</span>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between text-[10px] text-muted-foreground/60 pt-1">
                  <span>Fetched {new Date(data.fetchedAt).toLocaleTimeString()}</span>
                  <span>live every 5 min • token refresh auto</span>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function QuotaPage() {
  const providers = useProviderStore((s) => s.providers);
  const [search, setSearch] = useState("");
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [globalRefreshing, setGlobalRefreshing] = useState(false);

  const quotaProviders = useMemo(() => {
    return providers.filter(
      (p) => p.key === "antigravity" || /cloudcode-pa\.googleapis\.com/.test(p.baseURL || "")
    );
  }, [providers]);

  const activeQuotaProviders = useMemo(() => quotaProviders.filter((p) => !p.disabled), [quotaProviders]);

  const handleRefreshAll = async () => {
    if (activeQuotaProviders.length === 0) {
      toast.error("No active quota providers to refresh");
      return;
    }
    setGlobalRefreshing(true);
    setRefreshSignal((n) => n + 1);
    toast.loading(`Refreshing ${activeQuotaProviders.length} provider(s)...`, { id: "quota-refresh-all" });
    // auto clear toast after 2s, actual refresh handled by children
    setTimeout(() => {
      toast.success(`Triggered refresh for ${activeQuotaProviders.length} provider(s)`, { id: "quota-refresh-all" });
      setGlobalRefreshing(false);
    }, 1200);
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex flex-col gap-4 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
                <Gauge className="w-5 h-5 md:w-6 md:h-6 text-emerald-500" />
                Provider Quota
              </h1>
              <p className="text-sm text-muted-foreground mt-1 max-w-[60ch]">
                Live quota for your Antigravity / Cloud Code accounts. Track remaining % per model, reset timers, plan & token expiry.
                Models are grouped by family — use <span className="font-medium text-foreground">Show more</span> to reveal all.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefreshAll}
                disabled={globalRefreshing || activeQuotaProviders.length === 0}
                className="gap-1.5 border-emerald-600/20 hover:border-emerald-500/40"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${globalRefreshing ? "animate-spin" : ""}`} />
                Refresh all
              </Button>
              <Link to="/providers">
                <Button variant="ghost" size="sm" className="gap-1.5">
                  <Plug2 className="w-3.5 h-3.5" /> Providers
                </Button>
              </Link>
            </div>
          </div>

          {/* Search + stats */}
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="relative flex-1 w-full sm:max-w-[360px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models (e.g. claude, gemini, gpt...)"
                className="pl-9 h-9 bg-card/50"
              />
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="px-2.5 py-1 rounded-full bg-secondary/60 border border-border/50">
                {quotaProviders.length} quota provider(s) • {activeQuotaProviders.length} active
              </span>
              {search && (
                <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => setSearch("")}>
                  Clear search
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        {quotaProviders.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-3xl border border-dashed border-border p-10 md:p-16 text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 text-emerald-500 mx-auto flex items-center justify-center">
              <Gauge className="w-8 h-8" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">No quota-enabled providers</h3>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
              Connect an Antigravity / Google Cloud Code provider via OAuth to see live quota here. Quota tracking is only available for
              Antigravity accounts.
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Link to="/providers">
                <Button>
                  <Plug2 className="w-4 h-4" /> Go to Providers
                </Button>
              </Link>
            </div>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-5">
            {quotaProviders.map((p) => (
              <QuotaProviderCard key={p.id} provider={p} searchQuery={search} refreshSignal={refreshSignal} />
            ))}
          </div>
        )}

        {quotaProviders.length > 0 && (
          <div className="mt-8 rounded-xl border border-border/50 bg-card/30 p-4 text-[11px] text-muted-foreground">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-sky-500" />
              <div className="space-y-1">
                <div className="font-medium text-foreground">How quota works</div>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>
                    Antigravity accounts have separate <span className="font-medium">pooled</span> and{" "}
                    <span className="font-medium">requests</span> buckets per model family.
                  </li>
                  <li>Anthropic & OpenAI models share one Vertex pool — usage burns both equally.</li>
                  <li>Quota auto-refreshes every 5 minutes; token expiry is tracked live and refreshes automatically on next use.</li>
                  <li>
                    Use <span className="font-medium">Show more</span> per family to reveal all models. Search filters across all providers
                    instantly.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
