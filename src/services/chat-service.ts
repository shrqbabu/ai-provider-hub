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

// Auto-continue when the provider cuts the answer at its output-token limit
// (finish_reason === "length"). Cap rounds so a runaway model can't loop.
const MAX_CONTINUATIONS = 4;
const CONTINUE_PROMPT =
  "Continue your previous response EXACTLY from where it stopped. " +
  "Do not repeat anything, do not re-open code fences that are already open, " +
  "do not add any preamble — output the very next character onward.";

// Ask for a generous output budget. Many OpenAI-compatible servers default
// max_tokens to something small (512–4096) when omitted — that's the usual
// reason long files get cut off mid-way.
function resolveMaxTokens(model: DiscoveredModel): number {
  const id = model.modelId.toLowerCase();
  // Reasoning models burn output budget on thinking — give them extra room.
  if (model.reasoning || /o[13]|deepseek-r1|qwq|thinking/.test(id)) {
    return 32_768;
  }
  return 16_384;
}

// Some servers (older vLLM, LM Studio, certain gateways) reject
// `max_completion_tokens`; others (newer OpenAI models) reject `max_tokens`.
// Try max_tokens first, fall back to max_completion_tokens, then bare.
async function createCompletionStream(
  client: ReturnType<typeof createClient>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: Record<string, any>,
  maxTokens: number,
  signal?: AbortSignal
) {
  const attempts = [
    { ...body, max_tokens: maxTokens },
    { ...body, max_completion_tokens: maxTokens },
    body,
  ];
  let lastErr: unknown;
  for (const attempt of attempts) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await client.chat.completions.create(attempt as any, { signal });
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyErr = err as any;
      const status = anyErr?.status ?? anyErr?.response?.status;
      const msg = String(anyErr?.message ?? "");
      // Only fall through on parameter-rejection errors; real failures
      // (auth, rate limit, network) must surface immediately.
      const paramRejected =
        status === 400 &&
        /max_tokens|max_completion_tokens|unsupported|unexpected|invalid[_ ]?param/i.test(
          msg
        );
      if (!paramRejected) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
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
    const baseMessages = buildMessages(messages, model, systemPrompt);

    let accumulated = ""; // full assistant text across continuations
    let tokensIn = 0;
    let tokensOut = 0;
    let continuations = 0;

    const seenImages = new Set<string>();
    const emitImage = (url: string) => {
      if (!url || seenImages.has(url)) return;
      seenImages.add(url);
      handlers.onImage?.(url);
    };

    while (true) {
      // On continuation rounds, replay the partial answer and ask the model
      // to pick up where it stopped. (A trailing assistant message alone is
      // rejected as "prefill" by some providers — the user turn avoids that.)
      const requestMessages =
        continuations === 0
          ? baseMessages
          : [
              ...baseMessages,
              { role: "assistant" as const, content: accumulated },
              { role: "user" as const, content: CONTINUE_PROMPT },
            ];

      const stream = await createCompletionStream(
        client,
        {
          model: model.modelId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          messages: requestMessages as any,
          stream: true,
          stream_options: { include_usage: true },
        },
        resolveMaxTokens(model),
        handlers.signal
      );

      let finishReason: string | null = null;
      let reqIn = 0;
      let reqOut = 0;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const chunk of stream as any) {
        const choice = chunk?.choices?.[0];
        const delta = choice?.delta;
        if (choice?.finish_reason) finishReason = choice.finish_reason;

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
        if (text) {
          accumulated += text;
          handlers.onDelta(text);
        }

        // Images can appear in several shapes across providers:
        //   delta.images: [{ image_url: { url } }]         (OpenRouter image models)
        //   delta.content parts of type "image_url"        (multimodal streams)
        //   message.images (non-streaming fallback)        (Gemini via OpenRouter)
        //   message.content parts with type "output_image"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const imageArr: any[] = [
          ...(Array.isArray(delta?.images) ? delta.images : []),
          ...(Array.isArray(choice?.message?.images)
            ? choice.message.images
            : []),
        ];
        for (const img of imageArr) {
          const url =
            img?.image_url?.url ??
            img?.url ??
            (typeof img === "string" ? img : "");
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
          reqIn = chunk.usage.prompt_tokens ?? reqIn;
          reqOut = chunk.usage.completion_tokens ?? reqOut;
        }
      }

      tokensIn += reqIn;
      tokensOut += reqOut;

      // Output token limit hit mid-answer → automatically continue in the
      // same assistant message so the user never has to say "continue".
      if (finishReason === "length" && continuations < MAX_CONTINUATIONS) {
        continuations++;
        continue;
      }
      break;
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
