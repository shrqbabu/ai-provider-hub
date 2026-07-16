import { motion } from "framer-motion";
import {
  Trash2,
  RefreshCw,
  Pencil,
  Plug,
  PlugZap,
  Clock,
  Layers,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProviderLogo } from "@/components/ProviderLogo";
import type { ConnectedProvider } from "@/types";
import { PROVIDERS } from "@/constants/providers";
import { timeAgo, truncate } from "@/utils";

interface Props {
  provider: ConnectedProvider;
  modelCount: number;
  onRefresh: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDisconnect: () => void;
}

export function ProviderCard({
  provider,
  modelCount,
  onRefresh,
  onEdit,
  onDelete,
  onDisconnect,
}: Props) {
  const def = PROVIDERS[provider.key];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.25 }}
    >
      <Card className="overflow-hidden relative group">
        <div
          className={`absolute inset-0 opacity-[0.06] bg-gradient-to-br ${def.gradient} pointer-events-none`}
        />
        <CardContent className="p-5 pt-5 relative">
          <div className="flex items-start gap-4">
            <ProviderLogo
              provider={provider.key}
              customUrl={provider.customLogo}
              className="w-12 h-12"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold truncate">
                  {provider.displayName || def.name}
                </h3>
                <Badge variant="success">
                  <PlugZap className="w-3 h-3" />
                  Connected
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {truncate(def.description, 80)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="rounded-xl bg-secondary/50 p-3">
              <div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1">
                <Layers className="w-3 h-3" /> Models
              </div>
              <div className="text-lg font-semibold mt-0.5">{modelCount}</div>
            </div>
            <div className="rounded-xl bg-secondary/50 p-3">
              <div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" /> Connected
              </div>
              <div className="text-sm font-medium mt-0.5">
                {timeAgo(provider.lastCheckedAt ?? provider.connectedAt)}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-4">
            <Button size="sm" variant="outline" onClick={onRefresh}>
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </Button>
            <Button size="sm" variant="outline" onClick={onDisconnect}>
              <Plug className="w-3.5 h-3.5" />
              Disconnect
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-destructive hover:bg-destructive/10"
              onClick={onDelete}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
