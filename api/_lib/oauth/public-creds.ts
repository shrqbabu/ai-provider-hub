const MASK = "omniroute-public-v1";

export function unmaskCred(bytes: readonly number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i] ^ MASK.charCodeAt(i % MASK.length));
  }
  return out;
}

export const EMBEDDED_PUBLIC_CREDS = {
  antigravity_id: [
    94, 93, 89, 88, 66, 95, 67, 68, 83, 29, 69, 76, 83, 65, 29, 14, 69, 5, 66, 6, 3, 92, 1, 64, 94,
    25, 23, 23, 72, 66, 70, 87, 26, 29, 12, 65, 25, 91, 7, 89, 9, 93, 66, 92, 16, 4, 75, 76, 0, 5,
    17, 66, 14, 12, 66, 17, 93, 10, 24, 29, 12, 0, 12, 26, 26, 17, 72, 30, 1, 76, 15, 6, 14,
  ],
  antigravity_alt: [
    40, 34, 45, 58, 34, 55, 88, 63, 80, 21, 54, 34, 48, 88, 81, 85, 97, 18, 125, 37, 92, 3, 37, 48,
    87, 6, 44, 38, 25, 10, 67, 19, 40, 40, 5,
  ],
  claude_id: [
    86, 9, 95, 10, 64, 90, 69, 21, 72, 72, 70, 68, 0, 65, 93, 87, 73, 79, 28, 87, 85, 11, 13, 95,
    90, 76, 64, 81, 73, 65, 76, 84, 94, 15, 86, 72,
  ],
  codex_id: [
    14, 29, 30, 54, 55, 34, 26, 21, 8, 104, 53, 47, 85, 95, 15, 83, 110, 29, 105, 14, 53, 30, 94,
    26, 29, 20, 26, 11,
  ],
  kimi_id: [
    94, 90, 11, 92, 20, 89, 66, 69, 72, 73, 65, 76, 86, 65, 93, 7, 75, 20, 28, 86, 90, 94, 95, 95,
    90, 64, 69, 83, 78, 18, 65, 90, 15, 89, 90, 21,
  ],
  github_copilot_id: [38, 27, 95, 71, 16, 90, 69, 67, 4, 29, 72, 22, 90, 91, 12, 0, 75, 19, 8, 87],
  grok_id: [
    13, 92, 15, 89, 66, 91, 76, 70, 72, 29, 71, 70, 3, 65, 93, 84, 72, 23, 28, 87, 92, 88, 15, 95,
    91, 22, 71, 87, 20, 66, 67, 86, 13, 81, 81, 21,
  ],
} as const;

export function getPublicCred(key: keyof typeof EMBEDDED_PUBLIC_CREDS, envName?: string): string {
  if (envName && process.env[envName]) {
    return process.env[envName]!;
  }
  return unmaskCred(EMBEDDED_PUBLIC_CREDS[key]);
}
