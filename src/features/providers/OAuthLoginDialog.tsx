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
  KeyRound,
  ArrowRight,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useProviderStore } from "@/store/provider-store";
import { useModelStore } from "@/store/model-store";
import type { ConnectedProvider, DiscoveredModel, ProviderKey } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ProviderOption {
  id: string;
  name: string;
  desc: string;
  type: "device_code" | "authorization_code";
  badge: string;
  iconBg: string;
  baseURL: string;
  providerKey: ProviderKey;
  defaultModels: Array<{ id: string; name: string }>;
}

const OAUTH_OPTIONS: ProviderOption[] = [
  {
    id: "github",
    name: "GitHub Copilot",
    desc: "Official GitHub Copilot Device Flow — access GPT-4o, Claude 3.5 Sonnet, and o1-mini.",
    type: "device_code",
    badge: "Device Flow",
    iconBg: "bg-zinc-800 text-white",
    baseURL: "https://api.githubcopilot.com",
    providerKey: "custom",
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
    desc: "Connect your xAI account to access Grok 2, Grok 2 Vision, and Grok Beta.",
    type: "device_code",
    badge: "Device Flow",
    iconBg: "bg-black text-white",
    baseURL: "https://api.x.ai/v1",
    providerKey: "openai",
    defaultModels: [
      { id: "grok-2", name: "Grok 2" },
      { id: "grok-2-vision", name: "Grok 2 Vision" },
      { id: "grok-beta", name: "Grok Beta" },
      { id: "grok-vision-beta", name: "Grok Vision Beta" },
      { id: "grok-3", name: "Grok 3" },
      { id: "grok-3-mini", name: "Grok 3 Mini" },
    ],
  },
  {
    id: "kimi",
    name: "Kimi Coding CLI",
    desc: "Moonshot Kimi AI developer OAuth access for Kimi k1.5 and Moonshot models.",
    type: "device_code",
    badge: "Device Flow",
    iconBg: "bg-indigo-700 text-white",
    baseURL: "https://api.kimi.com/coding/v1",
    providerKey: "custom",
    defaultModels: [
      { id: "kimi-k1.5", name: "Kimi k1.5 (Coding)" },
      { id: "moonshot-v1-128k", name: "Moonshot v1 128k" },
    ],
  },
  {
    id: "antigravity",
    name: "Google Antigravity (Cloud Code)",
    desc: "Login with Google to unlock internal Cloud Code models (Claude 3.5 Sonnet v2, Gemini 2.5 Pro).",
    type: "authorization_code",
    badge: "Google OAuth",
    iconBg: "bg-blue-600 text-white",
    baseURL: "https://cloudcode-pa.googleapis.com",
    providerKey: "google",
    defaultModels: [
      { id: "claude-3-5-sonnet-v2", name: "Claude 3.5 Sonnet v2 (Antigravity)" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (Antigravity)" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (Antigravity)" },
    ],
  },
  {
    id: "claude",
    name: "Claude Code CLI",
    desc: "Anthropic Claude Pro/Team OAuth authorization for Claude 3.7 & 3.5 Sonnet.",
    type: "authorization_code",
    badge: "Anthropic PKCE",
    iconBg: "bg-amber-700 text-white",
    baseURL: "https://api.anthropic.com/v1",
    providerKey: "anthropic",
    defaultModels: [
      { id: "claude-3-7-sonnet-latest", name: "Claude 3.7 Sonnet" },
      { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet" },
      { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku" },
    ],
  },
  {
    id: "codex",
    name: "OpenAI Codex CLI",
    desc: "OpenAI CLI OAuth flow for GPT-4o, o1-preview, and o3-mini models.",
    type: "authorization_code",
    badge: "OpenAI PKCE",
    iconBg: "bg-emerald-800 text-white",
    baseURL: "https://api.openai.com/v1",
    providerKey: "openai",
    defaultModels: [
      { id: "gpt-4o", name: "GPT-4o (Codex)" },
      { id: "o1-preview", name: "o1 Preview" },
      { id: "o3-mini", name: "o3 Mini" },
    ],
  },
];

export function OAuthLoginDialog({ open, onOpenChange }: Props) {
  const [selectedProvider, setSelectedProvider] = useState<string>("github");
  const [step, setStep] = useState<"select" | "device_poll" | "pkce_input" | "success">("select");
  
  // Device flow state
  const [deviceData, setDeviceData] = useState<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval: number;
  } | null>(null);

  // PKCE flow state
  const [pkceData, setPkceData] = useState<{
    authUrl: string;
    codeVerifier: string;
  } | null>(null);
  const [authCodeInput, setAuthCodeInput] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [connectedUser, setConnectedUser] = useState<any>(null);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const addProvider = useProviderStore((s) => s.add);
  const upsertModels = useModelStore((s) => s.upsertMany);

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
      setPkceData(null);
      setAuthCodeInput("");
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
    const opt = OAUTH_OPTIONS.find((o) => o.id === selectedProvider);
    if (!opt) return;

    try {
      if (opt.type === "device_code") {
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
        setStep("device_poll");
        startPolling(selectedProvider, data.device_code, data.interval || 5);
      } else {
        // PKCE Flow
        const res = await fetch("/api/oauth/pkce/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: selectedProvider }),
        });

        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Failed to initialize PKCE login");
        }

        setPkceData(data);
        setStep("pkce_input");
        window.open(data.authUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to start OAuth login");
    } finally {
      setLoading(false);
    }
  };

  const handleExchangePkce = async () => {
    if (!authCodeInput.trim() || !pkceData) {
      toast.error("Please enter the authorization code");
      return;
    }

    setLoading(true);
    setPollError(null);
    try {
      const res = await fetch("/api/oauth/pkce/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedProvider,
          code: authCodeInput.trim(),
          code_verifier: pkceData.codeVerifier,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to exchange code for token");
      }

      setConnectedUser(data.user);
      setStep("success");
      handleSaveConnectedProvider(selectedProvider, data);
    } catch (err: any) {
      setPollError(err.message || "Code exchange failed");
      toast.error(err.message || "Code exchange failed");
    } finally {
      setLoading(false);
    }
  };

  const [checkingNow, setCheckingNow] = useState(false);

  const checkPollOnce = async () => {
    if (!deviceData) return;
    setCheckingNow(true);
    setPollError(null);
    try {
      const res = await fetch("/api/oauth/device/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedProvider,
          device_code: deviceData.device_code,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Poll check failed");
      }

      if (data.status === "success") {
        clearTimer();
        setConnectedUser(data.user);
        setStep("success");
        handleSaveConnectedProvider(selectedProvider, data);
      } else if (data.status === "pending") {
        toast.info("Waiting for approval. Make sure you entered the code and clicked 'Authorize' in your browser.");
      } else if (data.status === "expired") {
        clearTimer();
        setPollError("Code expired. Please request a new code.");
      } else if (data.status === "error") {
        setPollError(data.error || "Authentication failed");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to check status");
    } finally {
      setCheckingNow(false);
    }
  };

  const startPolling = (provider: string, deviceCode: string, intervalSeconds: number) => {
    clearTimer();
    const intervalMs = Math.max(intervalSeconds, 4) * 1000;

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

  const handleSaveConnectedProvider = (providerId: string, authData: any) => {
    const opt = OAUTH_OPTIONS.find((o) => o.id === providerId);
    if (!opt) return;

    const providerName = authData.user?.name
      ? `${opt.name} (${authData.user.name})`
      : opt.name;

    const newProvider = addProvider({
      name: providerName,
      displayName: providerName,
      key: opt.providerKey,
      authMode: "oauth",
      apiKey: authData.accessToken,
      apiKeys: [authData.accessToken],
      refreshToken: authData.refreshToken,
      tokenExpiry: authData.expiresIn ? Date.now() + authData.expiresIn * 1000 : undefined,
      baseURL: opt.baseURL,
      streaming: true,
      vision: true,
      fileUpload: false,
      isCustom: false,
      extraHeaders: authData.providerSpecificData ? { ...authData.providerSpecificData } : undefined,
    });

    const builtModels: Array<Omit<DiscoveredModel, "id">> = opt.defaultModels.map((m) => ({
      providerId: newProvider.id,
      providerKey: opt.providerKey,
      modelId: m.id,
      displayName: m.name,
      contextWindow: 128000,
      vision: true,
      pdf: false,
      streaming: true,
      toolCalling: true,
      reasoning: m.id.includes("o1") || m.id.includes("o3") || m.id.includes("thinking"),
      working: true,
      saved: true,
      tier: "paid",
    }));

    upsertModels(builtModels);
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
      <DialogContent className="sm:max-w-lg bg-zinc-950 border-zinc-800 text-zinc-100 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            Connect via OAuth / Device Flow
          </DialogTitle>
          <DialogDescription className="text-zinc-400 text-sm">
            Sign in securely using official OAuth authorization. No manual API keys needed.
          </DialogDescription>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-1 gap-2.5 max-h-[380px] overflow-y-auto pr-1">
              {OAUTH_OPTIONS.map((opt) => {
                const isSelected = selectedProvider === opt.id;
                return (
                  <div
                    key={opt.id}
                    onClick={() => setSelectedProvider(opt.id)}
                    className={`flex items-start gap-3.5 p-3 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? "bg-zinc-900/90 border-emerald-500/60 ring-1 ring-emerald-500/30 shadow-md"
                        : "bg-zinc-900/40 border-zinc-800 hover:bg-zinc-900/70 hover:border-zinc-700"
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${opt.iconBg}`}
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
                      <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{opt.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800/80">
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

        {step === "device_poll" && deviceData && (
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
                variant="outline"
                onClick={checkPollOnce}
                disabled={checkingNow}
                className="w-full border-emerald-600/50 text-emerald-400 hover:bg-emerald-950/40 gap-2 font-medium"
              >
                {checkingNow ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Approved in Browser? Click to Finalize Now
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

        {step === "pkce_input" && pkceData && (
          <div className="space-y-4 pt-2">
            <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-2 text-xs text-zinc-300">
              <p className="font-semibold text-zinc-100 flex items-center gap-1.5">
                <KeyRound className="w-4 h-4 text-emerald-400" />
                Step 1: Authorize in Browser
              </p>
              <p className="text-zinc-400 leading-relaxed">
                A browser tab was opened to authorize with {selectedOpt?.name}. If it didn't open, click the button below:
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(pkceData.authUrl, "_blank", "noopener,noreferrer")}
                className="w-full border-zinc-700 hover:bg-zinc-800 gap-1.5 mt-1"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Re-open {selectedOpt?.name} Login Page
              </Button>
            </div>

            <div className="space-y-2 pt-1">
              <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1">
                <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
                Step 2: Paste Authorization Code or Redirect URL
              </label>
              <Input
                placeholder="Paste code or callback URL here..."
                value={authCodeInput}
                onChange={(e) => setAuthCodeInput(e.target.value)}
                className="bg-zinc-900 border-zinc-700 text-xs font-mono py-2"
              />
            </div>

            {pollError && (
              <div className="p-2.5 bg-rose-950/40 border border-rose-800/60 rounded-lg flex items-center gap-2 text-xs text-rose-300">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{pollError}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800/80">
              <Button
                variant="ghost"
                onClick={() => setStep("select")}
                className="text-zinc-400 hover:text-zinc-200"
              >
                Back
              </Button>
              <Button
                onClick={handleExchangePkce}
                disabled={loading || !authCodeInput.trim()}
                className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2 font-medium"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                Exchange & Connect
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
                  : "Authentication completed and saved to your provider store."}
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
              Done & Start Using
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
