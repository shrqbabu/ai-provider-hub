import { useState } from "react";
import { Plus, Plug2, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useProviderStore } from "@/store/provider-store";
import { useModelStore } from "@/store/model-store";
import { ProviderCard } from "@/features/providers/ProviderCard";
import { AddProviderDialog } from "@/features/providers/AddProviderDialog";
import { AntigravityOAuthDialog } from "@/features/providers/AntigravityOAuthDialog";
import { toast } from "sonner";
import { fetchModelIds } from "@/services/provider-service";
import { inferCapabilities, inferTier } from "@/constants/providers";
import type { ConnectedProvider } from "@/types";
import { AddModelDialog } from "@/features/models/AddModelDialog";
import { AntigravityQuotaTracker } from "@/components/AntigravityQuotaTracker";

export function ProvidersPage() {
  const providers = useProviderStore((s) => s.providers);
  const removeProvider = useProviderStore((s) => s.remove);
  const toggleDisabledProvider = useProviderStore((s) => s.toggleDisabled);
  const markChecked = useProviderStore((s) => s.markChecked);
  const models = useModelStore((s) => s.models);
  const upsertModels = useModelStore((s) => s.upsertMany);
  const removeByProvider = useModelStore((s) => s.removeByProvider);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [antigravityDialogOpen, setAntigravityDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectedProvider | undefined>();
  const [modelDialogFor, setModelDialogFor] = useState<ConnectedProvider | undefined>();

  const refresh = async (p: ConnectedProvider) => {
    if (p.disabled) {
      toast.error("Cannot fetch models for a disconnected provider. Reconnect it first.");
      return;
    }
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

  const handleDisconnect = (p: ConnectedProvider) => {
    const willDisable = !p.disabled;
    if (willDisable) {
      if (!confirm(`Disconnect ${p.displayName || p.name}? Its models will be disabled and will not be fetched or tested.`)) return;
      toggleDisabledProvider(p.id);
      // Mark all models of this provider as disabled and not working
      models
        .filter((m) => m.providerId === p.id)
        .forEach((m) => useModelStore.getState().update(m.id, { disabled: true, working: false }));
      toast.success(`${p.displayName || p.name} disconnected.`);
    } else {
      toggleDisabledProvider(p.id);
      // Re-enable models
      models
        .filter((m) => m.providerId === p.id)
        .forEach((m) => useModelStore.getState().update(m.id, { disabled: false }));
      toast.success(`${p.displayName || p.name} reconnected.`);
    }
  };

  const handleDelete = (p: ConnectedProvider) => {
    if (!confirm(`Permanently delete ${p.displayName}? All models will be removed.`)) return;
    removeByProvider(p.id);
    removeProvider(p.id);
    toast.success("Provider removed.");
  };

  const connectCliBridge = () => {
    const existingCli = providers.find((p) => p.key === "cli");
    if (existingCli) {
      toast.info("Host CLI Bridge is already connected!");
      return;
    }
    const created = useProviderStore.getState().add({
      key: "cli",
      name: "Host CLI Runner (Bridge)",
      displayName: "Host CLI Bridge (agy)",
      authMode: "apiKey",
      apiKey: "agy",
      apiKeys: ["agy"],
      baseURL: "/api/cli",
      apiFormat: "openai",
      streaming: true,
      vision: true,
      fileUpload: true,
    });

    const defaultModels = [
      { id: "gemini-3.7-flash", displayName: "Gemini 3.7 Flash", tier: "free" as const },
      { id: "gemini-3.6-flash", displayName: "Gemini 3.6 Flash", tier: "free" as const },
      { id: "gemini-3.5-flash", displayName: "Gemini 3.5 Flash", tier: "free" as const },
      { id: "gemini-3.1-pro", displayName: "Gemini 3.1 Pro", tier: "free" as const },
      { id: "claude-sonnet-4-6-thinking", displayName: "Claude Sonnet 4.6 (Thinking)", tier: "free" as const },
      { id: "claude-opus-4-6-thinking", displayName: "Claude Opus 4.6 (Thinking)", tier: "free" as const },
      { id: "gpt-oss-120b", displayName: "GPT-OSS 120B (Medium)", tier: "free" as const },
    ];

    useModelStore.getState().upsertMany(
      defaultModels.map((m) => ({
        providerId: created.id,
        providerKey: "cli" as const,
        modelId: m.id,
        displayName: m.displayName,
        contextWindow: 1_047_576,
        vision: true,
        tier: m.tier,
        createdAt: Date.now(),
      }))
    );

    toast.success("Host CLI Bridge connected with native VPS models!");
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
              Connect the AI providers you use. Add multiple keys per provider
              for automatic fallback.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <AntigravityQuotaTracker />
            <Button
              variant="outline"
              onClick={connectCliBridge}
              className="gap-1.5 border-emerald-500/30 hover:border-emerald-500/60 hover:bg-emerald-500/10 text-emerald-400"
            >
              <Plug2 className="w-4 h-4 text-emerald-400" />
              Connect Host CLI (agy)
            </Button>
            <Button
              variant="outline"
              onClick={() => setAntigravityDialogOpen(true)}
              className="gap-1.5 border-blue-500/30 hover:border-blue-500/60 hover:bg-blue-500/10 text-blue-400"
            >
              <Sparkles className="w-4 h-4 text-blue-400" />
              Connect Antigravity (OAuth)
            </Button>
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
        </div>

        {providers.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-3xl border border-dashed border-border p-12 text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary mx-auto flex items-center justify-center">
              <Plug2 className="w-8 h-8" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">No providers yet</h3>
            <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
              Connect your host CLI binary (`agy`), Antigravity Google OAuth, or add any custom AI provider.
            </p>
            <div className="mt-6 flex items-center justify-center gap-3 flex-wrap">
              <Button
                variant="outline"
                onClick={connectCliBridge}
                className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
              >
                <Plug2 className="w-4 h-4" />
                Connect Host CLI (agy)
              </Button>
              <Button
                variant="outline"
                onClick={() => setAntigravityDialogOpen(true)}
                className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
              >
                <Sparkles className="w-4 h-4" />
                Connect Antigravity
              </Button>
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="w-4 h-4" />
                Add provider
              </Button>
            </div>
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
                  onDisconnect={() => handleDisconnect(p)}
                  onDelete={() => handleDelete(p)}
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
        <AntigravityOAuthDialog
          open={antigravityDialogOpen}
          onOpenChange={setAntigravityDialogOpen}
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
