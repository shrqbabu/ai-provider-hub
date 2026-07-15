import { useState } from "react";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useModelStore } from "@/store/model-store";
import type { ConnectedProvider } from "@/types";
import { inferTier } from "@/constants/providers";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  provider: ConnectedProvider;
}

export function AddModelDialog({ open, onOpenChange, provider }: Props) {
  const modelStore = useModelStore();
  const [f, setF] = useState({
    displayName: "",
    modelId: "",
    contextWindow: "",
    vision: false,
    pdf: false,
    streaming: true,
    toolCalling: false,
    reasoning: false,
  });

  const save = () => {
    if (!f.modelId.trim()) {
      toast.error("Model ID is required.");
      return;
    }
    const tier = inferTier({
      providerKey: provider.key,
      modelId: f.modelId.trim(),
      baseURL: provider.baseURL,
    });
    modelStore.add({
      providerId: provider.id,
      providerKey: provider.key,
      modelId: f.modelId.trim(),
      displayName: f.displayName.trim() || f.modelId.trim(),
      contextWindow: f.contextWindow ? Number(f.contextWindow) : undefined,
      vision: f.vision,
      pdf: f.pdf,
      streaming: f.streaming,
      toolCalling: f.toolCalling,
      reasoning: f.reasoning,
      tier,
      manual: true,
      saved: true,
      createdAt: Date.now(),
    });
    toast.success(`Added ${f.modelId}`);
    onOpenChange(false);
    setF({
      displayName: "",
      modelId: "",
      contextWindow: "",
      vision: false,
      pdf: false,
      streaming: true,
      toolCalling: false,
      reasoning: false,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add model manually</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Display name</Label>
            <Input
              value={f.displayName}
              onChange={(e) => setF({ ...f, displayName: e.target.value })}
              placeholder="Claude 3.5 Sonnet"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Model ID</Label>
            <Input
              value={f.modelId}
              onChange={(e) => setF({ ...f, modelId: e.target.value })}
              placeholder="claude-3-5-sonnet-20241022"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Context window (tokens)</Label>
            <Input
              type="number"
              value={f.contextWindow}
              onChange={(e) => setF({ ...f, contextWindow: e.target.value })}
              placeholder="200000"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Toggle label="Vision" value={f.vision} onChange={(v) => setF({ ...f, vision: v })} />
            <Toggle label="PDF" value={f.pdf} onChange={(v) => setF({ ...f, pdf: v })} />
            <Toggle label="Streaming" value={f.streaming} onChange={(v) => setF({ ...f, streaming: v })} />
            <Toggle label="Tool calling" value={f.toolCalling} onChange={(v) => setF({ ...f, toolCalling: v })} />
            <Toggle label="Reasoning" value={f.reasoning} onChange={(v) => setF({ ...f, reasoning: v })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}><Plus className="w-4 h-4" /> Add model</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
