import crypto from "crypto";
import { OAUTH_PROVIDERS, type OAuthProviderKey } from "./constants.js";

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

export interface PollResult {
  status: "pending" | "success" | "expired" | "error";
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  error?: string;
  user?: {
    id?: string | number;
    login?: string;
    name?: string;
    email?: string;
    avatarUrl?: string;
  };
  providerSpecificData?: Record<string, unknown>;
}

export interface PkceInitResponse {
  authUrl: string;
  codeVerifier: string;
  state: string;
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateCodeVerifier(): string {
  return base64UrlEncode(crypto.randomBytes(32));
}

function generateCodeChallenge(verifier: string): string {
  return base64UrlEncode(crypto.createHash("sha256").update(verifier).digest());
}

export async function initiateDeviceCode(providerKey: string): Promise<DeviceCodeResponse> {
  const config = (OAUTH_PROVIDERS as Record<string, any>)[providerKey];
  if (!config) {
    throw new Error(`Unsupported OAuth provider: ${providerKey}`);
  }

  if (providerKey === "github") {
    const res = await fetch(config.deviceCodeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": config.userAgent,
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        scope: config.scopes,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GitHub device code error (${res.status}): ${err}`);
    }
    return (await res.json()) as DeviceCodeResponse;
  }

  if (providerKey === "grok") {
    const res = await fetch(config.deviceCodeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "x-grok-client-version": "0.2.106",
        "x-grok-client-surface": "cli",
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        scope: config.scopes,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Grok device code error (${res.status}): ${err}`);
    }
    return (await res.json()) as DeviceCodeResponse;
  }

