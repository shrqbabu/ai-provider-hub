export function stripCookieInputPrefix(rawValue: string): string {
  const trimmed = (rawValue || "").trim();
  if (!trimmed) return "";

  const withoutBearer = trimmed.replace(/^bearer\s+/i, "");
  return withoutBearer.replace(/^cookie:\s*/i, "").trim();
}

/**
 * Parse a JSON array of cookie objects and produce a Cookie header string.
 *
 * Accepts the format exported by browser cookie-editor extensions / DevTools:
 * ```json
 * [
 *   {"name":"sso","value":"eyJ0eXAi...","domain":".example.com","path":"/"},
 *   {"name":"sso-rw","value":"eyJOTHER..."}
 * ]
 * ```
 */
export function parseJsonCookiesToHeader(rawValue: string): string | null {
  const trimmed = (rawValue || "").trim();
  if (!trimmed || !trimmed.startsWith("[")) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;
  if (parsed.length === 0) return "";

  const parts: string[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Invalid cookie JSON at index ${i}: expected an object`);
    }
    const record = entry as Record<string, unknown>;

    if (typeof record.name !== "string" || !record.name) {
      throw new Error(`Invalid cookie JSON at index ${i}: missing required field 'name'`);
    }
    if (typeof record.value !== "string") {
      throw new Error(`Invalid cookie JSON at index ${i}: missing required field 'value'`);
    }

    parts.push(`${record.name}=${record.value}`);
  }

  return parts.join("; ");
}

export function normalizeSessionCookieHeader(rawValue: string, defaultCookieName: string = "session"): string {
  const stripped = stripCookieInputPrefix(rawValue);
  if (!stripped) return "";

  const jsonResult = parseJsonCookiesToHeader(stripped);
  if (jsonResult !== null) {
    return jsonResult;
  }

  if (stripped.includes("=")) {
    return stripped;
  }

  return `${defaultCookieName}=${stripped}`;
}

/**
 * Extract a single cookie's value from whatever the user pasted.
 */
export function extractCookieValue(rawValue: string, cookieName: string): string {
  const trimmed = stripCookieInputPrefix(rawValue);
  if (!trimmed) return "";

  if (trimmed.includes(";")) {
    const escaped = cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = trimmed.match(new RegExp("(?:^|;\\s*)" + escaped + "=([^;\\s]+)"));
    return match ? match[1] : "";
  }

  const prefix = `${cookieName}=`;
  if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);

  return trimmed;
}

/**
 * Build the `Cookie` header value for grok.com from whatever the user pasted.
 */
export function buildGrokCookieHeader(rawValue: string): string {
  const sso = extractCookieValue(rawValue, "sso");
  if (!sso) return "";

  const parts = [`sso=${sso}`];
  for (const name of ["sso-rw", "cf_clearance", "__cf_bm"]) {
    if (new RegExp("(?:^|;\\s*)" + name + "=").test(rawValue)) {
      const value = extractCookieValue(rawValue, name);
      if (value) parts.push(`${name}=${value}`);
    }
  }
  return parts.join("; ");
}

/**
 * Build the `Cookie` header value for chat.qwen.ai (Qwen Web / Tongyi).
 */
export function buildQwenCookieHeader(rawValue: string): string {
  const trimmed = stripCookieInputPrefix(rawValue);
  if (!trimmed || !trimmed.includes("=")) return "";
  return trimmed;
}

/**
 * Extract the Qwen bearer token from whatever the user pasted/captured.
 */
export function extractQwenToken(rawValue: string): string {
  const trimmed = stripCookieInputPrefix(rawValue);
  if (!trimmed) return "";
  if (!trimmed.includes("=")) return trimmed;
  const match = trimmed.match(/(?:^|;\s*)token=([^;\s]+)/);
  return match ? match[1] : "";
}

/**
 * Extract Kimi Web's current localStorage access token, with legacy cookie compatibility.
 */
export function extractKimiAccessToken(rawValue: string): string {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return "";

  const bearer = raw.match(/^(?:authorization:\s*)?bearer\s+([^;\s]+)/i);
  if (bearer) return bearer[1];

  const trimmed = stripCookieInputPrefix(raw);
  for (const key of ["access_token", "kimi-auth"]) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = trimmed.match(new RegExp(`(?:^|[\\s;])${escaped}=([^;\\s]+)`));
    if (match) return match[1];
  }

  return !trimmed.includes("=") && !trimmed.includes(";") ? trimmed : "";
}

export function extractKimiJwt(rawValue: string): string {
  return extractKimiAccessToken(rawValue);
}

export function normalizeSessionCookieHeaders(
  rawValues: Array<string | null | undefined>,
  defaultCookieName: string = "session"
): string[] {
  const seen = new Set<string>();
  const normalizedHeaders: string[] = [];

  for (const rawValue of rawValues) {
    if (typeof rawValue !== "string") continue;
    const normalized = normalizeSessionCookieHeader(rawValue, defaultCookieName);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    normalizedHeaders.push(normalized);
  }

  return normalizedHeaders;
}
