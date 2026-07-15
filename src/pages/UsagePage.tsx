import { useMemo } from "react";
import { BarChart3, DollarSign, Clock, Zap } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useUsageStore } from "@/store/usage-store";
import { useProviderStore } from "@/store/provider-store";
import { formatNumber } from "@/utils";
import { toast } from "sonner";

const COLORS = ["#c99b6b", "#8b5a3c", "#d4a373", "#a8763e", "#e0b48c", "#6b4423"];

export function UsagePage() {
  const usage = useUsageStore((s) => s.usage);
  const providers = useProviderStore((s) => s.providers);
  const clear = useUsageStore((s) => s.clear);

  const stats = useMemo(() => {
    const now = Date.now();
    const day = 86400_000;
    const totals = usage.reduce(
      (a, u) => {
        a.in += u.tokensIn;
        a.out += u.tokensOut;
        a.cost += u.cost;
        a.dur += u.durationMs;
        a.count += 1;
        return a;
      },
      { in: 0, out: 0, cost: 0, dur: 0, count: 0 }
    );
    const daily = usage.filter((u) => now - u.createdAt < day);
    const monthly = usage.filter((u) => now - u.createdAt < 30 * day);
    return { totals, daily, monthly };
  }, [usage]);

  const byDay = useMemo(() => {
    const buckets: Record<string, { day: string; tokens: number; cost: number }> = {};
    for (const u of usage) {
      const key = new Date(u.createdAt).toISOString().slice(0, 10);
      const b = (buckets[key] ||= { day: key, tokens: 0, cost: 0 });
      b.tokens += u.tokensIn + u.tokensOut;
      b.cost += u.cost;
    }
    return Object.values(buckets).sort((a, b) => a.day.localeCompare(b.day)).slice(-14);
  }, [usage]);

  const byProvider = useMemo(() => {
    const map: Record<string, { name: string; tokens: number }> = {};
    for (const u of usage) {
      const p = providers.find((x) => x.id === u.providerId);
      const name = p?.displayName ?? u.providerKey;
      const m = (map[name] ||= { name, tokens: 0 });
      m.tokens += u.tokensIn + u.tokensOut;
    }
    return Object.values(map);
  }, [usage, providers]);

  const byModel = useMemo(() => {
    const map: Record<string, { name: string; tokens: number }> = {};
    for (const u of usage) {
      const m = (map[u.modelId] ||= { name: u.modelId, tokens: 0 });
      m.tokens += u.tokensIn + u.tokensOut;
    }
    return Object.values(map)
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 8);
  }, [usage]);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="w-5 h-5 md:w-6 md:h-6 text-primary" /> Usage
            </h1>
            <p className="text-sm text-muted-foreground">
              Local, on-device tracking of tokens, cost, and requests.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              if (confirm("Clear all usage data?")) {
                clear();
                toast.success("Usage cleared.");
              }
            }}
          >
            Clear
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="Total tokens" value={formatNumber(stats.totals.in + stats.totals.out)} icon={Zap} />
          <Stat label="Est. cost" value={`$${stats.totals.cost.toFixed(4)}`} icon={DollarSign} />
          <Stat label="Requests" value={stats.totals.count} icon={BarChart3} />
          <Stat
            label="Avg latency"
            value={
              stats.totals.count
                ? `${Math.round(stats.totals.dur / stats.totals.count)}ms`
                : "—"
            }
            icon={Clock}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <Card>
            <CardContent className="p-5">
              <div className="text-sm font-semibold mb-2">Tokens per day</div>
              <div style={{ height: 220 }}>
                <ResponsiveContainer>
                  <LineChart data={byDay}>
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(30 8% 12%)",
                        border: "1px solid hsl(30 8% 20%)",
                        borderRadius: 8,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="tokens"
                      stroke="hsl(24 55% 62%)"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="text-sm font-semibold mb-2">Tokens by provider</div>
              <div style={{ height: 220 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={byProvider}
                      dataKey="tokens"
                      nameKey="name"
                      outerRadius={80}
                      label
                    >
                      {byProvider.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-5">
            <div className="text-sm font-semibold mb-2">Top models</div>
            <div style={{ height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={byModel}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(30 8% 12%)",
                      border: "1px solid hsl(30 8% 20%)",
                      borderRadius: 8,
                    }}
                  />
                  <Bar dataKey="tokens" fill="hsl(24 55% 62%)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
          <Icon className="w-3 h-3" />
          {label}
        </div>
        <div className="text-xl font-bold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
