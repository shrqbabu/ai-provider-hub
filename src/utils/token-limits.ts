import type { Chat, CompressMode, DiscoveredModel } from "@/types";
import { useSettingsStore } from "@/store/settings-store";

export const OUTPUT_TOKEN_PRESETS = [
  { id: "auto", label: "Auto", value: 0 },
  { id: "1k", label: "1K", value: 1024 },
  { id: "2k", label: "2K", value: 2048 },
  { id: "4k", label: "4K", value: 4096 },
  { id: "8k", label: "8K", value: 8192 },
  { id: "16k", label: "16K", value: 16384 },
  { id: "32k", label: "32K", value: 32768 },
  { id: "64k", label: "64K", value: 65536 },
] as const;

export const CONTEXT_TOKEN_PRESETS = [
  { id: "8k", label: "8K", value: 8192 },
  { id: "16k", label: "16K", value: 16384 },
  { id: "32k", label: "32K", value: 32768 },
  { id: "64k", label: "64K", value: 65536 },
  { id: "128k", label: "128K", value: 131072 },
  { id: "200k", label: "200K", value: 200000 },
  { id: "1m", label: "1M", value: 1_000_000 },
] as const;

function inheritBool(
  local: boolean | undefined,
  fallback: boolean | undefined
): boolean {
  if (typeof local === "boolean") return local;
  return !!fallback;
}

export function resolveMaxOutputTokens(
  model?: DiscoveredModel,
  chatMax?: number
): number {
  if (chatMax && chatMax > 0) return chatMax;
  if (model?.maxTokens && model.maxTokens > 0) return model.maxTokens;
  const userMax = useSettingsStore.getState().settings.maxTokens;
  if (userMax && userMax > 0) return userMax;
  const id = (model?.modelId || "").toLowerCase();
  if (model?.reasoning || /o[13]|deepseek-r1|qwq|thinking/.test(id)) {
    return 32_768;
  }
  return 16_384;
}

export function resolveContextWindow(model?: DiscoveredModel): number {
  if (model?.tokenLimit && model.tokenLimit > 0) return model.tokenLimit;
  if (model?.contextWindow && model.contextWindow > 0) return model.contextWindow;
  return 128_000;
}

export function resolveContextBudget(model?: DiscoveredModel): number {
  const settings = useSettingsStore.getState().settings;
  const window = resolveContextWindow(model);
  const reserve = Math.max(
    256,
    settings.contextReserveTokens ||
      (settings.maxTokens && settings.maxTokens > 0 ? settings.maxTokens : 4096)
  );
  const threshold = Math.min(0.95, Math.max(0.4, settings.tokenCompressThreshold ?? 0.75));
  return Math.max(1024, Math.floor(window * threshold) - reserve);
}

export function isTokenCompressEnabled(
  model?: DiscoveredModel,
  chat?: Chat
): boolean {
  const settings = useSettingsStore.getState().settings;
  if (typeof chat?.tokenCompress === "boolean") return chat.tokenCompress;
  if (typeof model?.tokenCompress === "boolean") return model.tokenCompress;
  return settings.tokenCompress !== false;
}

export function isPromptCompressEnabled(
  model?: DiscoveredModel,
  chat?: Chat
): boolean {
  const settings = useSettingsStore.getState().settings;
  if (typeof chat?.promptCompress === "boolean") return chat.promptCompress;
  if (typeof model?.promptCompress === "boolean") return model.promptCompress;
  return settings.promptCompress !== false;
}

export function resolveCompressMode(
  kind: "token" | "prompt",
  model?: DiscoveredModel,
  chat?: Chat
): CompressMode {
  if (chat?.compressMode && chat.compressMode !== "off") return chat.compressMode;
  if (model?.compressMode && model.compressMode !== "off") return model.compressMode;
  const settings = useSettingsStore.getState().settings;
  const mode =
    kind === "token" ? settings.tokenCompressMode : settings.promptCompressMode;
  return mode || "smart";
}

export function resolveTemperature(model?: DiscoveredModel): number | undefined {
  if (model?.temperature == null) return undefined;
  if (!Number.isFinite(model.temperature)) return undefined;
  return Math.min(2, Math.max(0, model.temperature));
}

export { inheritBool };
