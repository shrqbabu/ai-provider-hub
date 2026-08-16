import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  KeyRound,
  Plus,
  Copy,
  Check,
  Trash2,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listGatewayKeys,
  createGatewayKey,
  revokeGatewayKey,
  type GatewayKey,
} from "@/services/gateway-keys-service";
import { useAuthStore } from "@/store/auth-store";
import { timeAgo } from "@/utils";

export function ApiKeysPage() {
  const [keys, setKeys] = useState<GatewayKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);

  const origin = window.location.origin;

  const load = async () => {
    setLoading(true);
    try {
      setKeys(await listGatewayKeys());
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load keys."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading) {
      load();
    }
  }, [authLoading, user]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await createGatewayKey(label || "Gateway key");
      setNewRawKey(res.raw);
      if (res.key) {
        setKeys((prev) => [res.key, ...prev.filter((k) => k.id !== res.key.id)]);
      }
      setLabel("");
      toast.success("Key created! Copy it now — it won't be shown again.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create key.");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (key: GatewayKey) => {
    if (!confirm(`Revoke "${key.label}" (…${key.last4})? Apps using it will stop working.`))
      return;
    setKeys((prev) => prev.filter((k) => k.id !== key.id));
    try {
      await revokeGatewayKey(key.id);
      toast.success("Key deleted / revoked.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke key.");
      await load();
    }
  };

  const copyRaw = () => {
    if (!newRawKey) return;
    navigator.clipboard.writeText(newRawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const activeKeys = keys.filter((k) => !k.revoked);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
              <KeyRound className="w-5 h-5 md:w-6 md:h-6 text-primary" />
              Gateway API Keys
            </h1>
            <p className="text-sm text-muted-foreground">
              One key to call every provider you've connected — OpenAI, Claude,
              NVIDIA, and more — through a single OpenAI-compatible endpoint.
            </p>
          </div>
        </div>

        {/* Newly created key banner (shown once) */}
        {newRawKey && (
          <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <ShieldAlert className="w-4 h-4" />
              Copy your key now — it won't be shown again.
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg bg-background border border-border px-3 py-2 text-xs font-mono break-all">
                {newRawKey}
              </code>
              <Button variant="outline" size="sm" onClick={copyRaw}>
                {copied ? (
                  <Check className="w-4 h-4 text-emerald-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <button
              onClick={() => setNewRawKey(null)}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              I've saved it — dismiss
            </button>
          </div>
        )}

        {/* Create */}
        <div className="rounded-2xl border border-border/60 bg-card/40 p-4 space-y-3">
          <div className="text-sm font-medium">Create a new key</div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (e.g. My laptop, Production app)"
              className="flex-1"
            />
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Generate key
            </Button>
          </div>
        </div>

        {/* Existing keys */}
        <div className="space-y-2">
          <div className="text-sm font-medium">Your keys</div>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : activeKeys.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No keys yet. Generate one above to start using your gateway.
            </div>
          ) : (
            <div className="space-y-2">
              {activeKeys.map((k) => (
                <div
                  key={k.id}
                  className="flex items-center justify-between rounded-xl border border-border/60 bg-card/40 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{k.label}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      ah-…{k.last4} · created {timeAgo(k.createdAt)}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRevoke(k)}
                    className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-secondary transition shrink-0"
                    aria-label="Revoke key"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Usage */}
        <div className="rounded-2xl border border-border/60 bg-card/40 p-4 space-y-3">
          <div className="text-sm font-medium">How to use it</div>
          <p className="text-xs text-muted-foreground">
            The gateway auto-detects the right provider from the{" "}
            <code>model</code> name (it matches against the models you've added).
            You can also force one with a prefix like{" "}
            <code>openai/gpt-4o</code> or <code>anthropic/claude-opus-4-8</code>.
          </p>

          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground">curl</div>
            <pre className="rounded-lg bg-background border border-border p-3 text-xs font-mono overflow-x-auto">
{`curl ${origin}/v1/chat/completions \\
  -H "Authorization: Bearer ah-…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "claude-3-7-sonnet",
    "messages": [{"role":"user","content":"Hello!"}]
  }'`}
            </pre>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground">OpenAI SDK (Python / JS)</div>
            <pre className="rounded-lg bg-background border border-border p-3 text-xs font-mono overflow-x-auto">
{`from openai import OpenAI

client = OpenAI(
    base_url="${origin}/v1",
    api_key="ah-…",
)

# Same key works across every provider and model you've connected:
client.chat.completions.create(model="gemini-2.5-pro", messages=[...])
client.chat.completions.create(model="claude-3-7-sonnet", messages=[...])`}
            </pre>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground">
              Combos — automatic fallback
            </div>
            <p className="text-xs text-muted-foreground">
              Call a combo by its name and the gateway tries its models in your
              priority order — if the first is rate-limited or down, it falls
              through to the next automatically. Combos also show up in{" "}
              <code>GET /v1/models</code>.
            </p>
            <pre className="rounded-lg bg-background border border-border p-3 text-xs font-mono overflow-x-auto">
{`# "smart-router" is a combo you defined on the Combos page:
client.chat.completions.create(model="smart-router", messages=[...])`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
