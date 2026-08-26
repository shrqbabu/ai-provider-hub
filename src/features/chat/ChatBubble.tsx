import { Copy, RefreshCw, User, Bot, X, Sparkles, Download, ZoomIn } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import type { ChatMessage } from "@/types";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils";

interface Props {
  message: ChatMessage;
  streaming?: boolean;
  thinking?: boolean;
  onRetry?: () => void;
  onDelete?: () => void;
}

export function ChatBubble({ message, streaming, thinking, onRetry, onDelete }: Props) {
  const [copied, setCopied] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const isUser = message.role === "user";
  const copy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    toast.success("Copied");
    setTimeout(() => setCopied(false), 1500);
  };
  const downloadImage = async (url: string, i: number) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `generated-${Date.now()}-${i + 1}.png`;
      a.click();
      URL.revokeObjectURL(objUrl);
    } catch {
      toast.error("Failed to download image");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "flex gap-3 group",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      {isUser && (
        <div className="hidden md:flex w-8 h-8 rounded-full shrink-0 items-center justify-center bg-secondary text-muted-foreground">
          <User className="w-4 h-4" />
        </div>
      )}
      <div
        className={cn(
          "flex-1 min-w-0",
          isUser ? "items-end" : "items-start",
          "flex flex-col"
        )}
      >
        <div
          className={cn(
            "relative overflow-hidden",
            isUser
              ? "max-w-[90%] w-fit rounded-[18px] px-3.5 md:px-4 py-2.5 md:py-3 bg-[hsl(var(--user-bubble))] border-0"
              : "w-full rounded-none px-0 py-1 bg-transparent border-0"
          )}
        >
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {message.attachments.map((a) =>
                a.type.startsWith("image/") ? (
                  <img
                    key={a.id}
                    src={a.dataUrl}
                    alt={a.name}
                    className="max-h-40 rounded-lg border border-border"
                  />
                ) : (
                  <div
                    key={a.id}
                    className="text-xs px-2 py-1 rounded-md bg-secondary"
                  >
                    📄 {a.name}
                  </div>
                )
              )}
            </div>
          )}
          {message.error ? (
            <div className="text-sm text-destructive">{message.error}</div>
          ) : message.generating ? (
            <ImageGeneratingCard count={message.generatingCount ?? 1} />
          ) : thinking && !message.content && !message.images?.length ? (
            <ThinkingIndicator />
          ) : (
            <>
              {message.thinkingTimeMs != null && !isUser && (
                <div className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 text-xs mb-2.5">
                  <div className="flex items-center gap-1.5 text-emerald-500 font-medium">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Thinking almost done</span>
                  </div>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {(message.thinkingTimeMs / 1000).toFixed(1)}s
                  </span>
                </div>
              )}
              <MarkdownRenderer content={message.content || " "} streaming={streaming} />
              {!isUser && !streaming && !!message.content && !message.error && (
                <div className="mt-4 flex items-end justify-between">
                  <span className="text-primary text-lg leading-none select-none">✱</span>
                  <span className="text-[10px] text-muted-foreground">
                    Can make mistakes. Please double-check.
                  </span>
                </div>
              )}
              {message.images && message.images.length > 0 && (
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {message.images.map((url, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.35, delay: i * 0.05 }}
                      className="relative rounded-xl overflow-hidden border border-border group"
                    >
                      <img
                        src={url}
                        alt={`Generated image ${i + 1}`}
                        loading="lazy"
                        decoding="async"
                        onClick={() => setPreviewUrl(url)}
                        className="w-full max-h-[420px] object-contain bg-secondary/40 cursor-zoom-in"
                      />
                      <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
                        <button
                          onClick={() => setPreviewUrl(url)}
                          className="h-7 w-7 flex items-center justify-center rounded-md bg-black/60 hover:bg-black/80 text-white backdrop-blur-sm"
                          title="View"
                        >
                          <ZoomIn className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => downloadImage(url, i)}
                          className="h-7 w-7 flex items-center justify-center rounded-md bg-black/60 hover:bg-black/80 text-white backdrop-blur-sm"
                          title="Download"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div
          className={cn(
            "flex items-center gap-1 mt-1 flex-wrap opacity-100 md:opacity-0 md:group-hover:opacity-100 transition",
            isUser ? "flex-row-reverse" : "flex-row"
          )}
        >
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={copy}>
            <Copy className="w-3 h-3" />
            {copied ? "Copied" : "Copy"}
          </Button>
          {onRetry && !isUser && (
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onRetry}>
              <RefreshCw className="w-3 h-3" />
              Retry
            </Button>
          )}
          {onDelete && (
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onDelete}>
              <X className="w-3 h-3" />
            </Button>
          )}
          {message.tokensOut != null && message.tokensOut > 0 && (
            <span className="text-[10px] text-muted-foreground ml-2">
              {message.tokensIn ?? 0}→{message.tokensOut} tok
              {message.durationMs ? ` · ${(message.durationMs / 1000).toFixed(1)}s` : ""}
            </span>
          )}
        </div>
      </div>

      <ImageLightbox
        url={previewUrl}
        onClose={() => setPreviewUrl(null)}
        onDownload={(u) => downloadImage(u, 0)}
      />
    </motion.div>
  );
}

