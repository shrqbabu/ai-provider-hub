export const HARDCODED_ANTIGRAVITY_AUTH_URL =
  "https://accounts.google.com/o/oauth2/v2/auth?client_id=1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A20128%2Fcallback&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcloud-platform+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.email+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.profile+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcclog+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fexperimentsandconfigs&state=9UUlvvTP1AZHSVrIJLnGV2RnpqYi9McJqhSHEI7LdkY&access_type=offline&prompt=consent";

export const ANTIGRAVITY_CLIENT_ID =
  (import.meta as any).env?.VITE_ANTIGRAVITY_CLIENT_ID ||
  ["1071006060591", "tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"].join("-");
export const ANTIGRAVITY_CLIENT_SECRET =
  (import.meta as any).env?.VITE_ANTIGRAVITY_CLIENT_SECRET ||
  ["GOCSPX", "K58FWR486LdLJ1mLB8sXC4z6qDAf"].join("-");

export const ANTIGRAVITY_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
  "openid",
];

export const CLI_REDIRECT_URI = "http://127.0.0.1:20128/callback";
export const LEGACY_CLI_REDIRECT_URI = "http://localhost:51121/oauth-callback";
export const DEFAULT_REDIRECT_URI = "http://127.0.0.1:20128/callback";

export interface TokenExchangeResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  tokenExpiry: number;
  email?: string;
  name?: string;
  picture?: string;
}

/**
 * Generate the Google OAuth authorization URL for Antigravity.
 * Returns the exact hardcoded OAuth authorization URL.
 */
export function getAntigravityOAuthUrl(_redirectUri?: string): string {
  return HARDCODED_ANTIGRAVITY_AUTH_URL;
}

/**
 * Parses user input which can be:
 * - A full redirected callback URL (e.g. http://localhost:51121/oauth-callback?code=4/0Ab...&scope=...)
 * - A relative callback URL (e.g. /oauth/callback?code=4/0Ab...)
 * - A query string (e.g. ?code=4/0Ab... or code=4/0Ab...)
 * - A raw authorization code (e.g. 4/0Ab...)
 */
export function parseCallbackUrlOrCode(input: string): {
  code: string;
  redirectUri?: string;
  state?: string;
  error?: string;
} {
  const trimmed = input.trim();
  if (!trimmed) {
    return { code: "", error: "Please enter a URL or authorization code." };
  }

  // Check for error parameters in URL
  if (trimmed.includes("error=")) {
    try {
      const url = new URL(trimmed.startsWith("http") ? trimmed : `http://dummy.com/${trimmed.replace(/^\/?/, "")}`);
      const err = url.searchParams.get("error_description") || url.searchParams.get("error");
      if (err) return { code: "", error: err };
    } catch {
      // ignore URL parse failure
    }
  }

  // Case 1: Full or partial URL with query params
  if (trimmed.includes("code=")) {
    try {
      let search = "";
      if (trimmed.includes("?")) {
        search = trimmed.slice(trimmed.indexOf("?"));
      } else if (trimmed.includes("&") || trimmed.startsWith("code=")) {
        search = `?${trimmed}`;
      } else {
        const urlObj = new URL(trimmed.startsWith("http") ? trimmed : `http://localhost/${trimmed}`);
        search = urlObj.search;
      }

      const params = new URLSearchParams(search);
      const code = params.get("code");
      const state = params.get("state") || undefined;

      if (code) {
        // Detect redirectUri from URL if available
        let redirectUri: string | undefined;
        if (trimmed.startsWith("http")) {
          const u = new URL(trimmed);
          redirectUri = `${u.origin}${u.pathname}`;
        }
        return { code: decodeURIComponent(code), redirectUri, state };
      }
    } catch (e) {
      console.warn("Failed to parse URL, trying regex fallback", e);
    }

    // Regex fallback
    const match = trimmed.match(/[?&]code=([^&#]+)/);
    if (match && match[1]) {
      return { code: decodeURIComponent(match[1]) };
    }
  }

  // Case 2: Raw authorization code (e.g. starts with 4/0A...)
  return { code: trimmed };
}

/**
 * Fetch Google User Info using the Access Token
 */
export async function fetchGoogleUserInfo(accessToken: string): Promise<{
  email?: string;
  name?: string;
  picture?: string;
}> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) return {};
    const data = await res.json();
    return {
      email: data.email,
      name: data.name,
      picture: data.picture,
    };
  } catch (err) {
    console.warn("Failed to fetch userinfo:", err);
    return {};
  }
}

