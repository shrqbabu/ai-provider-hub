import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  Loader2,
  CheckCircle2,
  Copy,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useProviderStore } from "@/store/provider-store";
import { useModelStore } from "@/store/model-store";
import type { ConnectedProvider } from "@/types";
import { withClaudePrefix } from "@/utils/model-prefix";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ProviderOption {
  id: string;
  name: string;
  desc: string;
  badge: string;
  iconBg: string;
  baseURL: string;
  defaultModels: Array<{ id: string; name: string }>;
}

const OAUTH_OPTIONS: ProviderOption[] = [
  {
    id: "github",
    name: "GitHub Copilot",
    desc: "Sign in with your GitHub account via Device Flow to use Copilot models.",
    badge: "Official Device Flow",
    iconBg: "bg-zinc-800 text-white",
    baseURL: "https://api.githubcopilot.com",
    defaultModels: [
      { id: "gpt-4o", name: "GPT-4o (Copilot)" },
      { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet (Copilot)" },
      { id: "o1-mini", name: "o1-mini (Copilot)" },
      { id: "o3-mini", name: "o3-mini (Copilot)" },
    ],
  },
  {
    id: "grok",
    name: "xAI Grok Build",
    desc: "Connect your xAI account to access Grok 2 and Grok Beta models.",
    badge: "Official Device Flow",
    iconBg: "bg-black text-white",
    baseURL: "https://api.x.ai/v1",
    defaultModels: [
      { id: "grok-2-latest", name: "Grok 2 (Latest)" },
      { id: "grok-2-vision-latest", name: "Grok 2 Vision" },
      { id: "grok-beta", name: "Grok Beta" },
    ],
  },
];

export function OAuthLoginDialog({ open, onOpenChange }: Props) {
  const [selectedProvider, setSelectedProvider] = useState<string>("github");
  const [step, setStep] = useState<"select" | "authenticating" | "success">("select");
  const [deviceData, setDeviceData] = useState<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [connectedUser, setConnectedUser] = useState<any>(null);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const { addProvider } = useProviderStore();
  const { addModel } = useModelStore();

  const clearTimer = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!open) {
      clearTimer();
      setStep("select");
      setDeviceData(null);
      setPollError(null);
      setConnectedUser(null);
    }
  }, [open]);

  useEffect(() => {
    return () => clearTimer();
  }, []);

  const handleStartAuth = async () => {
    setLoading(true);
    setPollError(null);
    try {
      const res = await fetch("/api/oauth/device/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: selectedProvider }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to initiate device authentication");
      }

      setDeviceData(data);
      setStep("authenticating");
      startPolling(selectedProvider, data.device_code, data.interval || 5);
    } catch (err: any) {
      toast.error(err.message || "Failed to start OAuth login");
    } finally {
      setLoading(false);
    }
  };

  const startPolling = (provider: string, deviceCode: string, intervalSeconds: number) => {
    clearTimer();
    const intervalMs = Math.max(intervalSeconds, 5) * 1000;

    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/oauth/device/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            device_code: deviceCode,
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.ok) return;

        if (data.status === "success") {
          clearTimer();
          setConnectedUser(data.user);
          setStep("success");
          handleSaveConnectedProvider(provider, data);
        } else if (data.status === "expired") {
          clearTimer();
          setPollError("Code expired. Please request a new code.");
        } else if (data.status === "error") {
          clearTimer();
          setPollError(data.error || "Authentication failed");
        }
      } catch {
        // network retry
      }
    }, intervalMs);
  };

  const handleSaveConnectedProvider = async (providerId: string, authData: any) => {
    const opt = OAUTH_OPTIONS.find((o) => o.id === providerId);
    if (!opt) return;

    const providerName = authData.user?.name
      ? `${opt.name} (${authData.user.name})`
      : opt.name;

    const provider: ConnectedProvider = {
      id: `${providerId}-oauth-${Date.now()}`,
      name: providerName,
      key: providerId as any,
      apiFormat: "openai",
      authMode: "bearer",
      apiKey: authData.accessToken,
      apiKeys: [authData.accessToken],
      baseURL: opt.baseURL,
      streaming: true,
      vision: true,
      fileUpload: false,
      connectedAt: Date.now(),
      isCustom: false,
      extraHeaders: authData.providerSpecificData ? { ...authData.providerSpecificData } : undefined,
    };

    await addProvider(provider);

    for (const m of opt.defaultModels) {
      await addModel({
        id: `${provider.id}-${m.id}`,
        name: m.name,
        provider: provider.name,
        providerId: provider.id,
        contextLength: 128000,
        maxOutputTokens: 8192,
        inputCost: 0,
        outputCost: 0,
        capabilities: ["chat", "streaming"],
        tier: "standard",
        status: "active",
        claudeModelId: withClaudePrefix(m.id),
      });
    }

    toast.success(`Successfully connected ${opt.name}!`);
  };

  const handleCopy = () => {
    if (!deviceData?.user_code) return;
    navigator.clipboard.writeText(deviceData.user_code);
    setCopied(true);
    toast.success("Code copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenLink = () => {
    if (!deviceData) return;
    const url = deviceData.verification_uri_complete || deviceData.verification_uri;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const selectedOpt = OAUTH_OPTIONS.find((o) => o.id === selectedProvider);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-zinc-950 border-zinc-800 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            Connect via OAuth / Device Flow
          </DialogTitle>
          <DialogDescription className="text-zinc-400 text-sm">
            Sign in securely using official device authentication. No manual API keys required.
          </DialogDescription>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-4 pt-2">
            <div className="space-y-2.5">
              {OAUTH_OPTIONS.map((opt) => {
                const isSelected = selectedProvider === opt.id;
                return (
                  <div
                    key={opt.id}
                    onClick={() => setSelectedProvider(opt.id)}
                    className={`flex items-start gap-3.5 p-3.5 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? "bg-zinc-900/90 border-emerald-500/60 ring-1 ring-emerald-500/30"
                        : "bg-zinc-900/40 border-zinc-800 hover:bg-zinc-900/70 hover:border-zinc-700"
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 ${opt.iconBg}`}
                    >
                      {opt.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm text-zinc-100">{opt.name}</span>
                        <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
                          {opt.badge}
                        </Badge>
                      </div>
                      <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{opt.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </Button>
              <Button
                onClick={handleStartAuth}
                disabled={loading}
                className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2 font-medium"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                Continue with {selectedOpt?.name}
              </Button>
            </div>
          </div>
        )}

        {step === "authenticating" && deviceData && (
          <div className="space-y-5 pt-2 text-center">
            <div className="space-y-1.5">
              <p className="text-xs text-zinc-400 uppercase tracking-wider font-semibold">
                Your One-Time Code
              </p>
              <div className="flex items-center justify-center gap-2">
                <div className="bg-zinc-900 border border-zinc-700/80 px-6 py-3 rounded-xl font-mono text-2xl tracking-widest font-bold text-emerald-400 shadow-inner">
                  {deviceData.user_code}
                </div>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={handleCopy}
                  className="h-12 w-12 rounded-xl border-zinc-700 hover:bg-zinc-800"
                >
                  {copied ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <Copy className="w-5 h-5 text-zinc-300" />
                  )}
                </Button>
              </div>
            </div>

            <div className="p-3.5 bg-zinc-900/50 border border-zinc-800 rounded-xl space-y-2 text-left">
              <p className="text-xs text-zinc-300 font-medium">Next Steps:</p>
              <ol className="text-xs text-zinc-400 space-y-1 list-decimal list-inside leading-relaxed">
                <li>Copy the code above.</li>
                <li>Click the button below to open the official verification page.</li>
                <li>Paste the code and approve permissions in your browser.</li>
              </ol>
            </div>

            <div className="flex items-center justify-center gap-2 text-xs text-zinc-400 py-1">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
              <span>Waiting for authorization in browser...</span>
            </div>

            {pollError && (
              <div className="p-2.5 bg-rose-950/40 border border-rose-800/60 rounded-lg flex items-center gap-2 text-xs text-rose-300">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{pollError}</span>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-1">
              <Button
                onClick={handleOpenLink}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium gap-2 py-5"
              >
                <ExternalLink className="w-4 h-4" />
                Open {selectedOpt?.name} Login Page
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep("select")}
                className="text-zinc-400 hover:text-zinc-200"
              >
                Back to Providers
              </Button>
            </div>
          </div>
        )}

        {step === "success" && (
          <div className="space-y-4 pt-4 text-center">
            <div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-lg text-zinc-100">
                {selectedOpt?.name} Connected!
              </h3>
              <p className="text-xs text-zinc-400">
                {connectedUser?.name
                  ? `Authenticated as ${connectedUser.name}`
                  : "Authentication completed successfully."}
              </p>
            </div>
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-left text-xs space-y-1">
              <span className="text-zinc-400 font-medium">Added Models:</span>
              <ul className="text-zinc-300 list-disc list-inside">
                {selectedOpt?.defaultModels.map((m) => (
                  <li key={m.id}>{m.name}</li>
                ))}
              </ul>
            </div>
            <Button
              onClick={() => onOpenChange(false)}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
            >
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
