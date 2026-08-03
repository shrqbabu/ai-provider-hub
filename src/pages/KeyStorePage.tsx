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
import { useKeyStoreStore } from "@/store/keystore-store";
import { timeAgo } from "@/utils";

export function KeyStorePage() {
  const items = useKeyStoreStore((s) => s.items);
  const hydrated = useKeyStoreStore((s) => s.hydrated);
  const hydrate = useKeyStoreStore((s) => s.hydrate);
  const add = useKeyStoreStore((s) => s.add);
  const remove = useKeyStoreStore((s) => s.remove);

  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [keyValue, setKeyValue] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        await hydrate();
      } catch (err) {
        toast.error("Failed to load Key Store");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [hydrate]);

  const handleAdd = async () => {
    if (!keyValue.trim()) {
      toast.error("Please enter a key value.");
      return;
    }
    setAdding(true);
    try {
      add(label || "API Key", keyValue);
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

  const handleDelete = (id: string, label: string) => {
    if (!confirm(`Delete key "${label}" from database?`)) return;
    try {
      remove(id);
      toast.success("Key removed successfully.");
    } catch (err) {
      toast.error("Failed to delete key.");
    }
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
            <Input
              value={keyValue}
              type="password"
              onChange={(e) => setKeyValue(e.target.value)}
              placeholder="Key value (sk-...)"
              className="flex-1"
            />
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
              {items.map((k) => (
                <div
                  key={k.id}
                  className="flex items-center justify-between rounded-xl border border-dashed border-border/80 bg-card/20 px-4 py-4"
                >
                  <div className="min-w-0 pr-4 flex-1">
                    <div className="text-sm font-semibold flex items-center gap-2 text-foreground">
                      <KeyRound className="w-4 h-4 text-primary shrink-0" />
                      {k.label}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 truncate max-w-full font-mono bg-background border border-border/40 px-2 py-1 rounded select-all selection:bg-primary/20">
                      {k.keyValue}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopy(k.id, k.keyValue)}
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
                      className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-secondary transition shrink-0"
                      aria-label="Delete key"
                      title="Delete key"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
