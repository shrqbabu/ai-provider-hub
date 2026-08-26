import { useMemo, useState } from "react";
import {
  ArrowRight,
  Copy,
  Gauge,
  Minimize2,
  Sparkles,
  Type,
  Wand2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea, Label, Input } from "@/components/ui/input";
import { useSettingsStore } from "@/store/settings-store";
import { usePromptStore } from "@/store/prompt-store";
import { COMPRESS_MODES, compressPrompt } from "@/utils/compress";
import { estimateTokens, formatNumber, cn } from "@/utils";
import type { CompressMode } from "@/types";
import { toast } from "sonner";

const SAMPLE =
  "I would like you to please kindly review this document in detail. Basically, it is important to note that we actually need a concise summary. Make sure to highlight the key findings, don't forget to mention risks, and in order to save time just skip the fluff. At this point in time we really want the shortest correct answer.";

export function CompressStudioPage() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const addPrompt = usePromptStore((s) => s.add);
  const [draft, setDraft] = useState(SAMPLE);
  const [playMode, setPlayMode] = useState<CompressMode>(
    settings.promptCompressMode || "smart"
  );

  const result = useMemo(() => compressPrompt(draft, playMode), [draft, playMode]);
  const ratio = result.before > 0 ? Math.round((1 - result.after / result.before) * 100) : 0;
  const stats = settings.compressStats;

  return (
    <div className="h-full overflow-y-auto scrollbar-thin pb-24 md:pb-8">
      <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-5">
        <div className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/20 via-card to-violet-600/10 p-5 md:p-8">
          <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
          <div className="flex items-center gap-2 text-primary text-xs font-semibold uppercase tracking-[0.18em]">
            <Sparkles className="w-4 h-4" /> Premium · Compress Studio
          </div>
          <h1 className="mt-2 text-2xl md:text-3xl font-bold tracking-tight">
            Spend fewer tokens.
            <span className="block text-primary">Keep the meaning.</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-xl">
            Token compress shrinks older chat turns when the window fills up.
            Prompt compress tightens system and context prompts before they leave the device.
          </p>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <Stat label="Saved" value={formatNumber(stats?.tokensSaved ?? 0)} />
            <Stat label="Runs" value={String(stats?.runs ?? 0)} />
            <Stat
              label="Mode"
              value={(settings.tokenCompressMode || "smart").toUpperCase()}
            />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <ToggleCard
            icon={Minimize2}
            title="Token compress"
            desc="When context crosses the threshold, older turns are extractively compressed. The latest messages stay intact."
            checked={settings.tokenCompress !== false}
            onChange={(v) => update({ tokenCompress: v })}
            mode={settings.tokenCompressMode || "smart"}
            onMode={(m) => update({ tokenCompressMode: m })}
          />
          <ToggleCard
            icon={Type}
            title="Prompt compress"
            desc="Collapse whitespace, drop filler, and trim long system / context prompts before the request is built."
            checked={settings.promptCompress !== false}
            onChange={(v) => update({ promptCompress: v })}
            mode={settings.promptCompressMode || "smart"}
            onMode={(m) => update({ promptCompressMode: m })}
          />
        </div>

        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5 text-primary" /> Token budget
            </div>
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <Label>Trigger threshold</Label>
                <div className="flex items-center gap-3 mt-2">
                  <input
                    type="range"
                    min={40}
                    max={95}
                    value={Math.round((settings.tokenCompressThreshold ?? 0.75) * 100)}
                    onChange={(e) =>
                      update({ tokenCompressThreshold: Number(e.target.value) / 100 })
                    }
                    className="flex-1 accent-[hsl(var(--primary))]"
                  />
                  <span className="text-sm font-semibold w-10 text-right">
                    {Math.round((settings.tokenCompressThreshold ?? 0.75) * 100)}%
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Compress when used context exceeds this share of the window.
                </p>
              </div>
              <div>
                <Label>Keep last messages</Label>
                <Input
                  type="number"
                  min={2}
                  max={40}
                  className="mt-2"
                  value={settings.keepLastMessages ?? 6}
                  onChange={(e) =>
                    update({ keepLastMessages: Math.max(2, Number(e.target.value) || 6) })
                  }
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Recent turns are never compressed.
                </p>
              </div>
              <div>
                <Label>Reserve for reply</Label>
                <Input
                  type="number"
                  min={256}
                  step={256}
                  className="mt-2"
                  value={settings.contextReserveTokens ?? 4096}
                  onChange={(e) =>
                    update({
                      contextReserveTokens: Math.max(256, Number(e.target.value) || 4096),
                    })
                  }
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Tokens held back so the model can still answer.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Wand2 className="w-3.5 h-3.5 text-primary" /> Live playground
              </div>
              <div className="flex gap-1">
                {COMPRESS_MODES.filter((m) => m.id !== "off").map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setPlayMode(m.id)}
                    className={cn(
                      "px-2.5 h-8 rounded-lg text-xs font-medium border",
                      playMode === m.id
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border hover:bg-secondary"
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid md:grid-cols-[1fr_auto_1fr] gap-3 items-stretch">
              <div className="space-y-1.5">
                <Label>Original · {formatNumber(estimateTokens(draft))} tok</Label>
                <Textarea
                  rows={10}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="min-h-[200px]"
                />
              </div>
              <div className="hidden md:flex items-center justify-center">
                <div className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center">
                  <ArrowRight className="w-5 h-5" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Compressed · {formatNumber(result.after)} tok</Label>
                <Textarea rows={10} readOnly value={result.text} className="min-h-[200px]" />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm">
                Saved{" "}
                <span className="font-semibold text-emerald-400">
                  {formatNumber(result.saved)}
                </span>{" "}
                tokens
                <span className="text-muted-foreground"> ({ratio}%)</span>
              </div>
              <div className="flex-1" />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(result.text);
                  toast.success("Compressed text copied");
                }}
              >
                <Copy className="w-3.5 h-3.5" /> Copy
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  addPrompt({
                    title: "Compressed prompt",
                    content: result.text,
                    tags: ["compressed"],
                    folder: "Context",
                    kind: "context",
                  });
                  toast.success("Saved as a context prompt");
                }}
              >
                Save as context
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-background/40 border border-border/50 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

function ToggleCard({
  icon: Icon,
  title,
  desc,
  checked,
  onChange,
  mode,
  onMode,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  mode: CompressMode;
  onMode: (m: CompressMode) => void;
}) {
  return (
    <Card className={checked ? "ring-1 ring-primary/30" : ""}>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
              <Icon className="w-4.5 h-4.5" />
            </div>
            <div className="font-semibold">{title}</div>
          </div>
          <Switch checked={checked} onCheckedChange={onChange} />
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
        <div className="grid grid-cols-4 gap-1.5">
          {COMPRESS_MODES.map((m) => (
            <button
              key={m.id}
              disabled={!checked && m.id !== "off"}
              onClick={() => onMode(m.id)}
              className={cn(
                "rounded-lg text-[11px] py-1.5 font-medium border",
                mode === m.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-secondary"
              )}
              title={m.hint}
            >
              {m.label}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
