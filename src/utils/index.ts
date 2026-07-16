import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function formatNumber(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

export function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncate(s: string, n = 60) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// Lightweight XOR obfuscation for API keys (frontend-only; not real crypto).
// Real encryption in-browser needs a user-provided passphrase, which we intentionally
// skip to keep UX zero-friction. Keys never leave the device.
const K = "ai-provider-hub-obfuscation-key";
export function obfuscate(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    out += String.fromCharCode(text.charCodeAt(i) ^ K.charCodeAt(i % K.length));
  }
  return btoa(unescape(encodeURIComponent(out)));
}
export function deobfuscate(text: string): string {
  try {
    const decoded = decodeURIComponent(escape(atob(text)));
    let out = "";
    for (let i = 0; i < decoded.length; i++) {
      out += String.fromCharCode(
        decoded.charCodeAt(i) ^ K.charCodeAt(i % K.length)
      );
    }
    return out;
  } catch {
    return "";
  }
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Text/code files are inlined into the message body, so they work with EVERY
// provider — no vision/PDF capability needed. Extension check comes first
// because browsers report weird MIME types for code files (.ts → video/mp2t).
const TEXT_EXTENSIONS =
  /\.(txt|md|markdown|json|jsonc|csv|tsv|xml|yaml|yml|html|htm|css|scss|less|js|jsx|ts|tsx|mjs|cjs|py|java|c|cpp|h|hpp|cs|go|rs|rb|php|sh|bash|zsh|bat|ps1|sql|toml|ini|cfg|conf|log|env|vue|svelte|kt|kts|swift|dart|r|lua|pl|gradle|properties|lock)$/i;

export function isTextLike(name: string, mime: string): boolean {
  if (TEXT_EXTENSIONS.test(name)) return true;
  const base = name.split("/").pop() ?? "";
  if (/^(dockerfile|makefile|license|readme|\.gitignore|\.env.*)$/i.test(base)) {
    return true;
  }
  if (mime.startsWith("text/")) return true;
  return [
    "application/json",
    "application/xml",
    "application/javascript",
    "application/x-yaml",
    "application/x-sh",
  ].includes(mime);
}

export function dataUrlToText(dataUrl: string): string {
  const base64 = dataUrl.split(",")[1] ?? "";
  try {
    const bin = atob(base64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}
