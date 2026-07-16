import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search, MessageSquare, Layers, Plug2, BookOpen } from "lucide-react";
import { useChatStore } from "@/store/chat-store";
import { useModelStore } from "@/store/model-store";
import { useProviderStore } from "@/store/provider-store";
import { usePromptStore } from "@/store/prompt-store";
import { cn, truncate } from "@/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function SearchDialog({ open, onOpenChange }: Props) {
  const [q, setQ] = useState("");
  const chats = useChatStore((s) => s.chats).filter((c) => !c.deleted);
  const models = useModelStore((s) => s.models);
  const providers = useProviderStore((s) => s.providers);
  const prompts = usePromptStore((s) => s.prompts);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  const results = useMemo(() => {
    const s = q.toLowerCase().trim();
    if (!s) return [];
    const out: Array<{
      kind: "chat" | "model" | "provider" | "prompt";
      id: string;
      label: string;
      sub?: string;
      onSelect: () => void;
    }> = [];
    for (const c of chats) {
      if (
        c.title.toLowerCase().includes(s) ||
        c.messages.some((m) => m.content.toLowerCase().includes(s))
      ) {
        out.push({
          kind: "chat",
          id: c.id,
          label: c.title,
          sub: `${c.messages.length} messages`,
          onSelect: () => navigate(`/chat/${c.id}`),
        });
      }
    }
    for (const m of models) {
      if (
        m.modelId.toLowerCase().includes(s) ||
        m.displayName.toLowerCase().includes(s)
      ) {
        out.push({
          kind: "model",
          id: m.id,
          label: m.displayName,
          sub: m.modelId,
          onSelect: () => navigate("/models"),
        });
      }
    }
    for (const p of providers) {
      if (p.displayName.toLowerCase().includes(s)) {
        out.push({
          kind: "provider",
          id: p.id,
          label: p.displayName,
          sub: p.baseURL,
          onSelect: () => navigate("/providers"),
        });
      }
    }
    for (const pr of prompts) {
      if (
        pr.title.toLowerCase().includes(s) ||
        pr.content.toLowerCase().includes(s)
      ) {
        out.push({
          kind: "prompt",
          id: pr.id,
          label: pr.title,
          sub: truncate(pr.content, 60),
          onSelect: () => navigate("/prompts"),
        });
      }
    }
    return out.slice(0, 40);
  }, [q, chats, models, providers, prompts, navigate]);

  const iconOf = (k: string) => {
    if (k === "chat") return MessageSquare;
    if (k === "model") return Layers;
    if (k === "provider") return Plug2;
    return BookOpen;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 overflow-hidden">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="border-b border-border/60 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Search chats, models, providers, prompts..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-10 border-0 h-12 rounded-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-[400px] overflow-y-auto scrollbar-thin">
          {q && results.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No results.
            </div>
          )}
          {!q && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Type to search everything.
            </div>
          )}
          {results.map((r) => {
            const Icon = iconOf(r.kind);
            return (
              <button
                key={r.kind + r.id}
                onClick={() => {
                  r.onSelect();
                  onOpenChange(false);
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent transition text-left"
                )}
              >
                <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{r.label}</div>
                  {r.sub && (
                    <div className="text-xs text-muted-foreground truncate">
                      {r.sub}
                    </div>
                  )}
                </div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {r.kind}
                </span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
