import { useState, useEffect } from "react";
import { Cookie, RefreshCw, Send, CheckCircle2, AlertCircle, Server, KeyRound, Clock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const PROVIDERS = [
  { id: "arena", name: "Arena AI", desc: "arena-auth-prod-v1.0 & v1.1 session cookies from arena.ai" },
  { id: "monkeycode", name: "MonkeyCode AI", desc: "Session cookies from monkeycode-ai.net" },
  { id: "claude", name: "Claude (Anthropic)", desc: "sessionKey cookie from claude.ai" },
  { id: "gemini", name: "Google Gemini", desc: "SID, HSID, SSID, SAPISID, __Secure-1PSID cookies from gemini.google.com" },
  { id: "chatgpt", name: "ChatGPT (OpenAI)", desc: "__Secure-next-auth.session-token cookie from chat.openai.com" },
  { id: "qwen", name: "Qwen AI", desc: "Session cookies from chat.qwen.ai" },
  { id: "perplexity", name: "Perplexity AI", desc: "Session cookies from perplexity.ai" },
  { id: "deepseek", name: "DeepSeek AI", desc: "Session cookies from chat.deepseek.com" },
  { id: "zai", name: "Z.AI", desc: "Session cookies from chat.z.ai" },
  { id: "groq", name: "Groq", desc: "Session cookies from groq.com" },
];

export function CookieManagerPage() {
  const [gatewayUrl, setGatewayUrl] = useState(() => localStorage.getItem("gateway_cookie_url") || "http://localhost:8080");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("gateway_cookie_key") || "sk-shariqarafat6396827211");
  const [selectedProvider, setSelectedProvider] = useState("arena");
  const [cookieValue, setCookieValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, any>>({});
  const [checkingStatus, setCheckingStatus] = useState(false);

  useEffect(() => {
    localStorage.setItem("gateway_cookie_url", gatewayUrl);
  }, [gatewayUrl]);

  useEffect(() => {
    localStorage.setItem("gateway_cookie_key", apiKey);
  }, [apiKey]);

  const fetchStatuses = async () => {
    setCheckingStatus(true);
    try {
      const cleanUrl = gatewayUrl.replace(/\/+$/, "");
      const res = await fetch(`${cleanUrl}/v1/cookies`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!res.ok) {
        throw new Error(`Gateway returned ${res.status}`);
      }

      const data = await res.json();
      setStatuses(data);
      toast.success("Cookie statuses loaded from gateway");
    } catch (err: any) {
      toast.error(`Failed to fetch statuses: ${err.message || err}`);
    } finally {
      setCheckingStatus(false);
    }
  };

  useEffect(() => {
    fetchStatuses();
  }, []);

  const handleUpdateCookie = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cookieValue.trim()) {
      toast.error("Please enter a cookie string");
      return;
    }

    setLoading(true);
    try {
      const cleanUrl = gatewayUrl.replace(/\/+$/, "");
      const res = await fetch(`${cleanUrl}/v1/cookies`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          provider: selectedProvider,
          cookie: cookieValue.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Failed to update cookie");
      }

      toast.success(`Cookie updated for ${selectedProvider}!`);
      setCookieValue("");
      fetchStatuses();
    } catch (err: any) {
      toast.error(`Update failed: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const selectedProviderMeta = PROVIDERS.find((p) => p.id === selectedProvider);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-primary/10 text-primary">
            <Cookie className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Gateway Cookie Manager</h1>
            <p className="text-xs text-muted-foreground">
              Update Web2API Gateway cookies remotely without logging into VPS
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={fetchStatuses}
          disabled={checkingStatus}
          className="gap-2 rounded-xl"
        >
          <RefreshCw className={`w-4 h-4 ${checkingStatus ? "animate-spin" : ""}`} />
          Refresh Status
        </Button>
      </div>

      {/* Gateway Connection Settings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5" /> Gateway Base URL
          </label>
          <Input
            value={gatewayUrl}
            onChange={(e) => setGatewayUrl(e.target.value)}
            placeholder="http://localhost:8080 or https://yourdomain.duckdns.org"
            className="rounded-xl bg-background/50"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5" /> Gateway API Key
          </label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-shariqarafat6396827211"
            className="rounded-xl bg-background/50"
          />
        </div>
      </div>

      {/* Update Form & Provider Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Form Column */}
        <div className="md:col-span-2 space-y-4">
          <form onSubmit={handleUpdateCookie} className="p-5 rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl space-y-4">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Send className="w-4 h-4 text-primary" /> Update Provider Cookie
            </h2>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Select AI Provider</label>
              <select
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value)}
                className="w-full rounded-xl bg-background border border-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.id})
                  </option>
                ))}
              </select>
              {selectedProviderMeta && (
                <p className="text-[11px] text-muted-foreground mt-1">{selectedProviderMeta.desc}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Cookie Value String</label>
              <textarea
                value={cookieValue}
                onChange={(e) => setCookieValue(e.target.value)}
                rows={5}
                placeholder="Paste browser cookies here (e.g. sessionKey=sk-ant-sid01-... or SID=...; HSID=...)"
                className="w-full rounded-xl bg-background border border-input p-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary scrollbar-thin"
              />
            </div>

            <Button type="submit" disabled={loading} className="w-full rounded-xl gap-2 font-medium">
              <Send className="w-4 h-4" />
              {loading ? "Updating Cookie..." : `Save Cookie for ${selectedProviderMeta?.name || selectedProvider}`}
            </Button>
          </form>
        </div>

        {/* Statuses Column */}
        <div className="space-y-3">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold px-1">
            Provider Statuses
          </h2>
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1 scrollbar-thin">
            {PROVIDERS.map((p) => {
              const st = statuses[p.id];
              const isOk = st?.configured;
              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedProvider(p.id)}
                  className={`p-3 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                    selectedProvider === p.id
                      ? "border-primary bg-primary/5"
                      : "border-border/60 bg-card/40 hover:bg-secondary/40"
                  }`}
                >
                  <div>
                    <div className="text-xs font-medium">{p.name}</div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3" />
                      {st?.last_updated ? new Date(st.last_updated).toLocaleTimeString() : "No timestamp"}
                    </div>
                  </div>
                  <Badge variant={isOk ? "default" : "outline"} className="text-[10px] gap-1">
                    {isOk ? (
                      <>
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Active
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-3 h-3 text-amber-400" /> Empty
                      </>
                    )}
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
