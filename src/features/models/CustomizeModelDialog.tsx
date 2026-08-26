import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useModelStore } from "@/store/model-store";
import { usePromptStore } from "@/store/prompt-store";
import type { CompressMode, DiscoveredModel } from "@/types";
import { COMPRESS_MODES } from "@/utils/compress";
import { CONTEXT_TOKEN_PRESETS, OUTPUT_TOKEN_PRESETS } from "@/utils/token-limits";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  model: DiscoveredModel;
}

export function CustomizeModelDialog({ open, onOpenChange, model }: Props) {
  const update = useModelStore((s) => s.update);
  const prompts = usePromptStore((s) => s.prompts);
  const contexts = useMemo(
    () => prompts.filter((p) => (p.kind ?? "snippet") === "context"),
    [prompts]
  );

  const [f, setF] = useState(formFrom(model));

  useEffect(() => {
    if (open) setF(formFrom(model));
  }, [open, model]);

  const save = () => {
    update(model.id, {
      displayName: f.displayName.trim() || model.modelId,
      contextWindow: num(f.contextWindow) || undefined,
      tokenLimit: num(f.tokenLimit) || undefined,
      maxTokens: num(f.maxTokens) || undefined,
      temperature: f.temperature === "" ? undefined : Number(f.temperature),
      contextPromptId: f.contextPromptId === "none" ? "" : f.contextPromptId,
      customSystemPrompt: f.customSystemPrompt.trim() || undefined,
      tokenCompress: f.tokenCompress,
      promptCompress: f.promptCompress,
      compressMode: f.compressMode,
      vision: f.vision,
      pdf: f.pdf,
      streaming: f.streaming,
      toolCalling: f.toolCalling,
      reasoning: f.reasoning,
      inputPrice: num(f.inputPrice) || undefined,
      outputPrice: num(f.outputPrice) || undefined,
    });
    toast.success(`Saved custom settings for ${f.displayName || model.modelId}`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-primary" />
            Customize model
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Display name</Label>
            <Input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Model ID</Label>
            <Input value={model.modelId} readOnly className="opacity-70 font-mono text-xs" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Context window</Label>
              <Input
                type="number"
                value={f.contextWindow}
                onChange={(e) => setF({ ...f, contextWindow: e.target.value })}
                placeholder="e.g. 128000"
              />
              <PresetRow
                items={CONTEXT_TOKEN_PRESETS}
                onPick={(v) => setF({ ...f, contextWindow: String(v) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Input token limit</Label>
              <Input
                type="number"
                value={f.tokenLimit}
                onChange={(e) => setF({ ...f, tokenLimit: e.target.value })}
                placeholder="Override context"
              />
              <p className="text-[10px] text-muted-foreground">
                Budget used for token-compress. Empty = context window.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Max output tokens</Label>
              <Input
                type="number"
                value={f.maxTokens}
                onChange={(e) => setF({ ...f, maxTokens: e.target.value })}
                placeholder="Auto"
              />
              <PresetRow
                items={OUTPUT_TOKEN_PRESETS.filter((p) => p.value > 0)}
                onPick={(v) => setF({ ...f, maxTokens: String(v) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Temperature (0–2)</Label>
              <Input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={f.temperature}
                onChange={(e) => setF({ ...f, temperature: e.target.value })}
                placeholder="Provider default"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Context prompt</Label>
            <Select
              value={f.contextPromptId || "none"}
              onValueChange={(v) => setF({ ...f, contextPromptId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (inherit global)</SelectItem>
                {contexts.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Custom system prompt</Label>
            <Textarea
              rows={4}
              value={f.customSystemPrompt}
              onChange={(e) => setF({ ...f, customSystemPrompt: e.target.value })}
              placeholder="Always prepended when this model is used…"
            />
          </div>

          <div className="rounded-xl border border-border/70 p-3 space-y-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Compression
            </div>
            <Toggle
              label="Token compress"
              value={f.tokenCompress}
              onChange={(v) => setF({ ...f, tokenCompress: v })}
            />
            <Toggle
              label="Prompt compress"
              value={f.promptCompress}
              onChange={(v) => setF({ ...f, promptCompress: v })}
            />
            <div className="grid grid-cols-4 gap-1.5">
              {COMPRESS_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setF({ ...f, compressMode: m.id })}
                  className={
                    f.compressMode === m.id
                      ? "rounded-lg bg-primary text-primary-foreground text-[11px] py-1.5 font-medium"
                      : "rounded-lg border border-border text-[11px] py-1.5"
                  }
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Toggle label="Vision" value={f.vision} onChange={(v) => setF({ ...f, vision: v })} />
            <Toggle label="PDF" value={f.pdf} onChange={(v) => setF({ ...f, pdf: v })} />
            <Toggle label="Streaming" value={f.streaming} onChange={(v) => setF({ ...f, streaming: v })} />
            <Toggle label="Tool calling" value={f.toolCalling} onChange={(v) => setF({ ...f, toolCalling: v })} />
            <Toggle label="Reasoning" value={f.reasoning} onChange={(v) => setF({ ...f, reasoning: v })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Input $/1M</Label>
              <Input
                type="number"
                step="0.01"
                value={f.inputPrice}
                onChange={(e) => setF({ ...f, inputPrice: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Output $/1M</Label>
              <Input
                type="number"
                step="0.01"
                value={f.outputPrice}
                onChange={(e) => setF({ ...f, outputPrice: e.target.value })}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save}>Save custom</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formFrom(model: DiscoveredModel) {
  return {
    displayName: model.displayName,
    contextWindow: model.contextWindow ? String(model.contextWindow) : "",
    tokenLimit: model.tokenLimit ? String(model.tokenLimit) : "",
    maxTokens: model.maxTokens ? String(model.maxTokens) : "",
    temperature: model.temperature != null ? String(model.temperature) : "",
    contextPromptId: model.contextPromptId || "none",
    customSystemPrompt: model.customSystemPrompt || "",
    tokenCompress: model.tokenCompress !== false,
    promptCompress: model.promptCompress !== false,
    compressMode: (model.compressMode || "smart") as CompressMode,
    vision: model.vision,
    pdf: model.pdf,
    streaming: model.streaming,
    toolCalling: model.toolCalling,
    reasoning: model.reasoning,
    inputPrice: model.inputPrice != null ? String(model.inputPrice) : "",
    outputPrice: model.outputPrice != null ? String(model.outputPrice) : "",
  };
}

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border p-2.5">
      <span className="text-sm">{label}</span>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

function PresetRow({
  items,
  onPick,
}: {
  items: ReadonlyArray<{ id: string; label: string; value: number }>;
  onPick: (v: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onPick(p.value)}
          className="text-[10px] px-1.5 py-0.5 rounded-md border border-border hover:bg-secondary"
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
