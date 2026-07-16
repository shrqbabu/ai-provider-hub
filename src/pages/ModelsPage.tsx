import { useMemo, useState } from "react";
import { Search, Star, Layers, Plus } from "lucide-react";
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
  const providers = useProviderStore((s) => s.providers);
  const toggleFav = useModelStore((s) => s.toggleFavorite);
  const toggleSaved = useModelStore((s) => s.toggleSaved);
  const remove = useModelStore((s) => s.remove);
  const create = useChatStore((s) => s.create);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [sort, setSort] = useState<"name" | "context" | "date">("name");
  const [showFavOnly, setShowFavOnly] = useState(false);
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const [tierFilter, setTierFilter] = useState<"all" | "free" | "paid">("all");
  const [addFor, setAddFor] = useState<string | undefined>();

  const providerMap = useMemo(
    () => Object.fromEntries(providers.map((p) => [p.id, p])),
    [providers]
  );

  const filtered = useMemo(() => {
    let list = models.filter((m) => providerMap[m.providerId]);
    if (providerFilter !== "all") list = list.filter((m) => m.providerId === providerFilter);
    if (showFavOnly) list = list.filter((m) => m.favorite);
    if (showSavedOnly) list = list.filter((m) => m.saved);
    if (tierFilter !== "all") list = list.filter((m) => m.tier === tierFilter);
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
  }, [models, providerMap, providerFilter, showFavOnly, showSavedOnly, tierFilter, q, sort]);

  const startChat = (modelId: string) => {
    const model = models.find((m) => m.id === modelId);
    if (!model) return;
    const c = create({ modelId: model.id, providerId: model.providerId });
    navigate(`/chat/${c.id}`);
  };

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
          {providers.length > 0 && (
            <Button variant="outline" onClick={() => setAddFor(providers[0].id)}>
              <Plus className="w-4 h-4" /> Add manually
            </Button>
          )}
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
                  {p.displayName}
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
                  onToggleFavorite={() => toggleFav(m.id)}
                  onToggleSaved={() => toggleSaved(m.id)}
                  onDelete={m.manual ? () => remove(m.id) : undefined}
                  onClick={() => startChat(m.id)}
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
