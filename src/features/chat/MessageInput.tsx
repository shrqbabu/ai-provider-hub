import { useCallback, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { AnimatePresence, motion } from "framer-motion";
import {
  Send,
  Paperclip,
  StopCircle,
  X,
  Image as ImageIcon,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatAttachment, DiscoveredModel } from "@/types";
import { fileToDataUrl, formatBytes, isTextLike } from "@/utils";
import { toast } from "sonner";
import { v4 as uuid } from "uuid";
import { cn } from "@/utils";

interface Props {
  onSend: (text: string, attachments: ChatAttachment[]) => void;
  onStop?: () => void;
  streaming?: boolean;
  disabled?: boolean;
  model?: DiscoveredModel;
}

export function MessageInput({ onSend, onStop, streaming, disabled, model }: Props) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const supportsImages = model?.vision ?? false;
  const supportsPdf = model?.pdf ?? false;

  const handleFiles = useCallback(
    async (files: File[]) => {
      const next: ChatAttachment[] = [];
      for (const f of files) {
        const isImage = f.type.startsWith("image/");
        const isPdf = f.type === "application/pdf";
        const isText = isTextLike(f.name, f.type);
        if (isImage && !supportsImages) {
          toast.error(`${model?.displayName ?? "This model"} does not support images.`);
          continue;
        }
        if (isPdf && !supportsPdf) {
          toast.error(`${model?.displayName ?? "This model"} does not support PDFs.`);
          continue;
        }
        // Text/code files work with every model — content is inlined as text.
        if (!isImage && !isPdf && !isText) {
          toast.error(`Unsupported file type: ${f.type || f.name}`);
          continue;
        }
        const maxSize = isText ? 2 * 1024 * 1024 : 20 * 1024 * 1024;
        if (f.size > maxSize) {
          toast.error(`${f.name} exceeds ${isText ? "2" : "20"} MB.`);
          continue;
        }
        const dataUrl = await fileToDataUrl(f);
        next.push({
          id: uuid(),
          name: f.name,
          type: isText && !f.type ? "text/plain" : f.type,
          size: f.size,
          dataUrl,
        });
      }
      setAttachments((a) => [...a, ...next]);
    },
    [supportsImages, supportsPdf, model?.displayName]
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: handleFiles,
    noClick: true,
    // No `accept` filter — validation happens in handleFiles so text/code
    // files (any extension) can pass through; browsers misreport their MIME.
  });

  const send = () => {
    if (streaming) return;
    const value = text.trim();
    if (!value && attachments.length === 0) return;
    onSend(value, attachments);
    setText("");
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div
      {...getRootProps()}
      className={cn(
        "relative rounded-2xl border transition-all",
        isDragActive
          ? "border-primary bg-primary/5 ring-2 ring-primary/30"
          : "border-border bg-card/70 backdrop-blur-xl",
        "shadow-lg"
      )}
    >
      <input {...getInputProps()} />

      <AnimatePresence>
        {attachments.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-wrap gap-2 p-3 border-b border-border/60"
          >
            {attachments.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 rounded-lg bg-secondary/70 pl-2 pr-1 py-1 text-xs"
              >
                {a.type.startsWith("image/") ? (
                  <img src={a.dataUrl} className="w-6 h-6 rounded object-cover" />
                ) : (
                  <FileText className="w-4 h-4" />
                )}
                <span className="max-w-[160px] truncate">{a.name}</span>
                <span className="text-muted-foreground">{formatBytes(a.size)}</span>
                <button
                  onClick={() =>
                    setAttachments((list) => list.filter((x) => x.id !== a.id))
                  }
                  className="p-0.5 rounded hover:bg-background"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = Math.min(e.target.scrollHeight, 240) + "px";
        }}
        onKeyDown={onKeyDown}
        placeholder="Ask anything..."
        disabled={disabled}
        rows={1}
        className="w-full bg-transparent px-4 pt-4 pb-2 resize-none outline-none text-sm placeholder:text-muted-foreground"
      />

      <div className="flex items-center gap-1 px-3 pb-3">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={open}
          disabled={disabled}
          type="button"
        >
          <Paperclip className="w-4 h-4" />
        </Button>
        {supportsImages && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={open}
            type="button"
          >
            <ImageIcon className="w-3.5 h-3.5" />
            Image
          </Button>
        )}
        {supportsPdf && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={open}
            type="button"
          >
            <FileText className="w-3.5 h-3.5" />
            PDF
          </Button>
        )}
        <div className="flex-1" />
        {streaming ? (
          <Button size="sm" variant="destructive" onClick={onStop} type="button">
            <StopCircle className="w-4 h-4" />
            Stop
          </Button>
        ) : (
          <Button size="sm" onClick={send} disabled={disabled} type="button">
            <Send className="w-4 h-4" />
            Send
          </Button>
        )}
      </div>

      {isDragActive && (
        <div className="absolute inset-0 rounded-2xl bg-primary/5 border-2 border-dashed border-primary flex items-center justify-center pointer-events-none">
          <div className="text-primary font-medium">Drop files to attach</div>
        </div>
      )}
    </div>
  );
}
