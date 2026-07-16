import { motion } from "framer-motion";
import { Star, Trash2, Save, Eye, FileText, Zap, Brain, Wrench } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProviderLogo } from "@/components/ProviderLogo";
import { TierBadge } from "@/components/TierBadge";
import type { DiscoveredModel, ProviderKey } from "@/types";
import { formatNumber } from "@/utils";
import { cn } from "@/utils";

interface Props {
  model: DiscoveredModel;
  providerName: string;
  providerKey: ProviderKey;
  onToggleFavorite: () => void;
  onToggleSaved: () => void;
  onDelete?: () => void;
  onClick?: () => void;
}

export function ModelCard({
  model,
  providerName,
  providerKey,
  onToggleFavorite,
  onToggleSaved,
  onDelete,
  onClick,
}: Props) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      onClick={onClick}
      className={onClick ? "cursor-pointer" : ""}
    >
      <Card className="h-full">
        <CardContent className="p-4 pt-4 flex flex-col gap-3 h-full">
          <div className="flex items-start gap-3">
            <ProviderLogo provider={providerKey} className="w-9 h-9" />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                {providerName}
                <TierBadge tier={model.tier} size="xs" />
              </div>
              <div className="font-semibold text-sm truncate">
                {model.displayName}
              </div>
              <div className="text-[11px] text-muted-foreground truncate font-mono">
                {model.modelId}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
              className="p-1 rounded-lg hover:bg-secondary transition"
            >
              <Star
                className={cn(
                  "w-4 h-4",
                  model.favorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground"
                )}
              />
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {model.contextWindow && (
              <Badge variant="outline">
                {formatNumber(model.contextWindow)} ctx
              </Badge>
            )}
            {model.vision && (
              <Badge variant="secondary">
                <Eye className="w-3 h-3" /> Vision
              </Badge>
            )}
            {model.pdf && (
              <Badge variant="secondary">
                <FileText className="w-3 h-3" /> PDF
              </Badge>
            )}
            {model.streaming && (
              <Badge variant="secondary">
                <Zap className="w-3 h-3" /> Stream
              </Badge>
            )}
            {model.toolCalling && (
              <Badge variant="secondary">
                <Wrench className="w-3 h-3" /> Tools
              </Badge>
            )}
            {model.reasoning && (
              <Badge variant="default">
                <Brain className="w-3 h-3" /> Reasoning
              </Badge>
            )}
          </div>

          {(model.inputPrice || model.outputPrice) && (
            <div className="text-[11px] text-muted-foreground flex gap-3">
              {model.inputPrice != null && (
                <span>In ${model.inputPrice}/1M</span>
              )}
              {model.outputPrice != null && (
                <span>Out ${model.outputPrice}/1M</span>
              )}
            </div>
          )}

          <div className="flex gap-2 mt-auto pt-2">
            <Button
              size="sm"
              variant={model.saved ? "default" : "outline"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleSaved();
              }}
              className="flex-1"
            >
              <Save className="w-3.5 h-3.5" />
              {model.saved ? "Saved" : "Save"}
            </Button>
            {onDelete && (
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
