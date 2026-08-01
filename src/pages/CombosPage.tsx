import { useState } from "react";
import { Boxes, Plus, Pencil, Trash2, ArrowRight, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useComboStore } from "@/store/combo-store";
import { useProviderStore } from "@/store/provider-store";
import { useModelStore } from "@/store/model-store";
import { ComboDialog } from "@/features/combos/ComboDialog";
import type { Combo } from "@/types";
import { toast } from "sonner";

export function CombosPage() {
  const combos = useComboStore((s) => s.combos);
  const remove = useComboStore((s) => s.remove);
  const providers = useProviderStore((s) => s.providers);
  const models = useModelStore((s) => s.models);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Combo | undefined>();

  const openCreate = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };
  const openEdit = (c: Combo) => {
    setEditing(c);
    setDialogOpen(true);
  };

  const providerName = (providerId: string) =>
    providers.find((p) => p.id === providerId)?.displayName ?? "Unknown";

  const modelLabel = (providerId: string, modelId: string) => {
    const found = models.find(
      (m) => m.providerId === providerId && m.modelId === modelId
    );
    return found?.displayName || modelId;
  };

  const handleDelete = (c: Combo) => {
    remove(c.id);
    toast.success(`Deleted combo "${c.name}"`);
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-5xl mx-auto p-4 md:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
              <Boxes className="w-5 h-5 md:w-6 md:h-6 text-primary" /> Combos
            </h1>
            <p className="text-sm text-muted-foreground">
              Group models into one name with your own fallback order. Call the
              combo name via the gateway and it auto-picks the first model that
              works.
            </p>
          </div>
          <Button onClick={openCreate} className="shrink-0">
            <Plus className="w-4 h-4" /> New combo
          </Button>
        </div>

        {combos.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center">
            <Boxes className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
            <div className="text-sm font-medium">No combos yet</div>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              Create a combo to bundle several OpenAI-format models under one
              name with a fallback priority you control.
            </p>
            <Button onClick={openCreate} className="mt-4">
              <Plus className="w-4 h-4" /> Create your first combo
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {combos.map((c) => (
              <div
                key={c.id}
                className="rounded-2xl border border-border bg-card/40 backdrop-blur-xl p-4"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-semibold truncate">
                        {c.name}
                      </code>
                      <Badge variant="default" className="shrink-0">
                        {c.members.length} model
                        {c.members.length === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    {c.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {c.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(c.name);
                        toast.success(`Copied "${c.name}" to clipboard`);
                      }}
                      className="p-1.5 rounded-lg hover:bg-secondary transition"
                      aria-label="Copy combo name"
                      title="Copy name"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => openEdit(c)}
                      className="p-1.5 rounded-lg hover:bg-secondary transition"
                      aria-label="Edit combo"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(c)}
                      className="p-1.5 rounded-lg hover:bg-destructive/15 hover:text-destructive transition"
                      aria-label="Delete combo"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {c.members.map((m, i) => (
                    <div
                      key={`${m.providerId}::${m.modelId}`}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span className="w-5 text-[11px] text-muted-foreground shrink-0">
                        {i + 1}.
                      </span>
                      <span className="truncate">
                        {modelLabel(m.providerId, m.modelId)}
                      </span>
                      <span className="text-[11px] text-muted-foreground truncate">
                        · {providerName(m.providerId)}
                      </span>
                      {i < c.members.length - 1 && (
                        <ArrowRight className="w-3 h-3 text-muted-foreground/50 ml-auto shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <ComboDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          editing={editing}
        />
      </div>
    </div>
  );
}
