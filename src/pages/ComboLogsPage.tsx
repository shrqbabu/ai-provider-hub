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
      hydrate().then(() => setLastRefreshed(new Date()));
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
      setTimeout(() => setIsRefreshing(false), 400);
    }
  };

  const filteredLogs = useMemo(() => {
    return logs
      .filter((log) => {
        if (statusFilter === "success") return Boolean(log.respondingModelId);
        if (statusFilter === "failed") return !log.respondingModelId;
        return true;
      })
      .filter((log) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          log.comboName.toLowerCase().includes(q) ||
          log.respondingModelId.toLowerCase().includes(q) ||
          (log.respondingModelName && log.respondingModelName.toLowerCase().includes(q)) ||
          log.attempts.some(
            (a) =>
              a.modelId.toLowerCase().includes(q) ||
              (a.error && a.error.toLowerCase().includes(q))
          )
        );
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
        <div className="flex items-center gap-2 self-start sm:self-auto">
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

      {/* Logs Feed */}
      <div className="flex-1 space-y-3 pb-8">
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
            const totalTokens = log.tokensIn + log.tokensOut;

            return (
              <Card
                key={log.id}
                className="bg-card/40 backdrop-blur-xl border-border/60 transition-colors hover:border-border"
              >
                <div
                  onClick={() => toggleExpand(log.id)}
                  className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 cursor-pointer select-none"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <button className="shrink-0 text-muted-foreground hover:text-foreground">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>

                    <div className="min-w-0 space-y-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate font-semibold text-sm">{log.comboName}</span>
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
                              Success
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3 h-3" />
                              Failed
                            </>
                          )}
                        </span>
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span className="min-w-0 truncate font-medium text-foreground/80">{formatIndianDateTime(log.createdAt)}</span>
                        <span className="shrink-0">•</span>
                        <span className="shrink-0">{log.attempts.length} attempt(s)</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex min-w-0 w-full flex-wrap items-center justify-between gap-3 border-t border-border/20 pt-3 text-xs sm:gap-6 lg:mt-0 lg:w-auto lg:justify-end lg:border-0 lg:pt-0">
                    {/* Responding Model */}
                    <div className="min-w-0 flex-1 text-left lg:flex-initial lg:text-right">
                      <div className="text-muted-foreground font-medium text-[11px]">Responding Model</div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 font-medium text-foreground lg:justify-end">
                        <Layers className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="min-w-0 max-w-[11rem] truncate sm:max-w-[16rem] lg:max-w-[14rem] xl:max-w-[18rem]">
                          {log.respondingModelName || log.respondingModelId || "None (Failed)"}
                        </span>
                      </div>
                    </div>

                    {/* Latency */}
                    <div className="shrink-0 text-left lg:text-right">
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

                    {/* Tokens */}
                    <div className="shrink-0 text-left lg:text-right">
                      <div className="text-muted-foreground font-medium text-[11px]">Tokens</div>
                      <div className="mt-0.5 flex items-center gap-1 font-medium text-foreground lg:justify-end">
                        <Zap className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>{formatNumber(totalTokens)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded Attempts Breakdown */}
                {isExpanded && (
                  <div className="border-t border-border/40 p-4 bg-muted/20 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">
                      Fallback Attempt Details:
                    </p>
                    <div className="space-y-2">
                      {log.attempts.map((attempt, i) => (
                        <div
                          key={i}
                          className="flex flex-col justify-between gap-2 overflow-hidden rounded-lg border border-border/40 bg-card/60 p-2.5 text-xs lg:flex-row lg:items-center"
                        >
                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold shrink-0">
                              #{i + 1}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {attempt.displayName || attempt.modelId}
                            </span>
                            {attempt.status === "success" ? (
                              <span className="text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0">
                                Responded
                              </span>
                            ) : (
                              <span className="text-rose-500 bg-rose-500/10 px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0">
                                Failed
                              </span>
                            )}
                          </div>

                          <div className="flex min-w-0 w-full flex-wrap items-center gap-3 self-start text-muted-foreground lg:w-auto lg:self-auto">
                            {attempt.durationMs !== undefined && (
                              <span className="shrink-0">Latency: {attempt.durationMs}ms</span>
                            )}
                            {attempt.error && (
                              <span className="w-full min-w-0 break-words font-mono text-[11px] text-rose-400 [overflow-wrap:anywhere] lg:w-auto lg:max-w-xs">
                                Error: {attempt.error}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
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
