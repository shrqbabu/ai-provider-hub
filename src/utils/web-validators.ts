import {
  buildGrokCookieHeader,
  buildQwenCookieHeader,
  extractCookieValue,
  extractKimiAccessToken,
  extractQwenToken,
  normalizeSessionCookieHeader,
} from "./cookie-utils";

export interface ValidationResult {
  valid: boolean;
  error: string | null;
  statusCode?: number;
  data?: any;
}

/**
 * Validate Kimi Web session using www.kimi.com/api/user probe
 */
export async function validateKimiWebProvider({ apiKey }: { apiKey: string }): Promise<ValidationResult> {
  const rawCred = String(apiKey ?? "").trim();
  if (!rawCred) {
    return {
      valid: false,
      error: "Missing Kimi access_token from www.kimi.com localStorage",
    };
  }

  const accessToken = extractKimiAccessToken(rawCred);
  if (!accessToken) {
    return {
      valid: false,
      error: "Could not find a Kimi access_token. Re-login at https://www.kimi.com and copy it from localStorage.",
    };
  }

  try {
    const resp = await fetch("https://www.kimi.com/api/user", {
      headers: {
        Accept: "application/json, text/plain, */*",
        Authorization: `Bearer ${accessToken}`,
        Origin: "https://www.kimi.com",
        Referer: "https://www.kimi.com/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      },
    });

    if (resp.status === 401 || resp.status === 403) {
      return {
        valid: false,
        error: "Kimi session is invalid or expired — re-login at https://www.kimi.com and paste a fresh access_token",
      };
    }
    if (!resp.ok) {
      return { valid: false, error: `Kimi returned HTTP ${resp.status}` };
    }

    try {
      const data = await resp.json();
      if (!data?.id) {
        return {
          valid: false,
          error: "Kimi session token is invalid or expired — re-login at https://www.kimi.com and paste a fresh access_token",
        };
      }
      return { valid: true, error: null, data };
    } catch {
      return { valid: false, error: "Kimi returned invalid JSON response" };
    }
  } catch (error: any) {
    return { valid: false, error: error.message || "Failed to connect to Kimi" };
  }
}

/**
 * Validate DeepSeek Web session using chat.deepseek.com/api/v0/users/current probe
 */
export async function validateDeepSeekWebProvider({ apiKey }: { apiKey: string }): Promise<ValidationResult> {
  if (!apiKey) {
    return {
      valid: false,
      error: "Missing userToken — paste the value from DevTools → Application → Local Storage → chat.deepseek.com → userToken",
    };
  }
  let token = apiKey;
  try {
    const parsed = JSON.parse(token);
    if (typeof parsed?.value === "string") token = parsed.value;
  } catch {
    // not JSON, use as-is
  }

  try {
    const resp = await fetch("https://chat.deepseek.com/api/v0/users/current", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "*/*",
        Origin: "https://chat.deepseek.com",
        Referer: "https://chat.deepseek.com/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        "X-Client-Bundle-Id": "com.deepseek.chat",
        "X-Client-Platform": "web",
        "X-Client-Version": "2.0.0",
      },
    });
    if (resp.status === 401 || resp.status === 403) {
      return {
        valid: false,
        error: "userToken is invalid or expired — get a fresh one from localStorage",
        statusCode: resp.status,
      };
    }
    if (!resp.ok) {
      return { valid: false, error: `DeepSeek returned HTTP ${resp.status}` };
    }
    const json = await resp.json();
    const bizData = json?.data?.biz_data || json?.biz_data;

    if (Number(json?.code) === 40003) {
      return {
        valid: false,
        error: "userToken is invalid or expired — get a fresh one from localStorage",
        statusCode: 401,
      };
    }

    if (!bizData?.token) {
      return {
        valid: false,
        error: `DeepSeek did not return an access token: ${json?.msg || "unknown error"}`,
      };
    }
    return { valid: true, error: null, data: json };
  } catch (error: any) {
    return { valid: false, error: error.message || "Failed to connect to DeepSeek" };
  }
}

