import { useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  Gauge,
  Minimize2,
  Sparkles,
  Type,
} from "lucide-react";
import type { Chat, CompressMode, DiscoveredModel } from "@/types";
import { useChatStore } from "@/store/chat-store";
import { usePromptStore } from "@/store/prompt-store";
import { useSettingsStore } from "@/store/settings-store";
import { OUTPUT_TOKEN_PRESETS } from "@/utils/token-limits";
import { cn } from "@/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/input";
import { COMPRESS_MODES } from "@/utils/compress";

interface Props {
  chat: Chat;
  model?: DiscoveredModel;
}

export function ChatControls({ chat, model }: Props) {
  const update = useChatStore((s) => s.update);
  const prompts = usePromptStore((s) => s.prompts);
  const settings = useSettingsStore((s) => s.settings);
  const [sheet, setSheet] = useState<"context" | "compress" | "tokens" | null>(null);

  const contexts = useMemo(
    () => prompts.filter((p) => (p.kind ?? "snippet") === "context"),
    [prompts]
  );
  const activeContext = contexts.find(
    (p) => p.id === (chat.contextPromptId || settings.defaultContextPromptId)
  );

  const tokenOn = chat.tokenCompress ?? model?.tokenCompress ?? settings.tokenCompress !== false;
  const promptOn = chat.promptCompress ?? model?.promptCompress ?? settings.promptCompress !== false;
  const mode: CompressMode =
    chat.compressMode || model?.compressMode || settings.tokenCompressMode || "smart";
  const maxTokens = chat.maxTokens ?? model?.maxTokens ?? settings.maxTokens ?? 0;
  const maxLabel =
    OUTPUT_TOKEN_PRESETS.find((p) => p.value === maxTokens)?.label ??
    (maxTokens ? `${maxTokens}` : "Auto");

  return (
    <>
      <div className="mb-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
        <Chip
          icon={BookOpen}
          label={activeContext ? activeContext.title : "Context"}
          active={!!activeContext}
          onClick={() => setSheet("context")}
        />
        <Chip
          icon={Minimize2}
          label={tokenOn || promptOn ? `Compress · ${mode}` : "Compress off"}
          active={tokenOn || promptOn}
          onClick={() => setSheet("compress")}
        />
        <Chip
          icon={Gauge}
          label={`Out ${maxLabel}`}
          active={maxTokens > 0}
          onClick={() => setSheet("tokens")}
        />
      </div>

      <Dialog open={sheet === "context"} onOpenChange={(v) => !v && setSheet(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-primary" /> Context prompt
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2 mb-2">
            Injected as a system prompt for this chat. Model and global defaults apply if none is set.
          </p>
          <button
            onClick={() => {
              update(chat.id, { contextPromptId: "" });
              setSheet(null);
            }}
            className={cn(
              "w-full text-left rounded-xl border px-3 py-2.5 text-sm mb-2",
              !chat.contextPromptId ? "border-primary bg-primary/10" : "border-border hover:bg-secondary/60"
            )}
          >
            Use default {settings.defaultContextPromptId ? "(global)" : "(none)"}
          </button>
          <div className="space-y-1.5 max-h-[40vh] overflow-y-auto scrollbar-thin">
            {contexts.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  update(chat.id, { contextPromptId: p.id });
                  setSheet(null);
                }}
                className={cn(
                  "w-full text-left rounded-xl border px-3 py-2.5 transition",
                  chat.contextPromptId === p.id
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-secondary/60"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{p.title}</span>
                  {p.isDefault && (
                    <span className="text-[10px] uppercase tracking-wider text-primary">default</span>
                  )}
                  {chat.contextPromptId === p.id && <Check className="w-4 h-4 text-primary ml-auto" />}
                </div>
                <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{p.content}</p>
              </button>
            ))}
            {contexts.length === 0 && (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No context prompts yet. Create one in Prompts.
              </p>
            )}
          </div>
          <div className="space-y-1.5 pt-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Type className="w-3 h-3" /> Extra system note for this chat
            </div>
            <Textarea
              rows={3}
              value={chat.systemPrompt ?? ""}
              placeholder="Optional extra instructions…"
              onChange={(e) => update(chat.id, { systemPrompt: e.target.value })}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={sheet === "compress"} onOpenChange={(v) => !v && setSheet(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Minimize2 className="w-5 h-5 text-primary" /> Compress this chat
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Row
              label="Token compress"
              hint="Shrink older turns when context fills up"
              checked={tokenOn}
              onChange={(v) => update(chat.id, { tokenCompress: v })}
            />
            <Row
              label="Prompt compress"
              hint="Tighten the system / context prompt"
              checked={promptOn}
              onChange={(v) => update(chat.id, { promptCompress: v })}
            />
            <div>
              <div className="text-xs text-muted-foreground mb-2">Mode</div>
              <div className="grid grid-cols-4 gap-1.5">
                {COMPRESS_MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => update(chat.id, { compressMode: m.id })}
                    className={cn(
                      "rounded-xl border px-2 py-2 text-xs font-medium",
                      mode === m.id
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:bg-secondary"
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <Button variant="outline" className="w-full" onClick={() => setSheet(null)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={sheet === "tokens"} onOpenChange={(v) => !v && setSheet(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gauge className="w-5 h-5 text-primary" /> Output token limit
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">
            Caps the model's reply. Auto uses 16K (32K for reasoning models). Model-level custom limits still apply if you pick Auto.
          </p>
          <div className="grid grid-cols-4 gap-2">
            {OUTPUT_TOKEN_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  update(chat.id, { maxTokens: p.value });
                  setSheet(null);
                }}
                className={cn(
                  "rounded-xl border py-2.5 text-sm font-medium",
                  maxTokens === p.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-secondary"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Chip({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full border text-[11px] font-medium transition",
        active
          ? "border-primary/40 bg-primary/15 text-foreground"
          : "border-border/70 bg-secondary/50 text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="max-w-[140px] truncate">{label}</span>
      <ChevronDown className="w-3 h-3 opacity-60" />
    </button>
  );
}

function Row({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-2.5">
      <div>
        <div className="text-sm font-medium flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-primary" /> {label}
        </div>
        <div className="text-[11px] text-muted-foreground">{hint}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
