import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Boxes,
  Clock,
  Zap,
  CheckCircle2,
  XCircle,
  Trash2,
  Search,
  ChevronDown,
  ChevronRight,
  Layers,
  ArrowRight,
  RefreshCw,
  Radio,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useComboLogStore } from "@/store/combo-log-store";
import { formatNumber, cn, formatIndianDateTime, formatIndianTime } from "@/utils";
import { toast } from "sonner";
import type { ComboLogEntry } from "@/types";

export function ComboLogsPage() {
  const logs = useComboLogStore((s) => s.logs);
  const clear = useComboLogStore((s) => s.clear);
  const hydrate = useComboLogStore((s) => s.hydrate);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "failed">("all");
  // "request" = ek card per combo request with the full fallback chain
  // (shows the chain STOPPING at the responder); "attempt" = flat per-attempt
  // rows for debugging.
  const [viewMode, setViewMode] = useState<"request" | "attempt">("request");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  // Initial hydrate & live polling
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      hydrate();
    }, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, hydrate]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await hydrate();
      setLastRefreshed(new Date());
      toast.success("Logs refreshed");
    } catch {
      toast.error("Failed to refresh logs");
    } finally {
      setTimeout(() => setIsRefreshing(false), 300);
    }
  };

  // One feed row per ATTEMPT — each fallback step / responding member gets
  // its own visible log row (previously a whole request collapsed into one
  // card and individual member results were hidden behind an expander).
  const rows = useMemo(() => {
    const out: Array<{
      log: ComboLogEntry;
      attempt: ComboLogEntry["attempts"][number] | null;
      index: number;
      total: number;
    }> = [];
    for (const log of logs) {
      if (search) {
        const q = search.toLowerCase();
        const hit =
          log.comboName.toLowerCase().includes(q) ||
          log.respondingModelId.toLowerCase().includes(q) ||
          (log.respondingModelName && log.respondingModelName.toLowerCase().includes(q)) ||
          log.attempts.some(
            (a) =>
              a.modelId.toLowerCase().includes(q) ||
              (a.displayName && a.displayName.toLowerCase().includes(q)) ||
              (a.error && a.error.toLowerCase().includes(q))
          );
        if (!hit) continue;
      }
      const attempts: Array<ComboLogEntry["attempts"][number] | null> =
        log.attempts.length ? log.attempts : [null];
      attempts.forEach((a, i) => {
        if (statusFilter === "success" && (a ? a.status !== "success" : !log.respondingModelId)) return;
        if (statusFilter === "failed" && (a ? a.status !== "failed" : Boolean(log.respondingModelId))) return;
        out.push({ log, attempt: a, index: i, total: attempts.length });
      });
    }
    return out;
  }, [logs, search, statusFilter]);

  // Log-level filtering for the REQUEST (grouped) view.
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (statusFilter === "success" && !log.respondingModelId) return false;
      if (statusFilter === "failed" && log.respondingModelId) return false;
      if (search) {
        const q = search.toLowerCase();
        const hit =
          log.comboName.toLowerCase().includes(q) ||
          log.respondingModelId.toLowerCase().includes(q) ||
          (log.respondingModelName && log.respondingModelName.toLowerCase().includes(q)) ||
          log.attempts.some(
            (a) =>
              a.modelId.toLowerCase().includes(q) ||
              (a.displayName && a.displayName.toLowerCase().includes(q)) ||
              (a.error && a.error.toLowerCase().includes(q))
          );
        if (!hit) return false;
      }
      return true;
    });
  }, [logs, search, statusFilter]);

  const stats = useMemo(() => {
    const totalCount = logs.length;
    const successCount = logs.filter((l) => Boolean(l.respondingModelId)).length;
    const successRate = totalCount ? Math.round((successCount / totalCount) * 100) : 0;
    const totalTokens = logs.reduce((acc, l) => acc + l.tokensIn + l.tokensOut, 0);
    const totalDuration = logs.reduce((acc, l) => acc + l.durationMs, 0);
    const avgLatency = totalCount ? Math.round(totalDuration / totalCount) : 0;

    return {
      totalCount,
      successCount,
      successRate,
      totalTokens,
      avgLatency,
    };
  }, [logs]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="h-full flex flex-col p-4 md:p-8 max-w-7xl mx-auto w-full gap-4 overflow-y-auto scrollbar-thin">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Activity className="w-5 h-5 md:w-6 md:h-6 text-primary" />
            Live Combo Logs
          </h1>
          <p className="text-sm text-muted-foreground">
            Real-time tracking of multi-model fallback execution, attempts, and latency.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {/* Live Auto-Refresh Indicator */}
          <div className="flex items-center gap-2 bg-card/60 border border-border/60 px-2.5 py-1.5 rounded-lg text-xs">
            <Radio className={cn("w-3.5 h-3.5", autoRefresh ? "text-emerald-500 animate-pulse" : "text-muted-foreground")} />
            <span className="font-medium hidden sm:inline">{autoRefresh ? "Live (3s)" : "Paused"}</span>
            <Switch
              checked={autoRefresh}
              onCheckedChange={setAutoRefresh}
              className="scale-75 data-[state=checked]:bg-emerald-500"
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="gap-1.5"
            title={`Last updated: ${formatIndianTime(lastRefreshed)}`}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin text-primary")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (confirm("Are you sure you want to clear all combo logs?")) {
                clear();
                toast.success("Logs cleared");
              }
            }}
            disabled={logs.length === 0}
            className="text-destructive hover:bg-destructive/10 border-destructive/20"
          >
            <Trash2 className="w-4 h-4 mr-1.5" />
            Clear
          </Button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 shrink-0">
        <Card className="bg-card/40 backdrop-blur-xl border-border/60">
          <CardContent className="p-2.5 sm:p-4 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs text-muted-foreground font-medium truncate">Total Combo Calls</p>
              <h3 className="text-lg sm:text-2xl font-bold mt-0.5 sm:mt-1">{formatNumber(stats.totalCount)}</h3>
              <p className="text-[10px] sm:text-[11px] text-muted-foreground mt-0.5 truncate">
                {stats.successCount} ok ({stats.successRate}%)
              </p>
            </div>
            <div className="p-2 sm:p-3 rounded-xl bg-primary/10 text-primary shrink-0">
              <Boxes className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/40 backdrop-blur-xl border-border/60">
          <CardContent className="p-2.5 sm:p-4 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs text-muted-foreground font-medium truncate">Avg Latency</p>
              <h3 className="text-lg sm:text-2xl font-bold mt-0.5 sm:mt-1">
                {stats.avgLatency >= 1000
                  ? `${(stats.avgLatency / 1000).toFixed(2)}s`
                  : `${stats.avgLatency}ms`}
              </h3>
              <p className="text-[10px] sm:text-[11px] text-muted-foreground mt-0.5 truncate">Per combo request</p>
            </div>
            <div className="p-2 sm:p-3 rounded-xl bg-amber-500/10 text-amber-500 shrink-0">
              <Clock className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/40 backdrop-blur-xl border-border/60">
          <CardContent className="p-2.5 sm:p-4 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs text-muted-foreground font-medium truncate">Total Tokens</p>
              <h3 className="text-lg sm:text-2xl font-bold mt-0.5 sm:mt-1">{formatNumber(stats.totalTokens)}</h3>
              <p className="text-[10px] sm:text-[11px] text-muted-foreground mt-0.5 truncate">Prompt & completion</p>
            </div>
            <div className="p-2 sm:p-3 rounded-xl bg-emerald-500/10 text-emerald-500 shrink-0">
              <Zap className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/40 backdrop-blur-xl border-border/60">
          <CardContent className="p-2.5 sm:p-4 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs text-muted-foreground font-medium truncate">Success Rate</p>
              <h3 className="text-lg sm:text-2xl font-bold mt-0.5 sm:mt-1">{stats.successRate}%</h3>
              <p className="text-[10px] sm:text-[11px] text-muted-foreground mt-0.5 truncate">Fallback success</p>
            </div>
            <div
              className={cn(
                "p-2 sm:p-3 rounded-xl shrink-0",
                stats.successRate > 80
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "bg-rose-500/10 text-rose-500"
              )}
            >
              <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-stretch sm:items-center justify-between shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search combo, model, or error..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-card/40 border-border/60 h-9 sm:h-10"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <Button
            size="sm"
            variant={viewMode === "request" ? "default" : "outline"}
            onClick={() => setViewMode("request")}
            className="h-8 sm:h-9 text-xs"
            title="Ek card per request — pura fallback chain order mein"
          >
            Requests
          </Button>
          <Button
            size="sm"
            variant={viewMode === "attempt" ? "default" : "outline"}
            onClick={() => setViewMode("attempt")}
            className="h-8 sm:h-9 text-xs"
            title="Har attempt ka alag row (debug view)"
          >
            Attempts
          </Button>
          <span className="w-px h-5 bg-border/60 hidden sm:block" />
          <Button
            variant={statusFilter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter("all")}
            className="h-8 sm:h-9 text-xs"
          >
            All
          </Button>
          <Button
            variant={statusFilter === "success" ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter("success")}
            className="h-8 sm:h-9 text-xs text-emerald-500 hover:text-emerald-500"
          >
            Success
          </Button>
          <Button
            variant={statusFilter === "failed" ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter("failed")}
            className="h-8 sm:h-9 text-xs text-rose-500 hover:text-rose-500"
          >
            Failed
          </Button>
        </div>
      </div>

      {/* Logs Feed — one row per attempt: every fallback step + the member
          that actually responded gets its own log entry */}
      <div className="flex-1 space-y-2 pb-8">
        {viewMode === "request" ? (
          <>
            {filteredLogs.length === 0 ? (
              <Card className="bg-card/40 backdrop-blur-xl border-border/60 p-8 text-center">
                <Boxes className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
                <h3 className="text-base font-semibold">No Combo Logs Found</h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                  Requests through your Combos will appear here in real-time with detailed fallback traces.
                </p>
              </Card>
            ) : (
              filteredLogs.map((log) => {
                const isExpanded = expandedId === log.id;
                const isSuccess = Boolean(log.respondingModelId);
                const tokens = log.tokensIn + log.tokensOut;
                return (
                  <Card
                    key={log.id}
                    className="bg-card/40 backdrop-blur-xl border-border/60 transition-colors hover:border-border"
                  >
                    {/* Request header */}
                    <div
                      onClick={() => toggleExpand(log.id)}
                      className="p-3 sm:p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 cursor-pointer select-none"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <button className="shrink-0 text-muted-foreground hover:text-foreground">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                        <span
                          className={cn(
                            "shrink-0 px-2 py-0.5 text-[11px] font-medium rounded-full flex items-center gap-1",
                            isSuccess
                              ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                              : "bg-rose-500/10 text-rose-500 border border-rose-500/20"
                          )}
                        >
                          {isSuccess ? (
                            <>
                              <CheckCircle2 className="w-3 h-3" />
                              Served
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3 h-3" />
                              Failed
                            </>
                          )}
                        </span>
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
                            <span className="truncate font-semibold">{log.comboName}</span>
                            <span className="text-[11px] text-muted-foreground shrink-0">
                              · {log.attempts.length} attempt(s)
                            </span>
                          </div>
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                            <span className="shrink-0">{formatIndianDateTime(log.createdAt)}</span>
                            {isSuccess && (
                              <>
                                <span className="shrink-0">•</span>
                                <span className="truncate">
                                  served by{" "}
                                  <span className="text-foreground/80 font-medium">
                                    {log.respondingModelName || log.respondingModelId}
                                  </span>
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex min-w-0 items-center gap-4 sm:gap-6 text-xs shrink-0 pl-8 lg:pl-0">
                        <div className="text-left lg:text-right">
                          <div className="text-muted-foreground font-medium text-[11px]">Latency</div>
                          <div className="mt-0.5 flex items-center gap-1 font-medium text-foreground lg:justify-end">
                            <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            <span>
                              {log.durationMs >= 1000
                                ? `${(log.durationMs / 1000).toFixed(2)}s`
                                : `${log.durationMs}ms`}
                            </span>
                          </div>
                        </div>
                        <div className="text-left lg:text-right">
                          <div className="text-muted-foreground font-medium text-[11px]">Tokens</div>
                          <div className="mt-0.5 flex items-center gap-1 font-medium text-foreground lg:justify-end">
                            <Zap className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            <span>{tokens > 0 ? formatNumber(tokens) : "—"}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Fallback chain — ek hi request ke saare attempts ORDER mein.
                        Jaisa hi koi member respond karta hai, chain ruk jaati hai
                        (uske baad koi member call NAHI hota). */}
                    <div className="border-t border-border/40 px-3 sm:px-4 py-2 bg-muted/10 space-y-1">
                      {log.attempts.map((a, i) => (
                        <div key={i} className="min-w-0">
                          <div className="flex items-center gap-2 text-xs min-w-0 py-0.5">
                            <span className="w-5 h-5 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold shrink-0">
                              {i + 1}
                            </span>
                            <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                            <span className="min-w-0 truncate font-medium">
                              {a.displayName || a.modelId}
                            </span>
                            {a.status === "success" ? (
                              <span className="shrink-0 text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                                Responded ✓ stopped here
                              </span>
                            ) : (
                              <span className="shrink-0 text-rose-500 bg-rose-500/10 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                                Failed
                              </span>
                            )}
                            {a.durationMs !== undefined && (
                              <span className="shrink-0 text-muted-foreground ml-auto">
                                {a.durationMs >= 1000
                                  ? `${(a.durationMs / 1000).toFixed(2)}s`
                                  : `${a.durationMs}ms`}
                              </span>
                            )}
                          </div>
                          {isExpanded && a.error && (
                            <div className="mt-1 ml-7 rounded-lg border border-rose-500/20 bg-rose-500/5 p-2 font-mono text-[11px] text-rose-400 [overflow-wrap:anywhere] whitespace-pre-wrap">
                              {a.error}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </Card>
                );
              })
            )}
          </>
        ) : rows.length === 0 ? (
          <Card className="bg-card/40 backdrop-blur-xl border-border/60 p-8 text-center">
            <Boxes className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
            <h3 className="text-base font-semibold">No Combo Logs Found</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
              Requests through your Combos will appear here in real-time with detailed fallback traces.
            </p>
          </Card>
        ) : (
          rows.map(({ log, attempt, index, total }) => {
            const rowKey = `${log.id}:${index}`;
            const isExpanded = expandedId === rowKey;
            const isSuccess = attempt ? attempt.status === "success" : Boolean(log.respondingModelId);
            const tokens = isSuccess ? log.tokensIn + log.tokensOut : 0;
            const latency = attempt?.durationMs ?? (attempt ? undefined : log.durationMs);

            return (
              <Card
                key={rowKey}
                className="bg-card/40 backdrop-blur-xl border-border/60 transition-colors hover:border-border"
              >
                <div
                  onClick={() => toggleExpand(rowKey)}
                  className="p-3 sm:p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 cursor-pointer select-none"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <button className="shrink-0 text-muted-foreground hover:text-foreground">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>

                    <span
                      className={cn(
                        "shrink-0 px-2 py-0.5 text-[11px] font-medium rounded-full flex items-center gap-1",
                        isSuccess
                          ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                          : "bg-rose-500/10 text-rose-500 border border-rose-500/20"
                      )}
                    >
                      {isSuccess ? (
                        <>
                          <CheckCircle2 className="w-3 h-3" />
                          Responded
                        </>
                      ) : (
                        <>
                          <XCircle className="w-3 h-3" />
                          Failed
                        </>
                      )}
                    </span>

                    <div className="min-w-0 space-y-0.5">
                      <div className="min-w-0 truncate font-semibold text-sm">
                        {attempt?.displayName ||
                          attempt?.modelId ||
                          log.respondingModelName ||
                          log.respondingModelId ||
                          "Unknown"}
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        <Layers className="w-3 h-3 text-primary shrink-0" />
                        <span className="truncate">{log.comboName}</span>
                        <span className="shrink-0">•</span>
                        <span className="shrink-0">
                          attempt #{index + 1}/{total}
                        </span>
                        <span className="shrink-0">•</span>
                        <span className="shrink-0">{formatIndianDateTime(log.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex min-w-0 items-center gap-4 sm:gap-6 text-xs shrink-0 pl-8 lg:pl-0">
                    <div className="text-left lg:text-right">
                      <div className="text-muted-foreground font-medium text-[11px]">Latency</div>
                      <div className="mt-0.5 flex items-center gap-1 font-medium text-foreground lg:justify-end">
                        <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span>
                          {latency != null
                            ? latency >= 1000
                              ? `${(latency / 1000).toFixed(2)}s`
                              : `${latency}ms`
                            : "—"}
                        </span>
                      </div>
                    </div>
                    <div className="text-left lg:text-right">
                      <div className="text-muted-foreground font-medium text-[11px]">Tokens</div>
                      <div className="mt-0.5 flex items-center gap-1 font-medium text-foreground lg:justify-end">
                        <Zap className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>{tokens > 0 ? formatNumber(tokens) : "—"}</span>
                      </div>
                    </div>
                    {isSuccess && (
                      <div className="hidden sm:block text-right">
                        <div className="text-muted-foreground font-medium text-[11px]">In / Out</div>
                        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                          {formatNumber(log.tokensIn)} / {formatNumber(log.tokensOut)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border/40 p-3 sm:p-4 bg-muted/20 space-y-1.5 text-xs">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                      <span>
                        modelId:{" "}
                        <span className="font-mono text-foreground/80">
                          {attempt?.modelId || log.respondingModelId || "—"}
                        </span>
                      </span>
                      <span>
                        providerId:{" "}
                        <span className="font-mono text-foreground/80">
                          {attempt?.providerId || log.respondingProviderId || "—"}
                        </span>
                      </span>
                      <span>
                        comboId: <span className="font-mono text-foreground/80">{log.comboId}</span>
                      </span>
                      <span>
                        log: <span className="font-mono text-foreground/80">{log.id}</span>
                      </span>
                    </div>
                    {attempt?.error && (
                      <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-2 font-mono text-[11px] text-rose-400 [overflow-wrap:anywhere] whitespace-pre-wrap">
                        {attempt.error}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
