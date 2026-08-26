import type { ChatMessage, ConnectedProvider, DiscoveredModel } from "@/types";
import { resolveRawRequest, extractErrorMessage } from "./provider-service";
import { dataUrlToText, isTextLike } from "@/utils";
import { resolveMaxOutputTokens, resolveTemperature } from "@/utils/token-limits";
import type { StreamHandlers, StreamOptions } from "./chat-service";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | Array<{
    type: "text" | "image";
    text?: string;
    source?: {
      type: "base64";
      media_type: string;
      data: string;
    };
  }>;
}

function resolveMaxTokens(model: DiscoveredModel, override?: number): number {
  if (override && override > 0) return override;
  return resolveMaxOutputTokens(model);
}

function buildAnthropicMessages(
  messages: ChatMessage[],
  model: DiscoveredModel
): { system?: string; messages: AnthropicMessage[] } {
  let system: string | undefined;
  const anthropicMessages: AnthropicMessage[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      system = (system ? system + "\n\n" : "") + m.content;
      continue;
    }

    const hasAttachments = m.attachments && m.attachments.length > 0;
    if (!hasAttachments || m.role === "assistant") {
      anthropicMessages.push({
        role: m.role,
        content: m.content,
      });
      continue;
    }

    const parts: Array<{
      type: "text" | "image";
      text?: string;
      source?: { type: "base64"; media_type: string; data: string };
    }> = [];

    if (m.content) parts.push({ type: "text", text: m.content });

    for (const att of m.attachments!) {
      if (att.type.startsWith("image/") && model.vision) {
        // Extract base64 data from data URL
        const base64Match = att.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (base64Match) {
          parts.push({
            type: "image",
            source: {
              type: "base64",
              media_type: base64Match[1],
              data: base64Match[2],
            },
          });
        }
      } else if (isTextLike(att.name, att.type)) {
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

    anthropicMessages.push({
      role: m.role,
      content: parts,
    });
  }

  return { system, messages: anthropicMessages };
}

export async function streamAnthropicChat(
  provider: ConnectedProvider,
  model: DiscoveredModel,
  messages: ChatMessage[],
  handlers: StreamHandlers,
  systemPrompt?: string,
  options?: StreamOptions
): Promise<void> {
  const start = performance.now();
  console.log("[Anthropic Service] Starting stream:", {
    provider: provider.displayName,
    model: model.modelId,
    baseURL: provider.baseURL,
  });

  try {
    const { system, messages: anthropicMessages } = buildAnthropicMessages(
      messages,
      model
    );
    const finalSystem = [systemPrompt, system].filter(Boolean).join("\n\n");

    const { url, headers } = resolveRawRequest(provider, "/messages");

    // Anthropic native API requires anthropic-version header
    headers["anthropic-version"] = "2023-06-01";

    const temperature = options?.temperature ?? resolveTemperature(model);
    const body = {
      model: model.modelId,
      messages: anthropicMessages,
      max_tokens: resolveMaxTokens(model, options?.maxTokens),
      stream: true,
      ...(finalSystem ? { system: finalSystem } : {}),
      ...(temperature != null ? { temperature } : {}),
    };

    console.log("[Anthropic Service] Request:", {
      url,
      model: body.model,
      messageCount: anthropicMessages.length,
    });

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: handlers.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Anthropic Service] Error response:", {
        status: response.status,
        body: errorText,
      });
      throw new Error(`${response.status}: ${errorText}`);
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";
    let tokensIn = 0;
    let tokensOut = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (!line.trim() || !line.startsWith("data: ")) continue;

        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);

          if (parsed.type === "content_block_delta") {
            const text = parsed.delta?.text ?? "";
            if (text) {
              accumulated += text;
              handlers.onDelta(text);
            }
          } else if (parsed.type === "message_start") {
            tokensIn = parsed.message?.usage?.input_tokens ?? 0;
          } else if (parsed.type === "message_delta") {
            tokensOut = parsed.usage?.output_tokens ?? 0;
          }
        } catch (err) {
          console.warn("[Anthropic Service] Failed to parse SSE line:", line, err);
        }
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
    const errorMsg = extractErrorMessage(err);
    console.error("[Anthropic Service] Stream error:", {
      provider: provider.displayName,
      model: model.modelId,
      error: errorMsg,
      rawError: err,
    });
    handlers.onError(new Error(errorMsg));
  }
}