  if (providerKey === "kimi") {
    const deviceId = crypto.randomUUID();
    const res = await fetch(config.deviceCodeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "x-device-id": deviceId,
        "x-device-name": "desktop",
        "x-device-model": "windows",
        "x-os-version": "10",
      },
      body: new URLSearchParams({
        client_id: config.clientId,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Kimi device code error (${res.status}): ${err}`);
    }

    const data = await res.json();
    return {
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri || "https://www.kimi.com/code/authorize_device",
      verification_uri_complete: data.verification_uri_complete || `https://www.kimi.com/code/authorize_device?user_code=${data.user_code}`,
      expires_in: data.expires_in || 1800,
      interval: data.interval || 5,
    };
  }

  throw new Error(`Provider ${providerKey} does not support device code flow.`);
}

export async function pollDeviceToken(
  providerKey: string,
  deviceCode: string
): Promise<PollResult> {
  const config = (OAUTH_PROVIDERS as Record<string, any>)[providerKey];
  if (!config) {
    return { status: "error", error: `Unsupported provider: ${providerKey}` };
  }

  try {
    if (providerKey === "github") {
      const res = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": config.userAgent,
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

      const data = await res.json();

      if (data.error) {
        if (data.error === "authorization_pending" || data.error === "slow_down") {
          return { status: "pending" };
        }
        if (data.error === "expired_token") {
          return { status: "expired", error: "Device code expired. Please request a new code." };
        }
        if (data.error === "access_denied") {
          return { status: "error", error: "Login request was denied." };
        }
        return { status: "error", error: data.error_description || data.error };
      }

      if (data.access_token) {
        let userInfo: any = {};
        let copilotToken: any = {};

        try {
          const userRes = await fetch(config.userInfoUrl, {
            headers: {
              Authorization: `Bearer ${data.access_token}`,
              Accept: "application/json",
              "User-Agent": config.userAgent,
            },
          });
          if (userRes.ok) userInfo = await userRes.json();
        } catch {}

        try {
          const copilotRes = await fetch(config.copilotTokenUrl, {
            headers: {
              Authorization: `Bearer ${data.access_token}`,
              Accept: "application/json",
              "X-GitHub-Api-Version": config.apiVersion,
              "User-Agent": config.userAgent,
            },
          });
          if (copilotRes.ok) copilotToken = await copilotRes.json();
        } catch {}

        return {
          status: "success",
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresIn: data.expires_in,
          user: {
            id: userInfo.id,
            login: userInfo.login,
            name: userInfo.name || userInfo.login,
            email: userInfo.email,
            avatarUrl: userInfo.avatar_url,
          },
          providerSpecificData: {
            copilotToken: copilotToken.token,
            copilotTokenExpiresAt: copilotToken.expires_at,
            copilotEndpoints: copilotToken.endpoints,
          },
        };
      }
    }

    if (providerKey === "grok") {
      const res = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "x-grok-client-version": "0.2.106",
          "x-grok-client-surface": "cli",
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

      const data = await res.json();

      if (data.error) {
        if (data.error === "authorization_pending" || data.error === "slow_down") {
          return { status: "pending" };
        }
        if (data.error === "expired_token") {
          return { status: "expired", error: "Device code expired." };
        }
        return { status: "error", error: data.error_description || data.error };
      }

      if (data.access_token) {
        return {
          status: "success",
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresIn: data.expires_in,
          user: {
            name: "xAI User",
          },
        };
      }
    }

    if (providerKey === "kimi") {
      const res = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

      const data = await res.json();

      if (data.error) {
        if (data.error === "authorization_pending" || data.error === "slow_down") {
          return { status: "pending" };
        }
        if (data.error === "expired_token") {
          return { status: "expired", error: "Device code expired." };
        }
        return { status: "error", error: data.error_description || data.error };
      }

      if (data.access_token) {
        return {
          status: "success",
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresIn: data.expires_in,
          user: {
            name: "Kimi AI Developer",
          },
        };
      }
    }

    return { status: "error", error: "No token returned." };
  } catch (err: any) {
    return { status: "error", error: err.message || "Failed to poll token" };
  }
}

export function initiatePkce(providerKey: string, callbackRedirectUri?: string): PkceInitResponse {
  const config = (OAUTH_PROVIDERS as Record<string, any>)[providerKey];
  if (!config) throw new Error(`Unsupported OAuth provider: ${providerKey}`);

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(16).toString("hex");

  if (providerKey === "antigravity") {
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: callbackRedirectUri || "http://localhost:3000/api/oauth/callback",
      scope: Array.isArray(config.scopes) ? config.scopes.join(" ") : config.scopes,
      state,
      access_type: "offline",
      prompt: "consent",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    return {
      authUrl: `${config.authorizeUrl}?${params.toString()}`,
      codeVerifier,
      state,
    };
  }

  if (providerKey === "claude") {
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: "https://platform.claude.com/oauth/code/callback",
      scope: Array.isArray(config.scopes) ? config.scopes.join(" ") : config.scopes,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    return {
      authUrl: `${config.authorizeUrl}?${params.toString()}`,
      codeVerifier,
      state,
    };
  }

  if (providerKey === "codex") {
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: callbackRedirectUri || "http://localhost:3000/api/oauth/callback",
      scope: config.scope || "openid profile email offline_access",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      prompt: "login",
    });
    return {
      authUrl: `${config.authorizeUrl}?${params.toString()}`,
      codeVerifier,
      state,
    };
  }

  throw new Error(`Provider ${providerKey} does not support PKCE flow.`);
}

export async function exchangePkceCode(
  providerKey: string,
  code: string,
  codeVerifier: string,
  redirectUri?: string
): Promise<PollResult> {
  const config = (OAUTH_PROVIDERS as Record<string, any>)[providerKey];
  if (!config) throw new Error(`Unsupported OAuth provider: ${providerKey}`);

  const bodyParams: Record<string, string> = {
    grant_type: "authorization_code",
    client_id: config.clientId,
    code: code.trim(),
    code_verifier: codeVerifier,
    redirect_uri: redirectUri || (providerKey === "claude" ? "https://platform.claude.com/oauth/code/callback" : "http://localhost:3000/api/oauth/callback"),
  };

  if (config.clientSecret) {
    bodyParams.client_secret = config.clientSecret;
  }

  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(bodyParams),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || `Exchange failed (${res.status})`);
  }

  return {
    status: "success",
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    user: {
      name: providerKey === "antigravity" ? "Google Antigravity User" : providerKey === "claude" ? "Claude Code User" : "OpenAI Codex User",
    },
  };
}
