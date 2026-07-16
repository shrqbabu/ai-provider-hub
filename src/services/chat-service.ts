import type { ChatMessage, ConnectedProvider, DiscoveredModel } from "@/types";
import { createClient, extractErrorMessage } from "./provider-service";
import { dataUrlToText, isTextLike } from "@/utils";

export interface StreamHandlers {
  onDelta: (delta: string) => void;
  onImage?: (url: string) => void;
  onDone: (usage: {
    tokensIn: number;
    tokensOut: number;
    durationMs: number;
  }) => void;
  onError: (err: Error) => void;
  signal?: AbortSignal;
}

interface OpenAIMessageContent {
  role: "user" | "assistant" | "system";
  content: string | Array<Record<string, unknown>>;
}

function buildMessages(
  messages: ChatMessage[],
  model: DiscoveredModel,
  systemPrompt?: string
): OpenAIMessageContent[] {
  const out: OpenAIMessageContent[] = [];
  if (systemPrompt) out.push({ role: "system", content: systemPrompt });
  for (const m of messages) {
    if (m.role === "system") {
      out.push({ role: "system", content: m.content });
      continue;
    }
    const hasAttachments = m.attachments && m.attachments.length > 0;
    if (!hasAttachments || m.role === "assistant") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    const parts: Array<Record<string, unknown>> = [];
    if (m.content) parts.push({ type: "text", text: m.content });
    for (const att of m.attachments!) {
      if (att.type.startsWith("image/") && model.vision) {
        parts.push({
          type: "image_url",
          image_url: { url: att.dataUrl },
        });
      } else if (att.type === "application/pdf" && model.pdf) {
        // OpenAI-style file content part (works on OpenAI, OpenRouter, and
        // other compatible endpoints that accept document inputs).
        parts.push({
          type: "file",
          file: {
            filename: att.name,
            file_data: att.dataUrl,
          },
        });
      } else if (isTextLike(att.name, att.type)) {
        // Text/code files: decode and inline as plain text — works with
        // every provider regardless of vision/file support.
        const body = dataUrlToText(att.dataUrl);
        parts.push({
          type: "text",
          text: `<file name="${att.name}">\n${body}\n</file>`,
        });
      } else {
        parts.push({
          type: "text",
          text: `[Attached file: ${att.name} (${att.type})]`,
        });
      }
    }
    out.push({ role: m.role, content: parts });
  }
  return out;
}

export async function streamChat(
  provider: ConnectedProvider,
  model: DiscoveredModel,
  messages: ChatMessage[],
  handlers: StreamHandlers,
  systemPrompt?: string
): Promise<void> {
  const start = performance.now();
  try {
    const client = createClient(provider);
    const built = buildMessages(messages, model, systemPrompt);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = await client.chat.completions.create(
      {
        model: model.modelId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: built as any,
        stream: true,
        stream_options: { include_usage: true },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      { signal: handlers.signal }
    );

    let tokensIn = 0;
    let tokensOut = 0;
    const seenImages = new Set<string>();
    const emitImage = (url: string) => {
      if (!url || seenImages.has(url)) return;
      seenImages.add(url);
      handlers.onImage?.(url);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const chunk of stream as any) {
      const choice = chunk?.choices?.[0];
      const delta = choice?.delta;

      // Standard text delta.
      const text =
        typeof delta?.content === "string"
          ? delta.content
          : Array.isArray(delta?.content)
          ? delta.content
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .map((p: any) =>
                p?.type === "text" || typeof p?.text === "string"
                  ? p.text ?? ""
                  : ""
              )
              .join("")
          : "";
      if (text) handlers.onDelta(text);

      // Images can appear in several shapes across providers:
      //   delta.images: [{ image_url: { url } }]         (OpenRouter image models)
      //   delta.content parts of type "image_url"        (multimodal streams)
      //   message.images (non-streaming fallback)        (Gemini via OpenRouter)
      //   message.content parts with type "output_image"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const imageArr: any[] = [
        ...(Array.isArray(delta?.images) ? delta.images : []),
        ...(Array.isArray(choice?.message?.images) ? choice.message.images : []),
      ];
      for (const img of imageArr) {
        const url =
          img?.image_url?.url ?? img?.url ?? (typeof img === "string" ? img : "");
        if (url) emitImage(url);
      }
      if (Array.isArray(delta?.content)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const p of delta.content as any[]) {
          const url =
            p?.image_url?.url ??
            (p?.type === "output_image" ? p?.image ?? p?.data : undefined);
          if (url) emitImage(url);
        }
      }

      if (chunk?.usage) {
        tokensIn = chunk.usage.prompt_tokens ?? tokensIn;
        tokensOut = chunk.usage.completion_tokens ?? tokensOut;
      }
    }
    handlers.onDone({
      tokensIn,
      tokensOut,
      durationMs: Math.round(performance.now() - start),
    });
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === "AbortError") {
      handlers.onDone({
        tokensIn: 0,
        tokensOut: 0,
        durationMs: Math.round(performance.now() - start),
      });
      return;
    }
    handlers.onError(new Error(extractErrorMessage(err)));
  }
}
