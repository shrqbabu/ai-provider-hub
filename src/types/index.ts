export type ProviderKey =
  | "openai"
  | "nvidia"
  | "anthropic"
  | "openrouter"
  | "custom";

export interface ProviderDefinition {
  key: ProviderKey;
  name: string;
  description: string;
  baseURL: string;
  docsURL: string;
  gradient: string;
  supportsModelsList: boolean;
  logo: string;
}

export interface ConnectedProvider {
  id: string;
  key: ProviderKey;
  name: string;
  displayName: string;
  // Auth mode: "apiKey" (default) sends Authorization: Bearer <apiKey>.
  // "cookie" sends the raw cookie string as the Cookie header instead —
  // for self-hosted / OpenAI-compatible gateways that use session cookies.
  authMode?: "apiKey" | "cookie";
  apiKey: string;
  // Raw cookie string (e.g. "session=abc; token=xyz"), used when authMode === "cookie".
  cookie?: string;
  baseURL: string;
  organization?: string;
  extraHeaders?: Record<string, string>;
  connectedAt: number;
  lastCheckedAt?: number;
  isCustom?: boolean;
  customLogo?: string;
  streaming: boolean;
  vision: boolean;
  fileUpload: boolean;
  defaultModel?: string;
}

export interface DiscoveredModel {
  id: string;
  providerId: string;
  providerKey: ProviderKey;
  modelId: string;
  displayName: string;
  contextWindow?: number;
  vision: boolean;
  pdf: boolean;
  streaming: boolean;
  toolCalling: boolean;
  reasoning: boolean;
  inputPrice?: number;
  outputPrice?: number;
  createdAt?: number;
  favorite?: boolean;
  saved?: boolean;
  manual?: boolean;
  tier?: "free" | "paid" | "unknown";
}

export interface ChatAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: ChatAttachment[];
  // Image URLs the assistant returned (e.g. from image-gen or vision models
  // that echo back images). Rendered inline in the bubble.
  images?: string[];
  createdAt: number;
  model?: string;
  providerId?: string;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  error?: string;
}

export interface Chat {
  id: string;
  title: string;
  messages: ChatMessage[];
  providerId?: string;
  modelId?: string;
  createdAt: number;
  updatedAt: number;
  favorite?: boolean;
  pinned?: boolean;
  deleted?: boolean;
  systemPrompt?: string;
}

export interface Prompt {
  id: string;
  title: string;
  content: string;
  folder?: string;
  tags: string[];
  favorite?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UsageEntry {
  id: string;
  providerId: string;
  providerKey: ProviderKey;
  modelId: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  durationMs: number;
  createdAt: number;
}

export interface AppSettings {
  theme: "dark" | "light" | "system";
  accent: string;
  sidebarWidth: number;
  animations: boolean;
  streamingSpeed: number;
  autoScroll: boolean;
  // Max output tokens per request. 0 / undefined = auto (16K normal,
  // 32K reasoning models).
  maxTokens?: number;
}
