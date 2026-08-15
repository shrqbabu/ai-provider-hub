import { useMemo, useState } from "react";
import { Search, Star, Layers, Plus, TestTube2, Loader2, CheckCircle2, RotateCcw, Plug } from "lucide-react";
import { toast } from "sonner";
import { testSingleModel } from "@/services/provider-service";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ModelCard } from "@/features/models/ModelCard";
import { useModelStore } from "@/store/model-store";
import { useProviderStore } from "@/store/provider-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNavigate } from "react-router-dom";
import { useChatStore } from "@/store/chat-store";
import { AddModelDialog } from "@/features/models/AddModelDialog";

export function ModelsPage() {
  const models = useModelStore((s) => s.models);
  const updateModel = useModelStore((s) => s.update);
  const providers = useProviderStore((s) => s.providers);
  const toggleFav = useModelStore((s) => s.toggleFavorite);
  const toggleSaved = useModelStore((s) => s.toggleSaved);
  const toggleDisabledModel = useModelStore((s) => s.toggleDisabled);
  const remove = useModelStore((s) => s.remove);
  const create = useChatStore((s) => s.create);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [sort, setSort] = useState<"name" | "context" | "date">("name");
  const [showFavOnly, setShowFavOnly] = useState(false);
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const [showDisconnected, setShowDisconnected] = useState(false);
  const [tierFilter, setTierFilter] = useState<"all" | "free" | "paid">("all");
  const [addFor, setAddFor] = useState<string | undefined>();
  const [testResults, setTestResults] = useState<Record<string, boolean>>({});
  const [isTesting, setIsTesting] = useState(false);
  const [testingSingleId, setTestingSingleId] = useState<string | null>(null);
  const [showOnlyWorking, setShowOnlyWorking] = useState(false);
  const [testedCount, setTestedCount] = useState(0);

  const providerMap = useMemo(
    () => Object.fromEntries(providers.map((p) => [p.id, p])),
    [providers]
  );

  const filtered = useMemo(() => {
    let list = models.filter((m) => {
      const p = providerMap[m.providerId];
      if (!p) return false;
      // If "all" is selected, hide models of disconnected providers
      if (providerFilter === "all" && p.disabled) return false;
      // If model itself or its provider is disconnected, only show when showDisconnected is true or user searches
      if (!showDisconnected && !q && (m.disabled || p.disabled)) return false;
      if (showDisconnected && !m.disabled && !p.disabled) return false;
      return true;
    });
    if (providerFilter !== "all") list = list.filter((m) => m.providerId === providerFilter);
    if (showFavOnly) list = list.filter((m) => m.favorite);
    if (showSavedOnly) list = list.filter((m) => m.saved);
    if (tierFilter !== "all") list = list.filter((m) => m.tier === tierFilter);
    if (showOnlyWorking) list = list.filter((m) => m.working === true);
    if (q) {
      const s = q.toLowerCase();
      list = list.filter(
        (m) =>
          m.modelId.toLowerCase().includes(s) ||
          m.displayName.toLowerCase().includes(s)
      );
    }
    list = list.slice().sort((a, b) => {
      if (sort === "name") return a.displayName.localeCompare(b.displayName);
      if (sort === "context") return (b.contextWindow ?? 0) - (a.contextWindow ?? 0);
      return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    });
    return list;
  }, [models, providerMap, providerFilter, showFavOnly, showSavedOnly, tierFilter, showOnlyWorking, showDisconnected, testResults, q, sort]);

  const disconnectedCount = useMemo(() => {
    return models.filter((m) => {
      const p = providerMap[m.providerId];
      return (m.disabled || p?.disabled) && (providerFilter === "all" || m.providerId === providerFilter);
    }).length;
  }, [models, providerMap, providerFilter]);

  const startChat = (modelId: string) => {
    const model = models.find((m) => m.id === modelId);
    if (!model) return;
    const c = create({ modelId: model.id, providerId: model.providerId });
    navigate(`/chat/${c.id}`);
  };

  const runModelTests = async () => {
    // Only test active (non-disabled) models from connected providers!
    const targetModels = filtered.filter((m) => {
      const p = providerMap[m.providerId];
      return !m.disabled && p && !p.disabled;
    });

    if (!targetModels.length) {
      if (providerFilter !== "all" && providerMap[providerFilter]?.disabled) {
        toast.error("Selected provider is disconnected. Reconnect it first to test its models.");
      } else {
        toast.error("No active models available to test in the current view.");
      }
      return;
    }

    setIsTesting(true);
    setTestedCount(0);
    const results: Record<string, boolean> = {};
    let passed = 0;
    let finished = 0;

    const targetProviderName =
      providerFilter !== "all" ? providerMap[providerFilter]?.displayName || "Selected Provider" : undefined;

    toast.info(
      targetProviderName
        ? `Testing ${targetModels.length} models for ${targetProviderName}...`
        : `Testing ${targetModels.length} models...`
    );

    const BATCH_SIZE = 4;
    for (let i = 0; i < targetModels.length; i += BATCH_SIZE) {
      const batch = targetModels.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (m) => {
          const provider = providerMap[m.providerId];
          const ok = provider ? await testSingleModel(provider, m.modelId) : false;
          results[m.id] = ok;
          updateModel(m.id, { working: ok, disabled: !ok });
          if (ok) passed++;
          finished++;
          setTestedCount(finished);
        })
      );
      setTestResults({ ...results });
    }

    setIsTesting(false);
    setShowOnlyWorking(true);
    toast.success(
      targetProviderName
        ? `${targetProviderName}: ${passed} of ${targetModels.length} models working!`
        : `Testing complete! ${passed} of ${targetModels.length} models working.`
    );
  };

  const testOneModel = async (m: (typeof models)[0]) => {
    const p = providerMap[m.providerId];
    if (!p) {
      toast.error("Provider configuration not found.");
      return;
    }
    if (p.disabled) {
      toast.error("Provider is disconnected. Reconnect it first.");
      return;
    }
    setTestingSingleId(m.id);
    const ok = await testSingleModel(p, m.modelId);
    updateModel(m.id, { working: ok, disabled: !ok });
    setTestingSingleId(null);
    if (ok) {
      toast.success(`Model "${m.displayName}" passed test (Working)`);
    } else {
      toast.error(`Model "${m.displayName}" test failed and was auto-disconnected.`);
    }
  };

  const testableCount = useMemo(
    () => filtered.filter((m) => providerMap[m.providerId] && !providerMap[m.providerId].disabled).length,
    [filtered, providerMap]
  );

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
              <Layers className="w-5 h-5 md:w-6 md:h-6 text-primary" /> My Models
            </h1>
            <p className="text-sm text-muted-foreground">
              All discovered and saved models across your providers.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={showOnlyWorking ? "default" : "outline"}
              onClick={runModelTests}
              disabled={isTesting}
              className={showOnlyWorking ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}
            >
              {isTesting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Testing... ({testedCount}/{testableCount})
                </>
              ) : (
                <>
                  <TestTube2 className="w-4 h-4 text-emerald-500" />
                  {providerFilter !== "all"
                    ? `Test ${providerMap[providerFilter]?.displayName || "Provider"} Models`
                    : "Test Models"}
                </>
              )}
            </Button>

            {showOnlyWorking && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowOnlyWorking(false)}
                title="Show all models"
              >
                <RotateCcw className="w-4 h-4" />
                Show all
              </Button>
            )}

            {providers.length > 0 && (
              <Button variant="outline" onClick={() => setAddFor(providers[0].id)}>
                <Plus className="w-4 h-4" /> Add manually
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-5">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search models..."
              className="pl-9"
            />
          </div>
          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All providers</SelectItem>
              {providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.displayName || p.name} {p.disabled ? "(Disconnected)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as "name" | "context" | "date")}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="context">Context</SelectItem>
              <SelectItem value="date">Newest</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={tierFilter === "free" ? "default" : "outline"}
            size="sm"
            onClick={() => setTierFilter(tierFilter === "free" ? "all" : "free")}
            className={
              tierFilter === "free"
                ? "bg-emerald-500 text-white border-emerald-500 hover:brightness-110"
                : ""
            }
          >
            Free
          </Button>
          <Button
            variant={tierFilter === "paid" ? "default" : "outline"}
            size="sm"
            onClick={() => setTierFilter(tierFilter === "paid" ? "all" : "paid")}
            className={
              tierFilter === "paid"
                ? "bg-amber-500 text-white border-amber-500 hover:brightness-110"
                : ""
            }
          >
            Paid
          </Button>
          <Button
            variant={showFavOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setShowFavOnly(!showFavOnly)}
          >
            <Star className="w-3.5 h-3.5" /> Favorites
          </Button>
          <Button
            variant={showSavedOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setShowSavedOnly(!showSavedOnly)}
          >
            Saved only
          </Button>
          {disconnectedCount > 0 && (
            <Button
              variant={showDisconnected ? "default" : "outline"}
              size="sm"
              onClick={() => setShowDisconnected(!showDisconnected)}
              className={
                showDisconnected
                  ? "bg-amber-500 hover:bg-amber-600 text-white border-amber-500"
                  : "text-amber-500 border-amber-500/30 hover:bg-amber-500/10"
              }
            >
              <Plug className="w-3.5 h-3.5 mr-1" />
              Disconnected ({disconnectedCount})
            </Button>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-16">
            No models match. Connect a provider or clear filters.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((m) => {
              const p = providerMap[m.providerId];
              return (
                <ModelCard
                  key={m.id}
                  model={m}
                  providerName={p.displayName}
                  providerKey={p.key}
                  passedTest={m.working}
                  onToggleFavorite={() => toggleFav(m.id)}
                  onToggleSaved={() => toggleSaved(m.id)}
                  onToggleDisabled={() => toggleDisabledModel(m.id)}
                  onDelete={m.manual ? () => remove(m.id) : undefined}
                  onClick={() => startChat(m.id)}
                  onTest={() => testOneModel(m)}
                  isTesting={testingSingleId === m.id}
                />
              );
            })}
          </div>
        )}

        {addFor && (
          <AddModelDialog
            open={!!addFor}
            onOpenChange={(v) => !v && setAddFor(undefined)}
            provider={providers.find((p) => p.id === addFor)!}
          />
        )}
      </div>
    </div>
  );
}
