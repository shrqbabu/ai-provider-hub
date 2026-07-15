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
