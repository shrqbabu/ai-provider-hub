import type { ChatMessage, CompressMode } from "@/types";
import { estimateTokens } from "@/utils";

export interface CompressResult {
  text: string;
  before: number;
  after: number;
  saved: number;
  mode: CompressMode;
}

export interface ConversationCompressResult {
  messages: ChatMessage[];
  before: number;
  after: number;
  saved: number;
  applied: boolean;
  compressedTurns: number;
}

const FILLER_PHRASES: RegExp[] = [
  /\bplease\s+kindly\b/gi,
  /\bkindly\s+please\b/gi,
  /\bI would like you to\b/gi,
  /\bI want you to\b/gi,
  /\bcan you please\b/gi,
  /\bcould you please\b/gi,
  /\bwould you please\b/gi,
  /\bmake sure to\b/gi,
  /\bbe sure to\b/gi,
  /\bdon't forget to\b/gi,
  /\bas you (?:can|may) (?:see|know)\b/gi,
  /\bit is important to note that\b/gi,
  /\bit should be noted that\b/gi,
  /\bin order to\b/gi,
  /\bdue to the fact that\b/gi,
  /\bat this point in time\b/gi,
  /\bfor the purpose of\b/gi,
];

const FILLER_WORDS: RegExp[] = [
  /\b(?:basically|actually|literally|honestly|obviously|clearly|simply|really|quite|just)\b/gi,
];

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?।])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function collapseWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function stripComments(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\n)\s*\/\/(?!\/).*$/gm, "$1");
}

function applyFillers(text: string): string {
  let out = text;
  for (const re of FILLER_PHRASES) out = out.replace(re, "");
  for (const re of FILLER_WORDS) out = out.replace(re, "");
  return collapseWhitespace(out);
}

function keepEnds(text: string, headRatio: number, tailRatio: number, marker = "[…]"): string {
  if (text.length < 240) return text;
  const head = Math.max(80, Math.floor(text.length * headRatio));
  const tail = Math.max(40, Math.floor(text.length * tailRatio));
  if (head + tail >= text.length) return text;
  return `${text.slice(0, head).trim()}\n${marker}\n${text.slice(-tail).trim()}`;
}

/** Compress a single prompt / system string. Never invents meaning — extractive only. */
export function compressPrompt(text: string, mode: CompressMode = "smart"): CompressResult {
  const before = estimateTokens(text || "");
  if (!text || mode === "off") {
    return { text: text || "", before, after: before, saved: 0, mode };
  }

  let out = collapseWhitespace(text);

  if (mode === "light") {
    const after = estimateTokens(out);
    return { text: out, before, after, saved: Math.max(0, before - after), mode };
  }

  out = stripComments(out);
  out = applyFillers(out);

  if (mode === "aggressive") {
    const sentences = splitSentences(out);
    if (sentences.length > 8) {
      out = [...sentences.slice(0, 3), "[…]", ...sentences.slice(-2)].join(" ");
    } else if (out.length > 1600) {
      out = keepEnds(out, 0.35, 0.18);
    }
  } else if (out.length > 2400) {
    out = keepEnds(out, 0.45, 0.2);
  }

  out = collapseWhitespace(out);
  const after = estimateTokens(out);
  return { text: out, before, after, saved: Math.max(0, before - after), mode };
}

function compressTurn(content: string, mode: CompressMode): string {
  if (!content) return content;
  if (mode === "off") return content;

  if (mode === "light") {
    const cleaned = collapseWhitespace(content);
    return cleaned.length > 900 ? keepEnds(cleaned, 0.4, 0.22, "[…compressed…]") : cleaned;
  }

  const cleaned = compressPrompt(content, mode === "aggressive" ? "smart" : "smart").text;
  if (mode === "smart") {
    if (cleaned.length <= 700) return cleaned;
    const sentences = splitSentences(cleaned);
    if (sentences.length > 4) {
      return collapseWhitespace(
        `${sentences.slice(0, 2).join(" ")} […] ${sentences.slice(-1).join(" ")}`
      );
    }
    return keepEnds(cleaned, 0.35, 0.2, "[…]");
  }

  const sentences = splitSentences(cleaned);
  const first = sentences[0] || cleaned;
  return first.length > 220 ? first.slice(0, 220).trim() + "…" : first;
}

export function conversationTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => {
    let n = estimateTokens(m.content || "");
    if (m.attachments?.length) {
      n += m.attachments.length * 80;
    }
    return sum;
  }, 0);
}

/**
 * Shrink older turns so the request fits inside `budgetTokens`.
 * The last `keepLast` messages (and every system message) stay intact.
 */
export function compressConversation(
  messages: ChatMessage[],
  budgetTokens: number,
  mode: CompressMode,
  keepLast = 6
): ConversationCompressResult {
  const before = conversationTokens(messages);
  if (mode === "off" || messages.length === 0 || before <= budgetTokens) {
    return {
      messages,
      before,
      after: before,
      saved: 0,
      applied: false,
      compressedTurns: 0,
    };
  }

  const keep = Math.max(2, keepLast);
  const out = messages.map((m) => ({ ...m }));
  let compressedTurns = 0;

  const mutable = out
    .map((m, i) => ({ m, i }))
    .filter(({ m, i }) => m.role !== "system" && i < out.length - keep);

  for (const { m, i } of mutable) {
    if (conversationTokens(out) <= budgetTokens) break;
    const next = compressTurn(m.content, mode);
    if (next !== m.content) {
      out[i] = { ...m, content: next };
      compressedTurns++;
    }
  }

  // Still over budget → drop oldest non-system turns down to `keep`.
  while (conversationTokens(out) > budgetTokens && out.length > keep) {
    const idx = out.findIndex((m, i) => m.role !== "system" && i < out.length - keep);
    if (idx < 0) break;
    const dropped = out[idx];
    out[idx] = {
      ...dropped,
      content: `[Earlier ${dropped.role} turn omitted to fit the token budget.]`,
      attachments: undefined,
    };
    compressedTurns++;
    if (conversationTokens(out) > budgetTokens) {
      out.splice(idx, 1);
    }
  }

  const after = conversationTokens(out);
  return {
    messages: out,
    before,
    after,
    saved: Math.max(0, before - after),
    applied: after < before,
    compressedTurns,
  };
}

export const COMPRESS_MODES: Array<{
  id: CompressMode;
  label: string;
  hint: string;
}> = [
  { id: "off", label: "Off", hint: "Send prompts and history as-is." },
  { id: "light", label: "Light", hint: "Collapse whitespace only. Safest." },
  { id: "smart", label: "Smart", hint: "Drop filler, comments, and long middles." },
  { id: "aggressive", label: "Max", hint: "Keep only the signal. Biggest savings." },
];
