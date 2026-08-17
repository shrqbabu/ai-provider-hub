import { getPublicCred } from "./public-creds.js";

export const OAUTH_PROVIDERS = {
  github: {
    name: "GitHub Copilot",
    type: "device_code" as const,
    clientId: getPublicCred("github_copilot_id", "GITHUB_OAUTH_CLIENT_ID"),
    deviceCodeUrl: "https://github.com/login/device/code",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userInfoUrl: "https://api.github.com/user",
    copilotTokenUrl: "https://api.github.com/copilot_internal/v2/token",
    scopes: "read:user",
    apiVersion: "2023-07-07",
    userAgent: "GitHubCopilot/1.0",
    defaultModels: [
      { id: "gpt-4o", name: "GPT-4o (Copilot)" },
      { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet (Copilot)" },
      { id: "o1-mini", name: "o1-mini (Copilot)" },
      { id: "o3-mini", name: "o3-mini (Copilot)" },
    ],
  },
  antigravity: {
    name: "Google Antigravity (Cloud Code)",
    type: "authorization_code" as const,
    clientId: getPublicCred("antigravity_id", "ANTIGRAVITY_OAUTH_CLIENT_ID"),
    clientSecret: getPublicCred("antigravity_alt", "ANTIGRAVITY_OAUTH_CLIENT_SECRET"),
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v1/userinfo",
    scopes: [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ],
    defaultModels: [
      { id: "claude-3-5-sonnet-v2", name: "Claude 3.5 Sonnet v2 (Antigravity)" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (Antigravity)" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (Antigravity)" },
    ],
  },
  claude: {
    name: "Claude Code CLI",
    type: "authorization_code" as const,
    clientId: getPublicCred("claude_id", "CLAUDE_OAUTH_CLIENT_ID"),
    authorizeUrl: "https://claude.ai/oauth/authorize",
    tokenUrl: "https://api.anthropic.com/v1/oauth/token",
    scopes: [
      "org:create_api_key",
      "user:profile",
      "user:inference",
      "user:sessions:claude_code",
    ],
    defaultModels: [
      { id: "claude-3-7-sonnet-latest", name: "Claude 3.7 Sonnet" },
      { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet" },
      { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku" },
    ],
  },
  grok: {
    name: "xAI Grok Build",
    type: "device_code" as const,
    clientId: getPublicCred("grok_id", "GROK_OAUTH_CLIENT_ID"),
    issuer: "https://auth.x.ai",
    deviceCodeUrl: "https://auth.x.ai/oauth2/device/code",
    tokenUrl: "https://auth.x.ai/oauth2/token",
    scopes: "openid profile email offline_access grok-cli:access api:access",
    defaultModels: [
      { id: "grok-2-latest", name: "Grok 2 (Latest)" },
      { id: "grok-2-vision-latest", name: "Grok 2 Vision" },
      { id: "grok-beta", name: "Grok Beta" },
    ],
  },
  kimi: {
    name: "Kimi Coding CLI",
    type: "device_code" as const,
    clientId: getPublicCred("kimi_id", "KIMI_CODING_OAUTH_CLIENT_ID"),
    deviceCodeUrl: "https://auth.kimi.com/api/oauth/device_authorization",
    tokenUrl: "https://auth.kimi.com/api/oauth/token",
    scopes: "offline_access",
    defaultModels: [
      { id: "kimi-k1.5", name: "Kimi k1.5 (Coding)" },
      { id: "moonshot-v1-128k", name: "Moonshot v1 128k" },
    ],
  },
  codex: {
    name: "OpenAI Codex CLI",
    type: "authorization_code" as const,
    clientId: getPublicCred("codex_id", "CODEX_OAUTH_CLIENT_ID"),
    authorizeUrl: "https://auth.openai.com/oauth/authorize",
    tokenUrl: "https://auth.openai.com/oauth/token",
    scope: "openid profile email offline_access",
    defaultModels: [
      { id: "gpt-4o", name: "GPT-4o (Codex)" },
      { id: "o1-preview", name: "o1 Preview" },
      { id: "o3-mini", name: "o3 Mini" },
    ],
  },
} as const;

export type OAuthProviderKey = keyof typeof OAUTH_PROVIDERS;
