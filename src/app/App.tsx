import { useEffect, useState, lazy, Suspense } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/layouts/AppShell";
import { AuthPage } from "@/pages/AuthPage";
import { Sparkles, Loader2 } from "lucide-react";

// Helper that catches chunk load errors (e.g. after fresh deploy) and reloads once automatically
function lazyRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err: any) {
      const isChunkError =
        err?.message?.includes("Failed to fetch dynamically imported module") ||
        err?.message?.includes("dynamically imported module") ||
        err?.name === "ChunkLoadError";

      if (isChunkError && !sessionStorage.getItem("chunk_retry_reload")) {
        sessionStorage.setItem("chunk_retry_reload", "1");
        window.location.reload();
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    }
  });
}

// Lazy-loaded route pages for minimal initial bundle size & fast loading
const ProvidersPage = lazyRetry(() => import("@/pages/ProvidersPage").then((m) => ({ default: m.ProvidersPage })));
const ModelsPage = lazyRetry(() => import("@/pages/ModelsPage").then((m) => ({ default: m.ModelsPage })));
const CombosPage = lazyRetry(() => import("@/pages/CombosPage").then((m) => ({ default: m.CombosPage })));
const ChatPage = lazyRetry(() => import("@/pages/ChatPage").then((m) => ({ default: m.ChatPage })));
const PromptsPage = lazyRetry(() => import("@/pages/PromptsPage").then((m) => ({ default: m.PromptsPage })));
const UsagePage = lazyRetry(() => import("@/pages/UsagePage").then((m) => ({ default: m.UsagePage })));
const SettingsPage = lazyRetry(() => import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const TrashPage = lazyRetry(() => import("@/pages/TrashPage").then((m) => ({ default: m.TrashPage })));
const OAuthCallbackPage = lazyRetry(() => import("@/pages/OAuthCallbackPage").then((m) => ({ default: m.OAuthCallbackPage })));
const ApiKeysPage = lazyRetry(() => import("@/pages/ApiKeysPage").then((m) => ({ default: m.ApiKeysPage })));
const KeyStorePage = lazyRetry(() => import("@/pages/KeyStorePage").then((m) => ({ default: m.KeyStorePage })));
const ComboLogsPage = lazyRetry(() => import("@/pages/ComboLogsPage").then((m) => ({ default: m.ComboLogsPage })));
const CookieManagerPage = lazyRetry(() => import("@/pages/CookieManagerPage").then((m) => ({ default: m.CookieManagerPage })));
const ProfilePage = lazyRetry(() => import("@/pages/ProfilePage").then((m) => ({ default: m.ProfilePage })));
import { useAuthStore } from "@/store/auth-store";
import { useProviderStore } from "@/store/provider-store";
import { useModelStore } from "@/store/model-store";
import { useComboStore } from "@/store/combo-store";
import { inferTier } from "@/constants/providers";
import { useChatStore } from "@/store/chat-store";
import { usePromptStore } from "@/store/prompt-store";
import { useUsageStore } from "@/store/usage-store";
import { useSettingsStore } from "@/store/settings-store";
import { useKeyStoreStore } from "@/store/keystore-store";
import { useComboLogStore } from "@/store/combo-log-store";
import { Sparkles, Loader2 } from "lucide-react";

export default function App() {
  const [ready, setReady] = useState(false);
  const authLoading = useAuthStore((s) => s.loading);
  const authConfigured = useAuthStore((s) => s.configured);
  const user = useAuthStore((s) => s.user);
  const init = useAuthStore((s) => s.init);
  const hydrateProviders = useProviderStore((s) => s.hydrate);
  const hydrateModels = useModelStore((s) => s.hydrate);
  const hydrateCombos = useComboStore((s) => s.hydrate);
  const hydrateChats = useChatStore((s) => s.hydrate);
  const hydratePrompts = usePromptStore((s) => s.hydrate);
  const hydrateUsage = useUsageStore((s) => s.hydrate);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const hydrateKeyStore = useKeyStoreStore((s) => s.hydrate);
  const hydrateComboLogs = useComboLogStore((s) => s.hydrate);

  // Initialize Firebase auth listener once on mount.
  useEffect(() => {
    init();
  }, [init]);

  // Once auth resolves (user signed in), hydrate stores from the backend.
  useEffect(() => {
    if (authLoading) return;
    // Clear in-memory state before hydrating for the current user
    useProviderStore.setState({ providers: [], activeId: null });
    useModelStore.setState({ models: [], selectedModelId: null });
    useComboStore.setState({ combos: [] });
    useChatStore.setState({ chats: [], activeId: null });
    usePromptStore.setState({ prompts: [] });
    useUsageStore.setState({ records: [] });
    useKeyStoreStore.setState({ items: [] });
    useComboLogStore.setState({ logs: [] });

    if (authConfigured && !user) {
      setReady(true);
      return;
    }
    Promise.all([
      hydrateProviders(),
      hydrateModels(),
      hydrateCombos(),
      hydrateChats(),
      hydratePrompts(),
      hydrateUsage(),
      hydrateSettings(),
      hydrateKeyStore(),
      hydrateComboLogs(),
    ]).then(() => {
      // Re-run tier inference and purge legacy discount/deprecated models on load
      const modelState = useModelStore.getState();
      const providerState = useProviderStore.getState();
      const providerMap = new Map(
        providerState.providers.map((p) => [p.id, p])
      );

      const validModels = modelState.models.filter((m) => {
        const id = (m.modelId || "").toLowerCase();
        if (
          id.includes(":discount") ||
          id.includes("-discount") ||
          id.includes(":deprecated")
        ) {
          return false;
        }
        return true;
      });

      const patched = validModels.map((m) => ({
        ...m,
        tier: inferTier({
          providerKey: m.providerKey,
          modelId: m.modelId,
          baseURL: providerMap.get(m.providerId)?.baseURL,
          inputPrice: m.inputPrice,
          outputPrice: m.outputPrice,
        }),
      }));

      if (validModels.length !== modelState.models.length) {
        useModelStore.setState({ models: patched });
        storage.set("models", patched).catch(() => {});
      } else if (patched.length > 0) {
        modelState.upsertMany(patched);
      }
      setReady(true);
    });
  }, [
    authLoading,
    authConfigured,
    user,
    hydrateProviders,
    hydrateModels,
    hydrateCombos,
    hydrateChats,
    hydratePrompts,
    hydrateUsage,
    hydrateSettings,
    hydrateKeyStore,
    hydrateComboLogs,
  ]);

  // Firebase env not set → tell the developer how to configure it.
  if (!authConfigured) {
    return (
      <div className="h-full w-full aurora flex items-center justify-center p-4">
        <div className="max-w-md rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-6 text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-primary-foreground" />
          </div>
          <div className="text-lg font-semibold">Firebase not configured</div>
          <div className="text-sm text-muted-foreground">
            Set <code>VITE_FIREBASE_*</code> in your <code>.env</code> file, then
            restart the dev server. See <code>.env.example</code> for the required
            keys.
          </div>
        </div>
      </div>
    );
  }

  // Loading spinner while auth initializes.
  if (authLoading || !ready) {
    return (
      <div className="h-full w-full aurora flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center animate-pulse">
            <Sparkles className="w-6 h-6 text-primary-foreground" />
          </div>
          <div className="text-sm text-muted-foreground">
            {authLoading ? "Checking auth…" : "Loading…"}
          </div>
        </div>
      </div>
    );
  }

  // Not signed in → show auth page.
  if (!user) {
    return (
      <TooltipProvider>
        <AuthPage />
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<RedirectToChat />} />
            <Route path="/chat" element={<RedirectToChat />} />
            <Route path="/providers" element={<ProvidersPage />} />
            <Route path="/cookies" element={<CookieManagerPage />} />
            <Route path="/api-keys" element={<ApiKeysPage />} />
            <Route path="/keystore" element={<KeyStorePage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/combos" element={<CombosPage />} />
            <Route path="/combo-logs" element={<ComboLogsPage />} />
            <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
            <Route path="/chat/:id" element={<ChatPage />} />
            <Route path="/prompts" element={<PromptsPage />} />
            <Route path="/usage" element={<UsagePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/trash" element={<TrashPage />} />
            <Route path="*" element={<RedirectToChat />} />
          </Route>
        </Routes>
      </Suspense>
    </TooltipProvider>
  );
}

function PageFallback() {
  return (
    <div className="h-full w-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-2">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <span className="text-xs text-muted-foreground">Loading view…</span>
      </div>
    </div>
  );
}

function RedirectToChat() {
  const chats = useChatStore((s) => s.chats).filter((c) => !c.deleted);
  const create = useChatStore((s) => s.create);
  const navigate = useNavigate();

  useEffect(() => {
    if (chats.length > 0) {
      const latest = chats.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
      navigate(`/chat/${latest.id}`, { replace: true });
    } else {
      const newChat = create();
      navigate(`/chat/${newChat.id}`, { replace: true });
    }
  }, [chats, create, navigate]);

  return (
    <div className="h-full w-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <div className="text-sm text-muted-foreground">Redirecting to chat…</div>
      </div>
    </div>
  );
}
