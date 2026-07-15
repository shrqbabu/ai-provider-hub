import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Circle,
  Zap,
  Pencil,
  Star,
  Pin,
  Trash2,
  Download,
  MoreVertical,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChatBubble } from "@/features/chat/ChatBubble";
import { MessageInput } from "@/features/chat/MessageInput";
import { ModelDropdown } from "@/features/chat/ModelDropdown";
import { useChatStore } from "@/store/chat-store";
import { useModelStore } from "@/store/model-store";
import { useProviderStore } from "@/store/provider-store";
import { useUsageStore } from "@/store/usage-store";
import { streamChat } from "@/services/chat-service";
import type { ChatAttachment, ChatMessage } from "@/types";
import { ProviderLogo } from "@/components/ProviderLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { estimateTokens, formatNumber, cn } from "@/utils";

export function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const chat = useChatStore((s) => (id ? s.byId(id) : undefined));
  const updateChat = useChatStore((s) => s.update);
  const softDelete = useChatStore((s) => s.softDelete);
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const removeMessage = useChatStore((s) => s.removeMessage);
  const models = useModelStore((s) => s.models);
  const providers = useProviderStore((s) => s.providers);
  const recordUsage = useUsageStore((s) => s.record);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [thinkingId, setThinkingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(chat?.title ?? "");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Smooth streaming buffer: incoming deltas are queued and flushed to the
  // message content on an animation frame at a controlled character rate.
  // Prevents "one giant dump" when the upstream sends chunks in bursts.
  const bufferRef = useRef<{ pending: string; msgId: string | null; done: boolean }>({
    pending: "",
    msgId: null,
    done: false,
  });
  const flushRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!chat && id) navigate("/");
  }, [chat, id, navigate]);

  useEffect(() => {
    setTitleDraft(chat?.title ?? "");
  }, [chat?.title]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat?.messages.length, streamingId]);

  const model = useMemo(
    () => models.find((m) => m.id === chat?.modelId),
    [models, chat?.modelId]
  );
  // Always route requests through the provider the current MODEL belongs to
  // — not the chat's stored providerId, which can go stale if the model was
  // reassigned. Prevents "sending OpenRouter model to NVIDIA endpoint" bugs.
  const provider = useMemo(
    () =>
      providers.find(
        (p) => p.id === (model?.providerId ?? chat?.providerId)
      ),
    [providers, chat?.providerId, model?.providerId]
  );

  const contextTokens = useMemo(() => {
    if (!chat) return 0;
    return chat.messages.reduce((a, m) => a + estimateTokens(m.content), 0);
  }, [chat]);

  const sessionTokens = useMemo(() => {
    if (!chat) return { input: 0, output: 0 };
    return chat.messages.reduce(
      (acc, m) => ({
        input: acc.input + (m.tokensIn ?? 0),
        output: acc.output + (m.tokensOut ?? 0),
      }),
      { input: 0, output: 0 }
    );
  }, [chat]);

  const remaining = model?.contextWindow ? model.contextWindow - contextTokens : undefined;
  const contextPct = model?.contextWindow
    ? Math.min(100, (contextTokens / model.contextWindow) * 100)
    : undefined;

  if (!chat) return null;

  const pickModel = (modelPk: string) => {
    const m = models.find((x) => x.id === modelPk);
    if (!m) return;
    updateChat(chat.id, { modelId: m.id, providerId: m.providerId });
  };

  const startBufferedFlush = (chatId: string, assistantId: string) => {
    bufferRef.current = { pending: "", msgId: assistantId, done: false };
    let shown = "";
    const CHARS_PER_FRAME = 3; // ~180 chars/sec at 60fps — smooth but not slow

    const tick = () => {
      const buf = bufferRef.current;
      if (buf.msgId !== assistantId) {
        flushRafRef.current = null;
        return;
      }
      if (buf.pending.length > 0) {
        // While buffer is huge (upstream dumped a lot), speed up so we don't
        // lag behind indefinitely.
        const step = buf.pending.length > 200 ? 12 : CHARS_PER_FRAME;
        const chunk = buf.pending.slice(0, step);
        buf.pending = buf.pending.slice(step);
        shown += chunk;
        updateMessage(chatId, assistantId, { content: shown });
      }
      if (buf.pending.length === 0 && buf.done) {
        flushRafRef.current = null;
        return;
      }
      flushRafRef.current = requestAnimationFrame(tick);
    };
    flushRafRef.current = requestAnimationFrame(tick);
    return () => shown;
  };

  const runStream = async (allMessages: ChatMessage[], assistantId: string) => {
    if (!model || !provider) return;
    abortRef.current = new AbortController();
    setStreamingId(assistantId);
    setThinkingId(assistantId);

    const getShown = startBufferedFlush(chat.id, assistantId);

    await streamChat(
      provider,
      model,
      allMessages,
      {
        onDelta: (d) => {
          // First delta arrives → hide "thinking".
          if (thinkingId) setThinkingId(null);
          bufferRef.current.pending += d;
        },
        onImage: (url) => {
          if (thinkingId) setThinkingId(null);
          const current = useChatStore.getState().byId(chat.id);
          const msg = current?.messages.find((m) => m.id === assistantId);
          const next = [...(msg?.images ?? []), url];
          updateMessage(chat.id, assistantId, { images: next });
        },
        onDone: ({ tokensIn, tokensOut, durationMs }) => {
          bufferRef.current.done = true;
          // Wait until buffered text has fully flushed before we record usage,
          // so the visible content matches what's stored.
          const finish = () => {
            updateMessage(chat.id, assistantId, {
              tokensIn,
              tokensOut,
              durationMs,
            });
            const cost =
              ((model.inputPrice ?? 0) * tokensIn +
                (model.outputPrice ?? 0) * tokensOut) /
              1_000_000;
            recordUsage({
              providerId: provider.id,
              providerKey: provider.key,
              modelId: model.modelId,
              tokensIn,
              tokensOut,
              cost,
              durationMs,
            });
            setStreamingId(null);
            setThinkingId(null);
            abortRef.current = null;
          };
          const wait = () => {
            if (bufferRef.current.pending.length === 0) return finish();
            setTimeout(wait, 40);
          };
          wait();
        },
        onError: (err) => {
          bufferRef.current.done = true;
          updateMessage(chat.id, assistantId, {
            content: getShown() + bufferRef.current.pending,
            error: err.message,
          });
          bufferRef.current.pending = "";
          setStreamingId(null);
          setThinkingId(null);
          abortRef.current = null;
          toast.error(err.message);
        },
        signal: abortRef.current.signal,
      },
      chat.systemPrompt
    );
  };

  const onSend = async (text: string, attachments: ChatAttachment[]) => {
    if (!model || !provider) {
      toast.error("Choose a model first.");
      return;
    }
    const user = addMessage(chat.id, {
      role: "user",
      content: text,
      attachments,
    });
    if (chat.messages.length === 0 && text) {
      updateChat(chat.id, { title: text.slice(0, 60) });
    }
    const assistant = addMessage(chat.id, {
      role: "assistant",
      content: "",
      model: model.modelId,
      providerId: provider.id,
    });
    await runStream([...chat.messages, user], assistant.id);
  };

  const onStop = () => {
    abortRef.current?.abort();
    // Flush anything already received so the user sees the partial response.
    bufferRef.current.done = true;
  };

  const onRetry = async (assistantId: string) => {
    const idx = chat.messages.findIndex((m) => m.id === assistantId);
    if (idx < 0) return;
    const history = chat.messages.slice(0, idx);
    updateMessage(chat.id, assistantId, { content: "", error: undefined });
    await runStream(history, assistantId);
  };

  const exportChat = () => {
    const blob = new Blob([JSON.stringify(chat, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${chat.title || "chat"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const noProvider = providers.length === 0;
  const noModel = !model;

  return (
    <div className="h-full flex flex-col">
      {/* Header — compact on mobile */}
      <div className="border-b border-border/60 bg-card/40 backdrop-blur-xl px-3 md:px-6 py-1.5 md:py-3 flex items-center gap-2 md:gap-3 shrink-0">
        {provider && (
          <ProviderLogo
            provider={provider.key}
            customUrl={provider.customLogo}
            className="hidden md:block w-8 h-8 shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <Input
              value={titleDraft}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                updateChat(chat.id, { title: titleDraft || "Untitled" });
                setEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  updateChat(chat.id, { title: titleDraft || "Untitled" });
                  setEditingTitle(false);
                }
              }}
              className="h-8"
            />
          ) : (
            <button
              onClick={() => setEditingTitle(true)}
              className="font-semibold text-sm truncate hover:text-primary transition text-left flex items-center gap-1.5 group w-full"
            >
              <span className="truncate">{chat.title}</span>
              <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 transition shrink-0" />
            </button>
          )}
          {/* Meta line — desktop only; mobile stays single-row */}
          <div className="hidden md:flex text-[10px] text-muted-foreground items-center gap-2 mt-0.5">
            {provider && <span>{provider.displayName}</span>}
            {model && <span>· {model.displayName}</span>}
            {model?.contextWindow && (
              <span>
                · {formatNumber(contextTokens)} / {formatNumber(model.contextWindow)} tok
              </span>
            )}
            {remaining != null && remaining < 1000 && (
              <span className="text-amber-500">· near limit</span>
            )}
          </div>
        </div>

        <div className="shrink min-w-0 max-w-[45%] md:max-w-none">
          <ModelDropdown modelId={chat.modelId} onChange={pickModel} />
        </div>

        <div className="hidden md:flex items-center gap-1 text-xs">
          <Circle
            className={cn(
              "w-2 h-2 fill-current",
              streamingId ? "text-amber-500 animate-pulse" : "text-emerald-500"
            )}
          />
          {streamingId ? "Streaming" : "Ready"}
        </div>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button size="icon" variant="ghost" className="h-8 w-8">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="rounded-xl border border-border bg-popover shadow-xl p-1 min-w-[180px] z-50"
            >
              <MenuItem
                icon={Star}
                label={chat.favorite ? "Unfavorite" : "Favorite"}
                onClick={() => updateChat(chat.id, { favorite: !chat.favorite })}
              />
              <MenuItem
                icon={Pin}
                label={chat.pinned ? "Unpin" : "Pin"}
                onClick={() => updateChat(chat.id, { pinned: !chat.pinned })}
              />
              <MenuItem icon={Download} label="Export JSON" onClick={exportChat} />
              <MenuItem
                icon={Trash2}
                label="Delete"
                danger
                onClick={() => {
                  softDelete(chat.id);
                  navigate("/");
                }}
              />
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-3xl mx-auto px-3 md:px-6 py-4 md:py-6 space-y-4 md:space-y-5">
          {chat.messages.length === 0 && (
            <div className="text-center py-16">
              <div className="w-14 h-14 rounded-2xl mx-auto bg-primary/10 text-primary flex items-center justify-center">
                <Zap className="w-6 h-6" />
              </div>
              <h2 className="mt-4 text-lg font-semibold">Start the conversation</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {noProvider
                  ? "Connect a provider first from the Providers page."
                  : noModel
                  ? "Select a model from the top-right dropdown."
                  : "Type below or drop files to begin."}
              </p>
            </div>
          )}
          {chat.messages.map((m) => (
            <ChatBubble
              key={m.id}
              message={m}
              streaming={m.id === streamingId && !!m.content}
              thinking={m.id === thinkingId}
              onRetry={m.role === "assistant" ? () => onRetry(m.id) : undefined}
              onDelete={() => removeMessage(chat.id, m.id)}
            />
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="p-2 md:p-4 border-t border-border/60 bg-card/30 backdrop-blur-xl shrink-0">
        <div className="max-w-3xl mx-auto">
          <MessageInput
            onSend={onSend}
            onStop={onStop}
            streaming={!!streamingId}
            disabled={noProvider || noModel}
            model={model}
          />

          {/* Token meter */}
          {model && (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {model.contextWindow ? (
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className="whitespace-nowrap">
                    Context{" "}
                    <span className="font-medium text-foreground">
                      {formatNumber(contextTokens)}
                    </span>
                    {" / "}
                    {formatNumber(model.contextWindow)}
                  </span>
                  <div className="flex-1 h-1 rounded-full bg-secondary overflow-hidden max-w-[160px]">
                    <div
                      className={cn(
                        "h-full transition-all",
                        contextPct! > 90
                          ? "bg-destructive"
                          : contextPct! > 70
                          ? "bg-amber-500"
                          : "bg-primary"
                      )}
                      style={{ width: `${contextPct}%` }}
                    />
                  </div>
                  {remaining != null && remaining < 2000 && (
                    <span className="text-amber-500 whitespace-nowrap">
                      {formatNumber(Math.max(0, remaining))} left
                    </span>
                  )}
                </div>
              ) : (
                <span>Context tracking unavailable for this model</span>
              )}
              <span className="whitespace-nowrap">
                Session{" "}
                <span className="font-medium text-foreground">
                  {formatNumber(sessionTokens.input + sessionTokens.output)}
                </span>{" "}
                tok
                <span className="opacity-60">
                  {" "}
                  ({formatNumber(sessionTokens.input)} in ·{" "}
                  {formatNumber(sessionTokens.output)} out)
                </span>
              </span>
            </div>
          )}

          <div className="hidden md:block mt-1.5 text-[10px] text-center text-muted-foreground">
            Streaming through {provider?.displayName ?? "provider"}. Keys stored locally.
          </div>
        </div>
      </div>
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <DropdownMenu.Item
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer outline-none focus:bg-accent",
        danger && "text-destructive"
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
    </DropdownMenu.Item>
  );
}
