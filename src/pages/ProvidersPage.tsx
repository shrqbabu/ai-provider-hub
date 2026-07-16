import { useState } from "react";
import { Plus, Plug2 } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useProviderStore } from "@/store/provider-store";
import { useModelStore } from "@/store/model-store";
import { ProviderCard } from "@/features/providers/ProviderCard";
import { AddProviderDialog } from "@/features/providers/AddProviderDialog";
import { toast } from "sonner";
import { fetchModelIds } from "@/services/provider-service";
import { inferCapabilities, inferTier } from "@/constants/providers";
import type { ConnectedProvider } from "@/types";
import { AddModelDialog } from "@/features/models/AddModelDialog";

export function ProvidersPage() {
  const providers = useProviderStore((s) => s.providers);
  const removeProvider = useProviderStore((s) => s.remove);
  const markChecked = useProviderStore((s) => s.markChecked);
  const models = useModelStore((s) => s.models);
  const upsertModels = useModelStore((s) => s.upsertMany);
  const removeByProvider = useModelStore((s) => s.removeByProvider);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectedProvider | undefined>();
  const [modelDialogFor, setModelDialogFor] = useState<ConnectedProvider | undefined>();

  const refresh = async (p: ConnectedProvider) => {
    toast.loading("Fetching models...", { id: p.id });
    try {
      const list = await fetchModelIds(p);
      const built = list.map((m) => {
        const caps = inferCapabilities(m.id);
        const inputPrice = m.inputPrice ?? caps.inputPrice;
        const outputPrice = m.outputPrice ?? caps.outputPrice;
        const contextWindow = m.contextLength ?? caps.context;
        const tier = inferTier({
          providerKey: p.key,
          modelId: m.id,
          baseURL: p.baseURL,
          inputPrice,
          outputPrice,
        });
        return {
          providerId: p.id,
          providerKey: p.key,
          modelId: m.id,
          displayName: m.id,
          contextWindow,
          vision: m.supportsVision ?? caps.vision,
          pdf: caps.pdf,
          streaming: caps.streaming,
          toolCalling: caps.toolCalling,
          reasoning: caps.reasoning,
          inputPrice,
          outputPrice,
          tier,
          createdAt: m.created ? m.created * 1000 : Date.now(),
        };
      });
      upsertModels(built);
      markChecked(p.id);
      toast.success(`Refreshed — ${built.length} models`, { id: p.id });
    } catch (err) {
      toast.error(
        `Refresh failed: ${err instanceof Error ? err.message : "unknown"}`,
        { id: p.id }
      );
    }
  };

  const remove = (p: ConnectedProvider) => {
    if (!confirm(`Disconnect ${p.displayName}? Models will be removed.`)) return;
    removeByProvider(p.id);
    removeProvider(p.id);
    toast.success("Provider removed.");
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
              <Plug2 className="w-5 h-5 md:w-6 md:h-6 text-primary" />
              Providers
            </h1>
            <p className="text-sm text-muted-foreground">
              Connect the AI providers you use. Keys stay on this device.
            </p>
          </div>
          <Button
            onClick={() => {
              setEditing(undefined);
              setDialogOpen(true);
            }}
          >
            <Plus className="w-4 h-4" />
            Add provider
          </Button>
        </div>

        {providers.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-3xl border border-dashed border-border p-12 text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary mx-auto flex items-center justify-center">
              <Plug2 className="w-7 h-7" />
            </div>
            <h3 className="mt-4 font-semibold text-lg">No providers connected</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              Add your first provider to start discovering models and chatting.
            </p>
            <Button
              className="mt-5"
              onClick={() => {
                setEditing(undefined);
                setDialogOpen(true);
              }}
            >
              <Plus className="w-4 h-4" /> Connect a provider
            </Button>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {providers.map((p) => (
              <div key={p.id}>
                <ProviderCard
                  provider={p}
                  modelCount={models.filter((m) => m.providerId === p.id).length}
                  onRefresh={() => refresh(p)}
                  onEdit={() => {
                    setEditing(p);
                    setDialogOpen(true);
                  }}
                  onDisconnect={() => remove(p)}
                  onDelete={() => remove(p)}
                />
                {models.filter((m) => m.providerId === p.id).length === 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 w-full"
                    onClick={() => setModelDialogFor(p)}
                  >
                    <Plus className="w-3 h-3" /> Add model manually
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        <AddProviderDialog
          open={dialogOpen}
          onOpenChange={(v) => {
            setDialogOpen(v);
            if (!v) setEditing(undefined);
          }}
          existing={editing}
        />
        {modelDialogFor && (
          <AddModelDialog
            open={!!modelDialogFor}
            onOpenChange={(v) => !v && setModelDialogFor(undefined)}
            provider={modelDialogFor}
          />
        )}
      </div>
    </div>
  );
}