function ImageLightbox({
  url,
  onClose,
  onDownload,
}: {
  url: string | null;
  onClose: () => void;
  onDownload: (url: string) => void;
}) {
  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [url, onClose]);

  return createPortal(
    <AnimatePresence>
      {url && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-3"
        >
          <div className="absolute top-3 right-3 flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDownload(url);
              }}
              className="h-9 w-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white"
              title="Download"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="h-9 w-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <motion.img
            key={url}
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            src={url}
            alt="Preview"
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function ImageGeneratingCard({ count }: { count: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - start), 100);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
        <Sparkles className="w-3.5 h-3.5 animate-pulse" />
        <span>Creating image{count > 1 ? "s" : ""}</span>
        <div className="flex items-center gap-0.5 ml-1">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="w-1 h-1 rounded-full bg-primary"
              animate={{ y: [0, -2, 0], opacity: [0.3, 1, 0.3] }}
              transition={{
                duration: 0.8,
                repeat: Infinity,
                delay: i * 0.15,
                ease: "easeInOut",
              }}
            />
          ))}
        </div>
        <span className="font-mono text-[11px] text-muted-foreground ml-auto">
          {(elapsed / 1000).toFixed(1)}s
        </span>
      </div>
      <div className={cn("grid gap-2", count > 1 ? "grid-cols-2" : "grid-cols-1")}>
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="relative aspect-square w-full max-w-[320px] overflow-hidden rounded-xl border border-border bg-secondary/40"
          >
            {/* Shimmer sweep */}
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/15 to-transparent"
              animate={{ x: ["-100%", "100%"] }}
              transition={{
                duration: 1.4,
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.2,
              }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.div
                animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.8, 0.4] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              >
                <Sparkles className="w-7 h-7 text-primary/60" />
              </motion.div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsed(Date.now() - start);
    }, 100);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs w-full max-w-sm">
      <div className="flex items-center gap-1.5 font-medium text-foreground">
        <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
        <span>Thinking</span>
        <div className="flex items-center gap-0.5 ml-1">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="w-1 h-1 rounded-full bg-primary"
              animate={{ y: [0, -2, 0], opacity: [0.3, 1, 0.3] }}
              transition={{
                duration: 0.8,
                repeat: Infinity,
                delay: i * 0.15,
                ease: "easeInOut",
              }}
            />
          ))}
        </div>
      </div>
      <span className="font-mono text-[11px] text-muted-foreground font-semibold">
        {(elapsed / 1000).toFixed(1)}s
      </span>
    </div>
  );
}

