import { motion } from "framer-motion";
import { Star, Trash2, Save, Eye, FileText, Zap, Brain, Wrench, CheckCircle2, XCircle, TestTube2, Loader2, Plug, PlugZap } from "lucide-react";
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
  onToggleDisabled?: () => void;
  onDelete?: () => void;
  onClick?: () => void;
  onTest?: () => void;
  isTesting?: boolean;
  passedTest?: boolean;
}

export function ModelCard({
  model,
  providerName,
  providerKey,
  onToggleFavorite,
  onToggleSaved,
  onToggleDisabled,
  onDelete,
  onClick,
  onTest,
  isTesting,
  passedTest = model.working,
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
            {model.disabled && (
              <Badge variant="destructive" className="bg-amber-500/10 text-amber-500 border-amber-500/20 shrink-0 gap-1 text-[11px]">
                <Plug className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Disconnected</span>
                <span className="sm:hidden">Off</span>
              </Badge>
            )}
            {!model.disabled && passedTest === true && (
              <Badge variant="default" className="bg-emerald-500 hover:bg-emerald-600 text-white shrink-0 gap-1 text-[11px]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Working</span>
              </Badge>
            )}
            {!model.disabled && passedTest === false && (
              <Badge variant="destructive" className="bg-rose-500 hover:bg-rose-600 text-white shrink-0 gap-1 text-[11px]">
                <XCircle className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Failed</span>
              </Badge>
            )}
            {onTest && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTest();
                }}
                disabled={isTesting}
                className="p-1.5 rounded-lg hover:bg-primary/20 hover:text-primary transition shrink-0"
                title="Test this model"
              >
                {isTesting ? (
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                ) : (
                  <TestTube2 className="w-4 h-4 text-emerald-500" />
                )}
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
              className="p-1.5 rounded-lg hover:bg-secondary transition shrink-0"
              title="Favorite"
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
            {onToggleDisabled && (
              <Button
                size="sm"
                variant={model.disabled ? "default" : "outline"}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleDisabled();
                }}
                className={cn(
                  "px-2 sm:px-3 text-xs gap-1.5",
                  model.disabled ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""
                )}
                title={model.disabled ? "Connect model" : "Disconnect model"}
              >
                {model.disabled ? (
                  <>
                    <PlugZap className="w-3.5 h-3.5" />
                    <span>Connect</span>
                  </>
                ) : (
                  <>
                    <Plug className="w-3.5 h-3.5" />
                    <span className="hidden xs:inline">Disconnect</span>
                    <span className="xs:hidden">Off</span>
                  </>
                )}
              </Button>
            )}
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
