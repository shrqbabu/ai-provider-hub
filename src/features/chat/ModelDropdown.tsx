import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search, Star, Eye, Brain } from "lucide-react";
import { useModelStore } from "@/store/model-store";
import { useProviderStore } from "@/store/provider-store";
import { ProviderLogo } from "@/components/ProviderLogo";
import { formatNumber, cn } from "@/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TierBadge } from "@/components/TierBadge";

interface Props {
  modelId?: string;
  onChange: (modelPk: string) => void;
}

export function ModelDropdown({ modelId, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const models = useModelStore((s) => s.models);
  const providers = useProviderStore((s) => s.providers);

  const providerMap = useMemo(
    () => Object.fromEntries(providers.map((p) => [p.id, p])),
    [providers]
  );

  const grouped = useMemo(() => {
    const filtered = models.filter((m) => {
      if (!providerMap[m.providerId]) return false;
      if (!q) return true;
      const s = q.toLowerCase();
      return (
        m.modelId.toLowerCase().includes(s) ||
        m.displayName.toLowerCase().includes(s) ||
        providerMap[m.providerId].displayName.toLowerCase().includes(s)
      );
    });
    const groups: Record<string, typeof filtered> = {};
    for (const m of filtered) {
      const key = m.providerId;
      (groups[key] ||= []).push(m);
    }
    return groups;
  }, [models, providerMap, q]);

  const active = models.find((m) => m.id === modelId);
  const activeProvider = active ? providerMap[active.providerId] : undefined;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="w-full md:w-auto flex items-center gap-2 rounded-xl px-3 py-2 bg-secondary/70 hover:bg-secondary transition text-sm border border-border/60 min-w-0">
          {active && activeProvider ? (
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
                placeholder="Search models..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
          </div>
          <div className="overflow-y-auto scrollbar-thin flex-1">
            {Object.keys(grouped).length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No models found. Connect a provider first.
              </div>
            )}
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
                          {m.favorite && (
                            <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />
                          )}
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
