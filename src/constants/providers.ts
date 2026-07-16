import type { ProviderDefinition, ProviderKey } from "@/types";

export const PROVIDERS: Record<ProviderKey, ProviderDefinition> = {
  openai: {
    key: "openai",
    name: "OpenAI",
    description:
      "GPT-4o, GPT-4.1, o-series reasoning, and the flagship OpenAI catalog.",
    baseURL: "https://api.openai.com/v1",
    docsURL: "https://platform.openai.com/docs",
    gradient: "from-emerald-400 via-teal-500 to-cyan-600",
    supportsModelsList: true,
    logo: "openai",
  },
  nvidia: {
    key: "nvidia",
    name: "NVIDIA NIM",
    description:
      "NVIDIA-hosted open models — Llama, Mistral, Nemotron, and more.",
    baseURL: "https://integrate.api.nvidia.com/v1",
    docsURL: "https://docs.nvidia.com/nim/",
    gradient: "from-lime-400 via-green-500 to-emerald-600",
    supportsModelsList: true,
    logo: "nvidia",
  },
  anthropic: {
    key: "anthropic",
    name: "Claude (Anthropic)",
    description:
      "Anthropic's Claude family via the OpenAI-compatible endpoint.",
    baseURL: "https://api.anthropic.com/v1",
    docsURL: "https://docs.anthropic.com",
    gradient: "from-orange-400 via-amber-500 to-rose-500",
    supportsModelsList: false,
    logo: "anthropic",
  },
  openrouter: {
    key: "openrouter",
    name: "OpenRouter",
    description:
      "Unified access to 200+ models from every major AI provider.",
    baseURL: "https://openrouter.ai/api/v1",
    docsURL: "https://openrouter.ai/docs",
    gradient: "from-indigo-400 via-violet-500 to-fuchsia-600",
    supportsModelsList: true,
    logo: "openrouter",
  },
  custom: {
    key: "custom",
    name: "OpenAI Compatible",
    description:
      "Any OpenAI-compatible endpoint — just paste API key + base URL. Works with NVIDIA, Groq, Together, Ollama, LM Studio, vLLM, LiteLLM…",
    baseURL: "",
    docsURL: "",
    gradient: "from-slate-400 via-zinc-500 to-neutral-600",
    supportsModelsList: true,
    logo: "custom",
  },
};

export const PROVIDER_LIST = Object.values(PROVIDERS);

export const KNOWN_MODEL_CAPS: Record<
  string,
  {
    context?: number;
    vision?: boolean;
    pdf?: boolean;
    reasoning?: boolean;
    inputPrice?: number;
    outputPrice?: number;
  }
> = {
  "gpt-4o": { context: 128_000, vision: true, inputPrice: 2.5, outputPrice: 10 },
  "gpt-4o-mini": {
    context: 128_000,
    vision: true,
    inputPrice: 0.15,
    outputPrice: 0.6,
  },
  "gpt-4.1": {
    context: 1_047_576,
    vision: true,
    inputPrice: 2,
    outputPrice: 8,
  },
  "gpt-4.1-mini": {
    context: 1_047_576,
    vision: true,
    inputPrice: 0.4,
    outputPrice: 1.6,
  },
  "o1": { context: 200_000, reasoning: true, inputPrice: 15, outputPrice: 60 },
  "o3-mini": {
    context: 200_000,
    reasoning: true,
    inputPrice: 1.1,
    outputPrice: 4.4,
  },
  "claude-3-5-sonnet-20241022": {
    context: 200_000,
    vision: true,
    pdf: true,
    inputPrice: 3,
    outputPrice: 15,
  },
  "claude-3-5-haiku-20241022": {
    context: 200_000,
    inputPrice: 0.8,
    outputPrice: 4,
  },
  "claude-3-opus-20240229": {
    context: 200_000,
    vision: true,
    pdf: true,
    inputPrice: 15,
    outputPrice: 75,
  },
  "claude-opus-4-8": {
    context: 1_000_000,
    vision: true,
    pdf: true,
    inputPrice: 5,
    outputPrice: 25,
  },
  "claude-sonnet-4-6": {
    context: 1_000_000,
    vision: true,
    pdf: true,
    inputPrice: 3,
    outputPrice: 15,
  },
  "claude-sonnet-4-5": {
    context: 200_000,
    vision: true,
    pdf: true,
    inputPrice: 3,
    outputPrice: 15,
  },
  "claude-haiku-4-5": {
    context: 200_000,
    vision: true,
    pdf: true,
    inputPrice: 1,
    outputPrice: 5,
  },
};

export type ModelTier = "free" | "paid" | "unknown";

export function inferTier(params: {
  providerKey: ProviderKey;
  modelId: string;
  baseURL?: string;
  inputPrice?: number;
  outputPrice?: number;
}): ModelTier {
  const { providerKey, modelId, baseURL, inputPrice, outputPrice } = params;
  const id = modelId.toLowerCase();

  // Explicit pricing takes precedence — trust what the provider told us.
  if (inputPrice != null && outputPrice != null) {
    return inputPrice === 0 && outputPrice === 0 ? "free" : "paid";
  }

  // OpenRouter: `:free` suffix is the only reliable free indicator when
  // pricing is missing. Everything else defaults to paid (they're a marketplace).
  if (providerKey === "openrouter") {
    if (id.endsWith(":free") || id.includes(":free")) return "free";
    return "paid";
  }

  // NVIDIA "build" tier — all models on integrate.api.nvidia.com are free with rate limits.
  if (providerKey === "nvidia") return "free";

  // Big paid clouds.
  if (providerKey === "openai" || providerKey === "anthropic") return "paid";

  // Custom endpoints: localhost = free (local inference), rest unknown.
  if (providerKey === "custom") {
    if (baseURL && /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(baseURL)) {
      return "free";
    }
    return "unknown";
  }

  return "unknown";
}

export function inferCapabilities(modelId: string) {
  const lower = modelId.toLowerCase();
  const exact = KNOWN_MODEL_CAPS[modelId];
  const vision =
    exact?.vision ??
    /vision|gpt-4o|gpt-4\.1|claude|gemini|llava|pixtral|qwen.*vl/.test(lower);
  const pdf = exact?.pdf ?? /claude/.test(lower);
  const reasoning =
    exact?.reasoning ??
    /^o[13]|reason|deepseek-r1|qwq/.test(lower);
  return {
    context: exact?.context,
    vision,
    pdf,
    streaming: true,
    toolCalling: !reasoning,
    reasoning,
    inputPrice: exact?.inputPrice,
    outputPrice: exact?.outputPrice,
  };
}
