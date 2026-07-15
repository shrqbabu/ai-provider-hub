import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/layouts/AppShell";
import { LandingPage } from "@/pages/LandingPage";
import { ProvidersPage } from "@/pages/ProvidersPage";
import { ModelsPage } from "@/pages/ModelsPage";
import { ChatPage } from "@/pages/ChatPage";
import { PromptsPage } from "@/pages/PromptsPage";
import { UsagePage } from "@/pages/UsagePage";
import { SettingsPage } from "@/pages/SettingsPage";
import { TrashPage } from "@/pages/TrashPage";
import { useProviderStore } from "@/store/provider-store";
import { useModelStore } from "@/store/model-store";
import { inferTier } from "@/constants/providers";
import { useChatStore } from "@/store/chat-store";
import { usePromptStore } from "@/store/prompt-store";
import { useUsageStore } from "@/store/usage-store";
import { useSettingsStore } from "@/store/settings-store";
import { Sparkles } from "lucide-react";

export default function App() {
  const [ready, setReady] = useState(false);
  const hydrateProviders = useProviderStore((s) => s.hydrate);
  const hydrateModels = useModelStore((s) => s.hydrate);
  const hydrateChats = useChatStore((s) => s.hydrate);
  const hydratePrompts = usePromptStore((s) => s.hydrate);
  const hydrateUsage = useUsageStore((s) => s.hydrate);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);

  useEffect(() => {
    Promise.all([
      hydrateProviders(),
      hydrateModels(),
      hydrateChats(),
      hydratePrompts(),
      hydrateUsage(),
      hydrateSettings(),
    ]).then(() => {
      // Re-run tier inference for ALL models on load. This fixes previously
      // cached models that were mislabeled (e.g. OpenRouter paid models that
      // showed up as "free" because we hadn't parsed pricing yet). Cheap —
      // just a map + local state update.
      const modelState = useModelStore.getState();
      const providerState = useProviderStore.getState();
      const providerMap = new Map(
        providerState.providers.map((p) => [p.id, p])
      );
      const patched = modelState.models.map((m) => ({
        ...m,
        tier: inferTier({
          providerKey: m.providerKey,
          modelId: m.modelId,
          baseURL: providerMap.get(m.providerId)?.baseURL,
          inputPrice: m.inputPrice,
          outputPrice: m.outputPrice,
        }),
      }));
      if (patched.length > 0) modelState.upsertMany(patched);
      setReady(true);
    });
  }, [
    hydrateProviders,
    hydrateModels,
    hydrateChats,
    hydratePrompts,
    hydrateUsage,
    hydrateSettings,
  ]);

  if (!ready) {
    return (
      <div className="h-full w-full aurora flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center animate-pulse">
            <Sparkles className="w-6 h-6 text-primary-foreground" />
          </div>
          <div className="text-sm text-muted-foreground">Loading local data…</div>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/providers" element={<ProvidersPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/chat/:id" element={<ChatPage />} />
          <Route path="/prompts" element={<PromptsPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/trash" element={<TrashPage />} />
          <Route path="*" element={<LandingPage />} />
        </Route>
      </Routes>
    </TooltipProvider>
  );
}
