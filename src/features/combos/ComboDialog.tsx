import { useMemo, useState, useEffect } from "react";
import { Plus, ArrowUp, ArrowDown, Trash2, Boxes, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useComboStore } from "@/store/combo-store";
import { useModelStore } from "@/store/model-store";
import { useProviderStore } from "@/store/provider-store";
import type { Combo, ComboMember } from "@/types";
import { toast } from "sonner";
import { withClaudePrefix, isClaudeModel } from "@/utils/model-prefix";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** When set, edit this combo instead of creating a new one. */
  editing?: Combo;
}

export function ComboDialog({ open, onOpenChange, editing }: Props) {
  const addCombo = useComboStore((s) => s.add);
  const updateCombo = useComboStore((s) => s.update);
  const models = useModelStore((s) => s.models);
  const providers = useProviderStore((s) => s.providers);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [members, setMembers] = useState<ComboMember[]>([]);
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>("all");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);

  // Reset the form whenever the dialog opens (fresh for create, prefilled for edit).
  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setDescription(editing?.description ?? "");
    setMembers(editing?.members ? [...editing.members] : []);
    setSelectedProviderFilter("all");
    setSelectedModels([]);
  }, [open, editing]);

  // Combos accept OpenAI-format models only — exclude any model whose provider
  // speaks the Anthropic wire format (no translation happens at the gateway).
  const eligible = useMemo(() => {
    const byId = new Map(providers.map((p) => [p.id, p]));
    return models
      .filter((m) => {
        const p = byId.get(m.providerId);
        return p && (p.apiFormat ?? "openai") === "openai";
      })
      .map((m) => {
        const p = byId.get(m.providerId)!;
        return { model: m, providerName: p.displayName };
      });
  }, [models, providers]);

  const filteredEligible = useMemo(() => {
    return eligible.filter(({ model }) => {
      // 1. Filter by provider id if not "all"
      if (selectedProviderFilter !== "all" && model.providerId !== selectedProviderFilter) {
        return false;
      }
      // 2. Exclude models that are already in members
      const isAlreadyMember = members.some(
        (m) => m.providerId === model.providerId && m.modelId === model.modelId
      );
      return !isAlreadyMember;
    });
  }, [eligible, selectedProviderFilter, members]);

  const providerName = (providerId: string) =>
    providers.find((p) => p.id === providerId)?.displayName ?? "Unknown provider";

  const modelLabel = (m: ComboMember) => {
    const found = models.find(
      (x) => x.providerId === m.providerId && x.modelId === m.modelId
    );
    // Display with aip/ prefix for Claude models
    const displayId = isClaudeModel(m.modelId) ? withClaudePrefix(m.modelId) : m.modelId;
    return found?.displayName || displayId;
  };

  const addSelectedModels = () => {
    if (selectedModels.length === 0) return;

    const newMembers = [...members];
    let addedCount = 0;

    selectedModels.forEach((val) => {
      const [providerId, ...rest] = val.split("::");
      const modelId = rest.join("::");

      // Safety check to prevent duplicates
      if (
        !newMembers.some(
          (mm) => mm.providerId === providerId && mm.modelId === modelId
        )
      ) {
        newMembers.push({ providerId, modelId });
        addedCount++;
      }
    });

    setMembers(newMembers);
    setSelectedModels([]);
    if (addedCount > 0) {
      toast.success(`Added ${addedCount} model${addedCount > 1 ? "s" : ""} to the combo`);
    }
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= members.length) return;
    const next = [...members];
    [next[i], next[j]] = [next[j], next[i]];
    setMembers(next);
  };

  const removeMember = (i: number) => {
    setMembers(members.filter((_, idx) => idx !== i));
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Combo name is required.");
      return;
    }
    if (members.length === 0) {
      toast.error("Add at least one model to the combo.");
      return;
    }
    if (editing) {
      updateCombo(editing.id, {
        name: trimmed,
        description: description.trim() || undefined,
        members,
      });
      toast.success(`Updated combo "${trimmed}"`);
    } else {
      addCombo({
        name: trimmed,
        description: description.trim() || undefined,
        members,
      });
      toast.success(`Created combo "${trimmed}"`);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="w-5 h-5 text-primary" />
            {editing ? "Edit combo" : "New combo"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 max-h-[65vh] overflow-y-auto scrollbar-thin pr-1">
          <div className="space-y-1.5">
            <Label>Combo name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="smart-router"
            />
            <p className="text-[11px] text-muted-foreground">
              This is the model name you'll call via the gateway (
              <code>"model": "{name.trim() || "smart-router"}"</code>).
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Fast model first, big model as fallback."
              className="min-h-[60px]"
            />
          </div>

          <div className="space-y-2">
            <Label>Models — fallback priority</Label>
            <p className="text-[11px] text-muted-foreground -mt-1">
              Tried top to bottom. If #1 fails, the gateway falls through to #2,
              and so on. OpenAI-format models only.
            </p>

            {members.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 p-2.5 rounded-xl border border-primary/20 bg-primary/5 mb-2">
                <span className="text-[10px] font-semibold text-primary uppercase tracking-wider mr-1">Tags Flow:</span>
                {members.map((m, i) => (
                  <div key={`${m.providerId}::${m.modelId}`} className="flex items-center gap-1">
                    <Badge variant="default" className="text-xs px-2 py-0.5 font-normal flex items-center gap-1 bg-primary/20 text-foreground border border-primary/30">
                      <span className="font-bold text-[9px] bg-primary text-primary-foreground px-1 rounded">#{i + 1}</span>
                      <span className="font-medium">{modelLabel(m)}</span>
                      <span className="opacity-60 text-[10px]">({providerName(m.providerId)})</span>
                    </Badge>
                    {i < members.length - 1 && <span className="text-muted-foreground text-xs font-bold">➔</span>}
                  </div>
                ))}
              </div>
            )}

            {members.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                No models yet. Add one below.
              </div>
            ) : (
              <div className="space-y-1.5">
                {members.map((m, i) => (
                  <div
                    key={`${m.providerId}::${m.modelId}`}
                    className="flex items-center gap-2 rounded-xl border border-border/80 bg-card/60 p-2 shadow-xs hover:border-primary/40 transition"
                  >
                    <Badge variant="outline" className="bg-primary/10 text-primary font-bold border-primary/30 shrink-0">
                      Tag #{i + 1}
                    </Badge>
                    <div className="min-w-0 flex-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="font-medium text-xs truncate max-w-[200px] py-0.5">
                        {modelLabel(m)}
                        {models.find((x) => x.providerId === m.providerId && x.modelId === m.modelId)?.working && (
                          <CheckCircle2 className="w-3 h-3 text-emerald-500 ml-1 inline shrink-0" />
                        )}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] text-muted-foreground truncate py-0">
                        {providerName(m.providerId)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        className="p-1.5 rounded-lg hover:bg-secondary disabled:opacity-30 transition"
                        aria-label="Move up"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => move(i, 1)}
                        disabled={i === members.length - 1}
                        className="p-1.5 rounded-lg hover:bg-secondary disabled:opacity-30 transition"
                        aria-label="Move down"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => removeMember(i)}
                        className="p-1.5 rounded-lg hover:bg-destructive/15 hover:text-destructive transition"
                        aria-label="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-3 pt-3 border-t border-border">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                <Label className="text-xs">Add Models</Label>
                <div className="w-full sm:w-[200px]">
                  <Select
                    value={selectedProviderFilter}
                    onValueChange={(val) => {
                      setSelectedProviderFilter(val);
                      setSelectedModels([]);
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="All Providers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Providers</SelectItem>
                      {providers
                        .filter((p) => (p.apiFormat ?? "openai") === "openai")
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.displayName}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {selectedModels.length > 0 && (
                <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-secondary/40 border border-border">
                  <span className="text-[10px] text-muted-foreground font-medium w-full">Selected tags to add (click to remove):</span>
                  {selectedModels.map((val) => {
                    const [pId, ...rest] = val.split("::");
                    const mId = rest.join("::");
                    const found = models.find((x) => x.providerId === pId && x.modelId === mId);
                    const label = found?.displayName || mId;
                    return (
                      <Badge
                        key={val}
                        variant="default"
                        className="text-xs cursor-pointer hover:bg-destructive/80 transition flex items-center gap-1 py-0.5"
                        onClick={() => setSelectedModels(selectedModels.filter((x) => x !== val))}
                      >
                        <span>{label}</span>
                        <span className="text-[10px] opacity-70">✕</span>
                      </Badge>
                    );
                  })}
                </div>
              )}

              {filteredEligible.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  {selectedProviderFilter !== "all"
                    ? "No remaining OpenAI-format models for this provider."
                    : "No remaining OpenAI-format models available."}
                </div>
              ) : (
                <div className="border border-border rounded-xl max-h-[160px] overflow-y-auto p-1.5 space-y-0.5 scrollbar-thin bg-background/20">
                  {filteredEligible.map(({ model, providerName }) => {
                    const val = `${model.providerId}::${model.modelId}`;
                    const isChecked = selectedModels.includes(val);
                    return (
                      <div
                        key={val}
                        onClick={() => {
                          if (isChecked) {
                            setSelectedModels(selectedModels.filter((x) => x !== val));
                          } else {
                            setSelectedModels([...selectedModels, val]);
                          }
                        }}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-secondary/60 cursor-pointer transition select-none text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}} // handled by parent onClick
                          className="rounded border-input text-primary focus:ring-ring h-4 w-4 accent-primary cursor-pointer shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate text-foreground flex items-center gap-1.5">
                            {model.displayName}
                            {model.working && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            {isClaudeModel(model.modelId) ? withClaudePrefix(model.modelId) : model.modelId} · {providerName}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <Button
                className="w-full h-9"
                variant="outline"
                disabled={selectedModels.length === 0}
                onClick={addSelectedModels}
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Add Selected ({selectedModels.length})
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save}>
            {editing ? "Save changes" : "Create combo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
