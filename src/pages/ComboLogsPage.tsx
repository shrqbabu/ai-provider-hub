import { useMemo, useState } from "react";
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
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useComboLogStore } from "@/store/combo-log-store";
import { formatNumber, cn } from "@/utils";
import { toast } from "sonner";
import type { ComboLogEntry } from "@/types";

export function ComboLogsPage() {
  const logs = useComboLogStore((s) => s.logs);
  const clear = useComboLogStore((s) => s.clear);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "failed">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const stats = useMemo(() => {
    let totalTokens = 0;
    let totalDuration = 0;
    let successCount = 0;

    for (const log of logs) {
      totalTokens += log.tokensIn + log.tokensOut;
      totalDuration += log.durationMs;
      if (log.respondingModelId) {
        successCount++;
      }
    }

    const avgLatency = logs.length ? Math.round(totalDuration / logs.length) : 0;
    const successRate = logs.length ? Math.round((successCount / logs.length) * 100) : 0;

    return {
      totalCount: logs.length,
      successCount,
      totalTokens,
      avgLatency,
      successRate,
    };
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const isSuccess = Boolean(log.respondingModelId);
      if (statusFilter === "success" && !isSuccess) return false;
      if (statusFilter === "failed" && isSuccess) return false;

      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        log.comboName.toLowerCase().includes(q) ||
        log.respondingModelId.toLowerCase().includes(q) ||
        (log.respondingModelName && log.respondingModelName.toLowerCase().includes(q)) ||
        log.attempts.some(
          (a) =>
            a.modelId.toLowerCase().includes(q) ||
            (a.displayName && a.displayName.toLowerCase().includes(q)) ||
            (a.error && a.error.toLowerCase().includes(q))
        )
      );
    });
  }, [logs, search, statusFilter]);

  const handleClear = () => {
    if (!logs.length) return;
    if (confirm("Are you sure you want to clear all combo logs?")) {
      clear();
      toast.success("Combo logs cleared.");
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="h-full flex flex-col p-3 sm:p-6 xl:p-8 max-w-7xl mx-auto space-y-4 sm:space-y-6 overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 sm:p-2 rounded-xl bg-primary/10 text-primary">
              <Activity className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <h1 className="text-lg sm:text-2xl font-bold tracking-tight">Combo Logs</h1>
          </div>
          <p className="hidden sm:block text-sm text-muted-foreground mt-1">
            Monitor AI Combo fallback executions, latency, token consumption, and responding models.
          </p>
        </div>
        {logs.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleClear}
            className="text-destructive hover:bg-destructive/10 border-destructive/20 self-start sm:self-auto"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Clear Logs
          </Button>
        )}
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
            variant={statusFilter === "all" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setStatusFilter("all")}
            className="text-xs"
          >
            All
          </Button>
          <Button
            variant={statusFilter === "success" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setStatusFilter("success")}
            className="text-xs text-emerald-500"
          >
            Success
          </Button>
          <Button
            variant={statusFilter === "failed" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setStatusFilter("failed")}
            className="text-xs text-rose-500"
          >
            Failed
          </Button>
        </div>
      </div>

      {/* Logs Table / List */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin space-y-3 pr-1">
        {filteredLogs.length === 0 ? (
          <Card className="bg-card/40 backdrop-blur-xl border-border/60 p-12 text-center">
            <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-3">
              <Activity className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold">No Combo Logs Found</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {logs.length === 0
                ? "Combo execution metrics will appear here when you select and chat using an AI Combo."
                : "No logs match your search filters."}
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
                        <span className="min-w-0 truncate">{new Date(log.createdAt).toLocaleString()}</span>
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