/**
 * Validate Qwen Web session using chat.qwen.ai/api/v1/auths/ probe
 */
export async function validateQwenWebProvider({ apiKey }: { apiKey: string }): Promise<ValidationResult> {
  const rawCred = String(apiKey ?? "").trim();
  if (!rawCred) {
    return {
      valid: false,
      error: "Missing Qwen session — paste the full chat.qwen.ai Cookie header (must include token, cna and ssxmod_itna)",
    };
  }

  const token = extractQwenToken(rawCred);
  const cookieHeader = buildQwenCookieHeader(rawCred);
  if (!token && !cookieHeader) {
    return {
      valid: false,
      error: "Could not find a Qwen token/cookie in the pasted value",
    };
  }

  try {
    const headers: Record<string, string> = {
      Accept: "*/*",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      Origin: "https://chat.qwen.ai",
      Referer: "https://chat.qwen.ai/",
      source: "web",
      "bx-v": "2.5.36",
      version: "0.2.66",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (cookieHeader) headers["Cookie"] = cookieHeader;

    const resp = await fetch("https://chat.qwen.ai/api/v1/auths/", { headers });
    const contentType = resp.headers.get("content-type") || "";

    if (resp.status === 401 || resp.status === 403) {
      return {
        valid: false,
        error: "Qwen session is invalid or expired — re-login at https://chat.qwen.ai and paste a fresh full Cookie header",
      };
    }
    if (contentType.includes("text/html") || resp.status === 504) {
      return {
        valid: false,
        error: "Qwen blocked the request with its anti-bot WAF. Re-login at https://chat.qwen.ai and paste a fresh full Cookie header.",
      };
    }
    if (!resp.ok) {
      return { valid: false, error: `Qwen returned HTTP ${resp.status}` };
    }

    try {
      const data = await resp.json();
      const hasTopLevelUser =
        typeof data?.id === "string" && data.id.length >= 8 && typeof data?.email === "string";
      const hasNestedUser =
        (typeof data?.user?.id === "string" && data.user.id.length > 0) ||
        (typeof data?.data?.user?.id === "string" && data.data.user.id.length > 0);
      if (!hasTopLevelUser && !hasNestedUser) {
        return {
          valid: false,
          error: "Qwen session token is invalid or expired — re-login at https://chat.qwen.ai and paste a fresh full Cookie header",
        };
      }
      return { valid: true, error: null, data };
    } catch {
      return {
        valid: false,
        error: "Qwen returned invalid JSON response",
      };
    }
  } catch (error: any) {
    return { valid: false, error: error.message || "Failed to connect to Qwen" };
  }
}

/**
 * Validate Blackbox Web session using app.blackbox.ai/api/auth/session probe
 */
export async function validateBlackboxWebProvider({ apiKey }: { apiKey: string }): Promise<ValidationResult> {
  try {
    const cookieHeader = normalizeSessionCookieHeader(apiKey, "__Secure-authjs.session-token");
    const sessionHeaders = {
      Accept: "application/json",
      Cookie: cookieHeader,
      Origin: "https://app.blackbox.ai",
      Referer: "https://app.blackbox.ai/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    };

    const sessionResponse = await fetch("https://app.blackbox.ai/api/auth/session", {
      method: "GET",
      headers: sessionHeaders,
    });

    const sessionText = await sessionResponse.text();
    let sessionPayload: any = null;
    try {
      sessionPayload = sessionText ? JSON.parse(sessionText) : null;
    } catch {}

    const userEmail = sessionPayload?.user?.email;

    if (!sessionResponse.ok || !userEmail) {
      return {
        valid: false,
        error: "Invalid Blackbox session cookie — re-paste __Secure-authjs.session-token from app.blackbox.ai",
      };
    }

    return { valid: true, error: null, data: sessionPayload };
  } catch (error: any) {
    return { valid: false, error: error.message || "Failed to connect to Blackbox" };
  }
}