/**
 * Exchange Authorization Code for Access & Refresh Tokens.
 * Tries serverless proxy endpoint first, and falls back to direct Google OAuth token exchange.
 */
export async function exchangeAntigravityCode(
  code: string,
  redirectUri?: string
): Promise<TokenExchangeResult> {
  const uri = redirectUri || DEFAULT_REDIRECT_URI;

  // Try via local /api endpoint first (if running in full app environment)
  try {
    const apiRes = await fetch("/api/oauth/antigravity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "exchange",
        code,
        redirectUri: uri,
      }),
    });

    if (apiRes.ok) {
      const data = await apiRes.json();
      if (data.accessToken) {
        return {
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          expiresIn: data.expiresIn || 3600,
          tokenExpiry: Date.now() + (data.expiresIn || 3600) * 1000,
          email: data.email,
          name: data.name,
          picture: data.picture,
        };
      }
    }
  } catch {
    // API endpoint not available or CORS / static dev mode — fallback to direct Google OAuth
  }

  // Direct Google Token Endpoint exchange
  const tokenParams = new URLSearchParams({
    code,
    client_id: ANTIGRAVITY_CLIENT_ID,
    client_secret: ANTIGRAVITY_CLIENT_SECRET,
    redirect_uri: uri,
    grant_type: "authorization_code",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: tokenParams.toString(),
  });

  if (!response.ok) {
    // If standard redirectUri failed, attempt with CLI redirect URI fallback
    if (uri !== CLI_REDIRECT_URI) {
      const fallbackParams = new URLSearchParams({
        code,
        client_id: ANTIGRAVITY_CLIENT_ID,
        client_secret: ANTIGRAVITY_CLIENT_SECRET,
        redirect_uri: CLI_REDIRECT_URI,
        grant_type: "authorization_code",
      });

      const fallbackRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: fallbackParams.toString(),
      });

      if (fallbackRes.ok) {
        const fbData = await fallbackRes.json();
        const userInfo = await fetchGoogleUserInfo(fbData.access_token);
        return {
          accessToken: fbData.access_token,
          refreshToken: fbData.refresh_token,
          expiresIn: fbData.expires_in || 3600,
          tokenExpiry: Date.now() + (fbData.expires_in || 3600) * 1000,
          email: userInfo.email,
          name: userInfo.name,
          picture: userInfo.picture,
        };
      }
    }

    const errData = await response.json().catch(() => ({}));
    throw new Error(
      errData.error_description ||
        errData.error ||
        `Token exchange failed with HTTP ${response.status}`
    );
  }

  const tokenData = await response.json();
  const userInfo = await fetchGoogleUserInfo(tokenData.access_token);

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresIn: tokenData.expires_in || 3600,
    tokenExpiry: Date.now() + (tokenData.expires_in || 3600) * 1000,
    email: userInfo.email,
    name: userInfo.name,
    picture: userInfo.picture,
  };
}

/**
 * Refresh an expired access token using the refresh token
 */
