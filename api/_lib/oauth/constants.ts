export const OAUTH_PROVIDERS = {
  github: {
    name: "GitHub Copilot",
    type: "device_code" as const,
    clientId: "Iv1.b507a08c87ecfe98",
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
  grok: {
    name: "xAI Grok Build",
    type: "device_code" as const,
    clientId: "b1a00492-073a-47ea-816f-4c329264a828",
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
} as const;

export type OAuthProviderKey = keyof typeof OAUTH_PROVIDERS;
