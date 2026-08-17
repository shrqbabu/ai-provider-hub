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

  throw new Error(`Unsupported provider: ${providerKey}`);
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
        if (data.error === "authorization_pending") {
          return { status: "pending" };
        }
        if (data.error === "slow_down") {
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
        // Fetch user profile and copilot internal token
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

    return { status: "error", error: "No token returned." };
  } catch (err: any) {
    return { status: "error", error: err.message || "Failed to poll token" };
  }
}