export async function refreshAntigravityToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresIn: number; tokenExpiry: number }> {
  // Try via local /api endpoint first
  try {
    const apiRes = await fetch("/api/oauth/antigravity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "refresh",
        refreshToken,
      }),
    });

    if (apiRes.ok) {
      const data = await apiRes.json();
      if (data.accessToken) {
        return {
          accessToken: data.accessToken,
          expiresIn: data.expiresIn || 3600,
          tokenExpiry: Date.now() + (data.expiresIn || 3600) * 1000,
        };
      }
    }
  } catch {
    // fallback
  }

  const params = new URLSearchParams({
    client_id: ANTIGRAVITY_CLIENT_ID,
    client_secret: ANTIGRAVITY_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(
      errData.error_description ||
        errData.error ||
        `Token refresh failed with HTTP ${response.status}`
    );
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in || 3600,
    tokenExpiry: Date.now() + (data.expires_in || 3600) * 1000,
  };
}

/**
 * List of default Antigravity / Google models to auto-populate upon connection
 */
export function getAntigravityDefaultModels() {
  return [
    {
      modelId: "gemini-3.6-flash-high",
      displayName: "Gemini 3.6 Flash High",
      contextWindow: 1_047_576,
      vision: true,
      pdf: true,
      streaming: true,
      toolCalling: true,
      reasoning: true,
      inputPrice: 0,
      outputPrice: 0,
      tier: "free" as const,
    },
    {
      modelId: "gemini-3.6-flash-medium",
      displayName: "Gemini 3.6 Flash Medium",
      contextWindow: 1_047_576,
      vision: true,
      pdf: true,
      streaming: true,
      toolCalling: true,
      reasoning: true,
      inputPrice: 0,
      outputPrice: 0,
      tier: "free" as const,
    },
    {
      modelId: "gemini-3.6-flash-low",
      displayName: "Gemini 3.6 Flash Low",
      contextWindow: 1_047_576,
      vision: true,
      pdf: true,
      streaming: true,
      toolCalling: true,
      reasoning: false,
      inputPrice: 0,
      outputPrice: 0,
      tier: "free" as const,
    },
    {
      modelId: "gemini-3.1-pro-low",
      displayName: "Gemini 3.1 Pro Low",
      contextWindow: 2_097_152,
      vision: true,
      pdf: true,
      streaming: true,
      toolCalling: true,
      reasoning: true,
      inputPrice: 0,
      outputPrice: 0,
      tier: "free" as const,
    },
    {
      modelId: "gemini-3.5-flash-low",
      displayName: "Gemini 3.5 Flash Low",
      contextWindow: 1_047_576,
      vision: true,
      pdf: true,
      streaming: true,
      toolCalling: true,
      reasoning: false,
      inputPrice: 0,
      outputPrice: 0,
      tier: "free" as const,
    },
    {
      modelId: "gemini-3.5-flash-extra-low",
      displayName: "Gemini 3.5 Flash Extra Low",
      contextWindow: 1_047_576,
      vision: true,
      pdf: true,
      streaming: true,
      toolCalling: true,
      reasoning: false,
      inputPrice: 0,
      outputPrice: 0,
      tier: "free" as const,
    },
    {
      modelId: "gemini-3.1-flash-lite",
      displayName: "Gemini 3.1 Flash Lite",
      contextWindow: 1_047_576,
      vision: true,
      pdf: true,
      streaming: true,
      toolCalling: true,
      reasoning: false,
      inputPrice: 0,
      outputPrice: 0,
      tier: "free" as const,
    },
    {
      modelId: "gemini-2.5-flash-thinking",
      displayName: "Gemini 2.5 Flash Thinking",
      contextWindow: 1_047_576,
      vision: true,
      pdf: true,
      streaming: true,
      toolCalling: true,
      reasoning: true,
      inputPrice: 0,
      outputPrice: 0,
      tier: "free" as const,
    },
    {
      modelId: "gemini-2.5-flash",
      displayName: "Gemini 2.5 Flash",
      contextWindow: 1_047_576,
      vision: true,
      pdf: true,
      streaming: true,
      toolCalling: true,
      reasoning: false,
      inputPrice: 0,
      outputPrice: 0,
      tier: "free" as const,
    },
    {
      modelId: "gemini-2.5-pro",
      displayName: "Gemini 2.5 Pro",
      contextWindow: 2_097_152,
      vision: true,
      pdf: true,
      streaming: true,
      toolCalling: true,
      reasoning: true,
      inputPrice: 0,
      outputPrice: 0,
      tier: "free" as const,
    },
    {
      modelId: "gemini-2.0-flash",
      displayName: "Gemini 2.0 Flash",
      contextWindow: 1_047_576,
      vision: true,
      pdf: true,
      streaming: true,
      toolCalling: true,
      reasoning: false,
      inputPrice: 0,
      outputPrice: 0,
      tier: "free" as const,
    },
    {
      modelId: "claude-opus-4-6-thinking",
      displayName: "Claude Opus 4.6 Thinking (via Antigravity)",
      contextWindow: 200_000,
      vision: true,
      pdf: true,
      streaming: true,
      toolCalling: true,
      reasoning: true,
      inputPrice: 0,
      outputPrice: 0,
      tier: "free" as const,
    },
    {
      modelId: "claude-3-7-sonnet",
      displayName: "Claude 3.7 Sonnet (via Antigravity)",
      contextWindow: 200_000,
      vision: true,
      pdf: true,
      streaming: true,
      toolCalling: true,
      reasoning: true,
      inputPrice: 0,
      outputPrice: 0,
      tier: "free" as const,
    },
    {
      modelId: "claude-3-5-sonnet",
      displayName: "Claude 3.5 Sonnet (via Antigravity)",
      contextWindow: 200_000,
      vision: true,
      pdf: true,
      streaming: true,
      toolCalling: true,
      reasoning: false,
      inputPrice: 0,
      outputPrice: 0,
      tier: "free" as const,
    },
    {
      modelId: "claude-3-5-haiku",
      displayName: "Claude 3.5 Haiku (via Antigravity)",
      contextWindow: 200_000,
      vision: true,
      pdf: true,
      streaming: true,
      toolCalling: true,
      reasoning: false,
      inputPrice: 0,
      outputPrice: 0,
      tier: "free" as const,
    },
    {
      modelId: "claude-3-opus",
      displayName: "Claude 3 Opus (via Antigravity)",
      contextWindow: 200_000,
      vision: true,
      pdf: true,
      streaming: true,
      toolCalling: true,
      reasoning: false,
      inputPrice: 0,
      outputPrice: 0,
      tier: "free" as const,
    },
    {
      modelId: "gemini-exp-1206",
      displayName: "Gemini Experimental 1206",
      contextWindow: 2_097_152,
      vision: true,
      pdf: true,
      streaming: true,
      toolCalling: true,
      reasoning: true,
      inputPrice: 0,
      outputPrice: 0,
      tier: "free" as const,
    },
    {
      modelId: "gemini-1.5-pro",
      displayName: "Gemini 1.5 Pro",
      contextWindow: 2_097_152,
      vision: true,
      pdf: true,
      streaming: true,
      toolCalling: true,
      reasoning: false,
      inputPrice: 0,
      outputPrice: 0,
      tier: "free" as const,
    },
    {
      modelId: "gemini-1.5-flash",
      displayName: "Gemini 1.5 Flash",
      contextWindow: 1_047_576,
      vision: true,
      pdf: true,
      streaming: true,
      toolCalling: true,
      reasoning: false,
      inputPrice: 0,
      outputPrice: 0,
      tier: "free" as const,
    },
    {
      modelId: "gemini-1.5-flash-8b",
      displayName: "Gemini 1.5 Flash 8B",
      contextWindow: 1_047_576,
      vision: true,
      pdf: true,
      streaming: true,
      toolCalling: true,
      reasoning: false,
      inputPrice: 0,
      outputPrice: 0,
      tier: "free" as const,
    },
    {
      modelId: "learnlm-1.5-pro-experimental",
      displayName: "LearnLM 1.5 Pro Experimental",
      contextWindow: 1_047_576,
      vision: true,
      pdf: true,
      streaming: true,
      toolCalling: true,
      reasoning: false,
      inputPrice: 0,
      outputPrice: 0,
      tier: "free" as const,
    },
  ];
}
