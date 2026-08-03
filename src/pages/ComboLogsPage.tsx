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
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Activity className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Combo Logs</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card/40 backdrop-blur-xl border-border/60">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Total Combo Calls</p>
              <h3 className="text-2xl font-bold mt-1">{formatNumber(stats.totalCount)}</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {stats.successCount} succeeded ({stats.successRate}%)
              </p>
            </div>
            <div className="p-3 rounded-xl bg-primary/10 text-primary">
              <Boxes className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/40 backdrop-blur-xl border-border/60">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Avg Latency</p>
              <h3 className="text-2xl font-bold mt-1">
                {stats.avgLatency >= 1000
                  ? `${(stats.avgLatency / 1000).toFixed(2)}s`
                  : `${stats.avgLatency}ms`}
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">Per combo request</p>
            </div>
            <div className="p-3 rounded-xl bg-amber-500/10 text-amber-500">
              <Clock className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/40 backdrop-blur-xl border-border/60">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Total Tokens Consumed</p>
              <h3 className="text-2xl font-bold mt-1">{formatNumber(stats.totalTokens)}</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">Prompt & completion</p>
            </div>
            <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-500">
              <Zap className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/40 backdrop-blur-xl border-border/60">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Success Rate</p>
              <h3 className="text-2xl font-bold mt-1">{stats.successRate}%</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">Fallback success</p>
            </div>
            <div
              className={cn(
                "p-3 rounded-xl",
                stats.successRate > 80
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "bg-rose-500/10 text-rose-500"
              )}
            >
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search combo, model, or error..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-card/40 border-border/60"
          />
        </div>
        <div className="flex items-center gap-2">
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
      <div className="space-y-3">
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
                  className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer select-none"
                >
                  <div className="flex items-center gap-3">
                    <button className="text-muted-foreground hover:text-foreground">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{log.comboName}</span>
                        <span
                          className={cn(
                            "px-2 py-0.5 text-[11px] font-medium rounded-full flex items-center gap-1",
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
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <span>{new Date(log.createdAt).toLocaleString()}</span>
                        <span>•</span>
                        <span>{log.attempts.length} attempt(s)</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 sm:gap-6 text-xs justify-between md:justify-end w-full md:w-auto mt-2 md:mt-0 border-t border-border/20 pt-3 md:border-0 md:pt-0">
                    {/* Responding Model */}
                    <div className="text-left md:text-right min-w-[100px] flex-1 sm:flex-initial">
                      <div className="text-muted-foreground font-medium text-[11px]">Responding Model</div>
                      <div className="font-medium text-foreground mt-0.5 flex items-center gap-1.5 justify-start md:justify-end">
                        <Layers className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="truncate max-w-[140px] sm:max-w-none">
                          {log.respondingModelName || log.respondingModelId || "None (Failed)"}
                        </span>
                      </div>
                    </div>

                    {/* Latency */}
                    <div className="text-left md:text-right shrink-0">
                      <div className="text-muted-foreground font-medium text-[11px]">Latency</div>
                      <div className="font-medium text-foreground mt-0.5 flex items-center gap-1 justify-start md:justify-end">
                        <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span>
                          {log.durationMs >= 1000
                            ? `${(log.durationMs / 1000).toFixed(2)}s`
                            : `${log.durationMs}ms`}
                        </span>
                      </div>
                    </div>

                    {/* Tokens */}
                    <div className="text-left md:text-right shrink-0">
                      <div className="text-muted-foreground font-medium text-[11px]">Tokens</div>
                      <div className="font-medium text-foreground mt-0.5 flex items-center gap-1 justify-start md:justify-end">
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
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-lg bg-card/60 border border-border/40 text-xs overflow-hidden"
                        >
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <span className="w-5 h-5 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold shrink-0">
                              #{i + 1}
                            </span>
                            <span className="font-medium truncate max-w-[200px] sm:max-w-none">
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

                          <div className="flex flex-wrap items-center gap-3 text-muted-foreground self-start sm:self-auto min-w-0">
                            {attempt.durationMs !== undefined && (
                              <span className="shrink-0">Latency: {attempt.durationMs}ms</span>
                            )}
                            {attempt.error && (
                              <span className="text-rose-400 font-mono text-[11px] truncate max-w-full sm:max-w-xs" title={attempt.error}>
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
