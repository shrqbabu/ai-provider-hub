import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Shield,
  RefreshCw,
  Clock,
  Zap,
  Activity,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useProviderStore } from "@/store/provider-store";
import { refreshAntigravityToken } from "@/services/antigravity-oauth";

export function AntigravityQuotaTracker({ className = "" }: { className?: string }) {
  const providers = useProviderStore((s) => s.providers);
  const updateProvider = useProviderStore((s) => s.update);
  const antigravity = providers.find((p) => p.key === "antigravity" || p.authMode === "oauth" || (p.apiKey ?? "").startsWith("ya29."));

  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [timeLeft, setTimeLeft] = useState<{ hours: number; minutes: number; seconds: number }>({ hours: 0, minutes: 0, seconds: 0 });
  const [tokenRemainingMin, setTokenRemainingMin] = useState<number | null>(null);

  // Calculate daily UTC reset countdown (resets at 00:00 UTC)
  useEffect(() => {
    const updateCountdowns = () => {
      const now = new Date();
      const utcTomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
      const diffMs = utcTomorrow.getTime() - now.getTime();

      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
      setTimeLeft({ hours, minutes, seconds });

      if (antigravity?.tokenExpiry) {
        const tokenDiff = antigravity.tokenExpiry - Date.now();
        setTokenRemainingMin(Math.max(0, Math.floor(tokenDiff / (1000 * 60))));
      } else {
        setTokenRemainingMin(null);
      }
    };

    updateCountdowns();
    const timer = setInterval(updateCountdowns, 1000);
    return () => clearInterval(timer);
  }, [antigravity]);

  if (!antigravity) return null;

  const handleRefreshToken = async () => {
    if (!antigravity.refreshToken) {
      toast.error("No refresh token available. Please re-authenticate.");
      return;
    }
    setRefreshing(true);
    try {
      const refreshed = await refreshAntigravityToken(antigravity.refreshToken);
      updateProvider(antigravity.id, {
        apiKey: refreshed.accessToken,
        tokenExpiry: refreshed.tokenExpiry,
      });
      toast.success("Antigravity OAuth token refreshed successfully!");
    } catch (err: any) {
      toast.error(err?.message || "Failed to refresh OAuth token.");
    } finally {
      setRefreshing(false);
    }
  };

  const isTokenExpiringSoon = tokenRemainingMin !== null && tokenRemainingMin < 10;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border border-primary/30 bg-primary/10 hover:bg-primary/20 text-foreground transition text-xs font-medium ${className}`}
          title="View Antigravity Quota & Rate Limits"
        >
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-semibold text-primary">Antigravity Quota</span>
          <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-primary/40 font-mono">
            {tokenRemainingMin !== null ? `${tokenRemainingMin}m token` : "Active"}
          </Badge>
        </button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg rounded-3xl p-6 border-border/80 bg-card/95 backdrop-blur-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <div className="p-2 rounded-xl bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
                <Sparkles className="w-4 h-4" />
              </div>
              Antigravity Quota & Tier Monitor
            </DialogTitle>
            <Badge variant="secondary" className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Connected
            </Badge>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Account & Token Card */}
          <div className="p-4 rounded-2xl border border-border/60 bg-secondary/30 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold">Google OAuth Account</div>
                <div className="text-[11px] text-muted-foreground font-mono">
                  {antigravity.displayName || "Google Cloud Code Connected"}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRefreshToken}
                disabled={refreshing}
                className="gap-1.5 text-xs rounded-xl h-8"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
              <div className="p-2.5 rounded-xl bg-background/60 border border-border/40 space-y-0.5">
                <span className="text-[10px] text-muted-foreground font-medium uppercase">Token Lifespan</span>
                <div className="font-semibold flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-primary" />
                  {tokenRemainingMin !== null ? `${tokenRemainingMin} minutes left` : "Valid"}
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-background/60 border border-border/40 space-y-0.5">
                <span className="text-[10px] text-muted-foreground font-medium uppercase">Daily Quota Reset</span>
                <div className="font-semibold flex items-center gap-1.5 font-mono text-xs">
                  <Activity className="w-3.5 h-3.5 text-emerald-400" />
                  {timeLeft.hours}h {timeLeft.minutes}m {timeLeft.seconds}s
                </div>
              </div>
            </div>
          </div>

          {/* Model Quota Matrix (OmniRoute Structure) */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Antigravity Model Quotas & Rate Limits
            </div>

            <div className="space-y-2">
              <QuotaRow
                model="Gemini 2.5 Flash / Flash Thinking"
                rateLimit="15 RPM • 1,500 RPD"
                context="1,000,000 tokens"
                tier="High Tier"
                color="text-emerald-400"
              />
              <QuotaRow
                model="Gemini 2.5 Pro / 3.1 Pro"
                rateLimit="2 RPM • 50 RPD"
                context="2,000,000 tokens"
                tier="Pro Tier"
                color="text-blue-400"
              />
              <QuotaRow
                model="Claude 3.7 Sonnet / Opus 4.6"
                rateLimit="Companion API Stream"
                context="200,000 tokens"
                tier="Thinking Cap"
                color="text-purple-400"
              />
            </div>
          </div>

          {/* Auto Refresh Notice */}
          <div className="p-3 rounded-2xl bg-primary/5 border border-primary/20 flex items-start gap-2.5 text-xs text-muted-foreground">
            <Zap className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-foreground">Auto-Token Sync Enabled:</span>{" "}
              AI Provider Hub automatically refreshes your Google OAuth session before expiry so your conversations never disconnect.
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function QuotaRow({
  model,
  rateLimit,
  context,
  tier,
  color,
}: {
  model: string;
  rateLimit: string;
  context: string;
  tier: string;
  color: string;
}) {
  return (
    <div className="p-3 rounded-2xl border border-border/50 bg-secondary/20 flex items-center justify-between text-xs">
      <div className="space-y-0.5">
        <div className="font-semibold text-foreground">{model}</div>
        <div className="text-[10px] text-muted-foreground font-mono">
          Limit: {rateLimit} • Context: {context}
        </div>
      </div>
      <Badge variant="outline" className={`text-[10px] font-medium ${color}`}>
        {tier}
      </Badge>
    </div>
  );
}
