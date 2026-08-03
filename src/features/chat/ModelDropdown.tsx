import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search, Star, Eye, Brain, Boxes } from "lucide-react";
import { useModelStore } from "@/store/model-store";
import { useProviderStore } from "@/store/provider-store";
import { useComboStore } from "@/store/combo-store";
import { ProviderLogo } from "@/components/ProviderLogo";
import { formatNumber, cn } from "@/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TierBadge } from "@/components/TierBadge";
import type { ConnectedProvider } from "@/types";

interface Props {
  modelId?: string;
  onChange: (modelPk: string) => void;
}

// A provider is usable only if it has credentials for its auth mode:
// cookie mode → a cookie string; apiKey mode → at least one non-empty key
// (either the primary `apiKey` or one of the fallback `apiKeys`).
function hasCredentials(p: ConnectedProvider): boolean {
  if (p.authMode === "cookie") return !!p.cookie?.trim();
  if (p.apiKey?.trim()) return true;
  return (p.apiKeys ?? []).some((k) => k.trim());
}

export function ModelDropdown({ modelId, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const models = useModelStore((s) => s.models);
  const providers = useProviderStore((s) => s.providers);
  const combos = useComboStore((s) => s.combos);

  const providerMap = useMemo(
    () => Object.fromEntries(providers.map((p) => [p.id, p])),
    [providers]
  );

  const activeCombo = useMemo(
    () => combos.find((c) => c.id === modelId),
    [combos, modelId]
  );

  const favorites = useMemo(() => {
    return models.filter((m) => {
      const provider = providerMap[m.providerId];
      if (!provider || !hasCredentials(provider)) return false;
      if (!m.favorite) return false;
      if (!q) return true;
      const s = q.toLowerCase();
      return (
        m.modelId.toLowerCase().includes(s) ||
        m.displayName.toLowerCase().includes(s) ||
        provider.displayName.toLowerCase().includes(s)
      );
    });
  }, [models, providerMap, q]);

  const activeComboMembersMap = useMemo(() => {
    if (!activeCombo) return new Map();
    const map = new Map();
    for (const member of activeCombo.members) {
      const found = models.find(
        (m) => m.providerId === member.providerId && m.modelId === member.modelId
      );
      if (found) {
        map.set(`${member.providerId}::${member.modelId}`, found);
      }
    }
    return map;
  }, [activeCombo, models]);

  const grouped = useMemo(() => {
    const filtered = models.filter((m) => {
      const provider = providerMap[m.providerId];
      // Only show models whose provider still exists AND has usable credentials.
      // Otherwise the model can be selected but the chat request fails with a
      // 404/401 because the provider was never configured properly.
      if (!provider || !hasCredentials(provider)) return false;
      if (m.favorite) return false; // Show in favorites only
      if (!q) return true;
      const s = q.toLowerCase();
      return (
        m.modelId.toLowerCase().includes(s) ||
        m.displayName.toLowerCase().includes(s) ||
        provider.displayName.toLowerCase().includes(s)
      );
    });
    const groups: Record<string, typeof filtered> = {};
    for (const m of filtered) {
      const key = m.providerId;
      (groups[key] ||= []).push(m);
    }
    return groups;
  }, [models, providerMap, q]);

  const filteredCombos = useMemo(() => {
    if (!q) return combos;
    const s = q.toLowerCase();
    return combos.filter(
      (c) =>
        c.name.toLowerCase().includes(s) ||
        (c.description ?? "").toLowerCase().includes(s)
    );
  }, [combos, q]);

  const active = models.find((m) => m.id === modelId);
  const activeProvider = active ? providerMap[active.providerId] : undefined;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="w-full md:w-auto flex items-center gap-2 rounded-xl px-3 py-2 bg-secondary/70 hover:bg-secondary transition text-sm border border-border/60 min-w-0">
          {activeCombo ? (
            <>
              <Boxes className="w-5 h-5 shrink-0 text-primary" />
              <div className="flex flex-col items-start leading-tight min-w-0 flex-1">
                <span className="font-medium truncate max-w-full">
                  {activeCombo.name}
                </span>
                <span className="text-[10px] text-muted-foreground truncate max-w-full">
                  Combo ({activeCombo.members.length} members)
                </span>
              </div>
            </>
          ) : active && activeProvider ? (
            <>
              <ProviderLogo
                provider={activeProvider.key}
                customUrl={activeProvider.customLogo}
                className="w-5 h-5 shrink-0"
              />
              <div className="flex flex-col items-start leading-tight min-w-0 flex-1">
                <span className="font-medium truncate max-w-full">
                  {active.displayName}
                </span>
                <span className="text-[10px] text-muted-foreground truncate max-w-full">
                  {activeProvider.displayName}
                </span>
              </div>
            </>
          ) : (
            <span className="text-muted-foreground flex-1 text-left">
              Select a model
            </span>
          )}
          <ChevronDown className="w-4 h-4 opacity-60 ml-1 shrink-0" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="w-[calc(100vw-24px)] md:w-[380px] max-h-[70vh] md:max-h-[500px] rounded-2xl border border-border bg-popover shadow-2xl z-50 overflow-hidden flex flex-col"
        >
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                autoFocus
                placeholder="Search models or combos..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
          </div>
          <div className="overflow-y-auto scrollbar-thin flex-1">
            {Object.keys(grouped).length === 0 && filteredCombos.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No models or combos found.
              </div>
            )}

            {/* Combos list */}
            {filteredCombos.length > 0 && (
              <div className="border-b border-border/40 pb-2 mb-2">
                <div className="px-3 pt-3 pb-1 flex items-center gap-2">
                  <Boxes className="w-4 h-4 text-primary" />
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Combos (Auto Fallback)
                  </span>
                </div>
                {filteredCombos.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      onChange(c.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 hover:bg-accent transition text-left",
                      c.id === modelId && "bg-accent"
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">
                          {c.name}
                        </span>
                        <Badge variant="outline" className="text-[9px] py-0">
                          {c.members.length} model{c.members.length === 1 ? "" : "s"}
                        </Badge>
                      </div>
                      {c.description && (
                        <div className="text-[10px] text-muted-foreground truncate">
                          {c.description}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        {c.members.slice(0, 3).map((m, i) => {
                          const found = models.find(
                            (x) => x.providerId === m.providerId && x.modelId === m.modelId
                          );
                          const label = found?.displayName || m.modelId;
                          return (
                            <Badge
                              key={i}
                              variant="secondary"
                              className="text-[9px] py-0 px-1 font-normal opacity-85"
                            >
                              #{i + 1} {label}
                            </Badge>
                          );
                        })}
                        {c.members.length > 3 && (
                          <span className="text-[9px] text-muted-foreground font-semibold">
                            +{c.members.length - 3} more
                          </span>
                        )}
                      </div>
                    </div>
                    {c.id === modelId && <Check className="w-4 h-4 text-primary" />}
                  </button>
                ))}
              </div>
            )}

            {/* Favorites List */}
            {favorites.length > 0 && (
              <div className="border-b border-border/40 pb-2 mb-2">
                <div className="px-3 pt-2 pb-1 flex items-center gap-2">
                  <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Favorites
                  </span>
                </div>
                {favorites.map((m) => {
                  const p = providerMap[m.providerId];
                  return (
                    <button
                      key={m.id}
                      onClick={() => {
                        onChange(m.id);
                        setOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 hover:bg-accent transition text-left",
                        m.id === modelId && "bg-accent"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">
                            {m.displayName}
                          </span>
                          <span className="text-[10px] text-muted-foreground truncate">
                            ({p?.displayName})
                          </span>
                          <TierBadge tier={m.tier} size="xs" />
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {m.contextWindow && (
                            <Badge variant="outline" className="text-[9px] py-0">
                              {formatNumber(m.contextWindow)}
                            </Badge>
                          )}
                          {m.vision && (
                            <Badge variant="secondary" className="text-[9px] py-0">
                              <Eye className="w-2.5 h-2.5" /> V
                            </Badge>
                          )}
                          {m.reasoning && (
                            <Badge variant="default" className="text-[9px] py-0">
                              <Brain className="w-2.5 h-2.5" /> R
                            </Badge>
                          )}
                        </div>
                      </div>
                      {m.id === modelId && <Check className="w-4 h-4 text-primary" />}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Normal provider-grouped models */}
            {Object.entries(grouped).map(([pid, list]) => {
              const p = providerMap[pid];
              return (
                <div key={pid}>
                  <div className="px-3 pt-3 pb-1 flex items-center gap-2">
                    <ProviderLogo provider={p.key} customUrl={p.customLogo} className="w-4 h-4" />
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                      {p.displayName}
                    </span>
                  </div>
                  {list.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        onChange(m.id);
                        setOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 hover:bg-accent transition text-left",
                        m.id === modelId && "bg-accent"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">
                            {m.displayName}
                          </span>
                          <TierBadge tier={m.tier} size="xs" />
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {m.contextWindow && (
                            <Badge variant="outline" className="text-[9px] py-0">
                              {formatNumber(m.contextWindow)}
                            </Badge>
                          )}
                          {m.vision && (
                            <Badge variant="secondary" className="text-[9px] py-0">
                              <Eye className="w-2.5 h-2.5" /> V
                            </Badge>
                          )}
                          {m.reasoning && (
                            <Badge variant="default" className="text-[9px] py-0">
                              <Brain className="w-2.5 h-2.5" /> R
                            </Badge>
                          )}
                        </div>
                      </div>
                      {m.id === modelId && <Check className="w-4 h-4 text-primary" />}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
