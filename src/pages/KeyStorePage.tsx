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
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useKeyStoreStore } from "@/store/keystore-store";
import { timeAgo } from "@/utils";

export function KeyStorePage() {
  const items = useKeyStoreStore((s) => s.items);
  const hydrated = useKeyStoreStore((s) => s.hydrated);
  const hydrate = useKeyStoreStore((s) => s.hydrate);
  const add = useKeyStoreStore((s) => s.add);
  const remove = useKeyStoreStore((s) => s.remove);

  const [loading, setLoading] = useState(!hydrated);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [keyValue, setKeyValue] = useState("");
  const [showKeyValue, setShowKeyValue] = useState(false);
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!hydrated) {
        setLoading(true);
        try {
          await hydrate();
        } catch (err) {
          toast.error("Failed to load Key Store");
        } finally {
          if (mounted) setLoading(false);
        }
      } else {
        setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [hydrated, hydrate]);

  const handleAdd = async () => {
    if (!keyValue.trim()) {
      toast.error("Please enter a key value.");
      return;
    }
    setAdding(true);
    try {
      await add(label || "API Key", keyValue);
      setLabel("");
      setKeyValue("");
      toast.success("Key successfully saved to database.");
    } catch (err) {
      toast.error("Failed to save key.");
    } finally {
      setAdding(false);
    }
  };

  const handleCopy = (id: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedId(id);
    toast.success("Copied key value to clipboard.");
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleDelete = async (id: string, label: string) => {
    if (!confirm(`Delete key "${label}" from database?`)) return;
    try {
      await remove(id);
      toast.success("Key removed successfully.");
    } catch (err) {
      toast.error("Failed to delete key.");
    }
  };

  const toggleReveal = (id: string) => {
    setRevealedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
              <KeyRound className="w-5 h-5 md:w-6 md:h-6 text-primary" />
              API Key Store (Database)
            </h1>
            <p className="text-sm text-muted-foreground">
              Store, label and retrieve any custom API keys or passwords. Everything is saved securely to your remote database.
            </p>
          </div>
        </div>

        {/* Create */}
        <div className="rounded-2xl border border-dashed border-border/80 bg-card/20 p-5 space-y-4">
          <div className="text-sm font-medium">Add a new key to the store</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (e.g. My OpenAI Key, Anthropic Dev)"
              className="flex-1"
            />
            <div className="relative flex-1">
              <Input
                value={keyValue}
                type={showKeyValue ? "text" : "password"}
                onChange={(e) => setKeyValue(e.target.value)}
                placeholder="Key value (sk-...)"
                className="w-full pr-9"
              />
              <button
                type="button"
                onClick={() => setShowKeyValue(!showKeyValue)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-md transition-colors"
                title={showKeyValue ? "Hide key value" : "Show key value"}
                tabIndex={-1}
              >
                {showKeyValue ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleAdd} disabled={adding}>
              {adding ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Save to Database
            </Button>
          </div>
        </div>

        {/* Existing keys with dashed border and copy button */}
        <div className="space-y-3">
          <div className="text-sm font-medium">Your stored keys</div>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading key store…
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/80 p-8 text-center text-sm text-muted-foreground">
              No keys stored yet. Add a key above to save it to your database.
            </div>
          ) : (
            <div className="grid gap-3">
              {items.map((k) => {
                const isRevealed = Boolean(revealedIds[k.id]);
                const maskedValue = k.keyValue.length > 8
                  ? `${k.keyValue.slice(0, 4)}••••••••${k.keyValue.slice(-4)}`
                  : "••••••••••••";

                return (
                  <div
                    key={k.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card/40 p-4 hover:border-primary/40 transition shadow-sm"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-sm font-semibold flex items-center gap-2 text-foreground">
                        <KeyRound className="w-4 h-4 text-primary shrink-0" />
                        <span>{k.label}</span>
                        <span className="text-[11px] text-muted-foreground font-normal">
                          • {timeAgo(k.createdAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-xs text-muted-foreground font-mono bg-background/80 border border-border/60 px-2.5 py-1 rounded-lg select-all selection:bg-primary/20 flex-1 sm:flex-initial">
                          {isRevealed ? k.keyValue : maskedValue}
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleReveal(k.id)}
                          className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/60 rounded-md transition"
                          title={isRevealed ? "Hide key" : "Show key"}
                        >
                          {isRevealed ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopy(k.id, k.keyValue)}
                        className="gap-1.5 rounded-xl h-8 text-xs"
                      >
                        {copiedId === k.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        {copiedId === k.id ? "Copied" : "Copy"}
                      </Button>
                      <button
                        onClick={() => handleDelete(k.id, k.label)}
                        className="p-2 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition shrink-0"
                        aria-label="Delete key"
                        title="Delete key"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
