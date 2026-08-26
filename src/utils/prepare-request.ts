import type { Chat, ChatMessage, DiscoveredModel, Prompt } from "@/types";
import { usePromptStore } from "@/store/prompt-store";
import { useSettingsStore } from "@/store/settings-store";
import { compressConversation, compressPrompt } from "./compress";
import {
  isPromptCompressEnabled,
  isTokenCompressEnabled,
  resolveCompressMode,
  resolveContextBudget,
  resolveMaxOutputTokens,
  resolveTemperature,
} from "./token-limits";

export interface PreparedRequest {
  messages: ChatMessage[];
  systemPrompt?: string;
  maxTokens: number;
  temperature?: number;
  compressMeta: {
    applied: boolean;
    tokenSaved: number;
    promptSaved: number;
    compressedTurns: number;
  };
}

function lookupPrompt(id: string | undefined, prompts: Prompt[]): Prompt | undefined {
  if (!id) return undefined;
  return prompts.find((p) => p.id === id);
}

/** Combine chat / model / global context prompts + custom system text. */
export function resolveSystemPrompt(
  model?: DiscoveredModel,
  chat?: Chat,
  prompts?: Prompt[]
): string {
  const list = prompts ?? usePromptStore.getState().prompts;
  const settings = useSettingsStore.getState().settings;
  const parts: string[] = [];

  const contextId =
    chat?.contextPromptId ||
    model?.contextPromptId ||
    settings.defaultContextPromptId;
  const context = lookupPrompt(contextId, list);
  if (context?.content?.trim()) parts.push(context.content.trim());

  if (model?.customSystemPrompt?.trim()) {
    parts.push(model.customSystemPrompt.trim());
  }
  if (chat?.systemPrompt?.trim()) {
    parts.push(chat.systemPrompt.trim());
  }
  return parts.filter(Boolean).join("\n\n");
}

export function prepareChatRequest(opts: {
  messages: ChatMessage[];
  model: DiscoveredModel;
  chat?: Chat;
}): PreparedRequest {
  const { messages, model, chat } = opts;
  let systemPrompt = resolveSystemPrompt(model, chat);
  let promptSaved = 0;

  if (systemPrompt && isPromptCompressEnabled(model, chat)) {
    const mode = resolveCompressMode("prompt", model, chat);
    const result = compressPrompt(systemPrompt, mode);
    systemPrompt = result.text;
    promptSaved = result.saved;
  }

  let prepared = messages;
  let tokenSaved = 0;
  let compressedTurns = 0;
  let applied = promptSaved > 0;

  if (isTokenCompressEnabled(model, chat)) {
    const mode = resolveCompressMode("token", model, chat);
    const settings = useSettingsStore.getState().settings;
    const keepLast = Math.max(2, settings.keepLastMessages ?? 6);
    const budget = resolveContextBudget(model);
    const result = compressConversation(messages, budget, mode, keepLast);
    prepared = result.messages;
    tokenSaved = result.saved;
    compressedTurns = result.compressedTurns;
    applied = applied || result.applied;
  }

  return {
    messages: prepared,
    systemPrompt: systemPrompt || undefined,
    maxTokens: resolveMaxOutputTokens(model, chat?.maxTokens),
    temperature: resolveTemperature(model),
    compressMeta: {
      applied,
      tokenSaved,
      promptSaved,
      compressedTurns,
    },
  };
}
