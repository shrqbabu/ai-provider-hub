import { create } from "zustand";
import type { AppSettings, CompressStats } from "@/types";
import { storage } from "@/services/storage";

const KEY = "settings";

const defaults: AppSettings = {
  theme: "dark",
  accent: "amber",
  sidebarWidth: 280,
  animations: true,
  streamingSpeed: 1,
  autoScroll: true,
  maxTokens: 0, // 0 = auto
  defaultModelId: "",
  tokenCompress: true,
  promptCompress: true,
  tokenCompressMode: "smart",
  promptCompressMode: "smart",
  tokenCompressThreshold: 0.75,
  keepLastMessages: 6,
  contextReserveTokens: 4096,
  defaultContextPromptId: "",
  contextPromptsSeeded: false,
  compressStats: { tokensSaved: 0, runs: 0 },
};

interface State {
  settings: AppSettings;
  hydrated: boolean;
}
interface Actions {
  hydrate: () => Promise<void>;
  update: (patch: Partial<AppSettings>) => void;
  reset: () => void;
  recordCompress: (saved: number) => void;
}

export const useSettingsStore = create<State & Actions>((set, get) => ({
  settings: defaults,
  hydrated: false,
  hydrate: async () => {
    const s = await storage.get<AppSettings>(KEY, defaults);
    const merged: AppSettings = {
      ...defaults,
      ...s,
      compressStats: {
        tokensSaved: s.compressStats?.tokensSaved ?? defaults.compressStats!.tokensSaved,
        runs: s.compressStats?.runs ?? defaults.compressStats!.runs,
        lastAt: s.compressStats?.lastAt,
      },
    };
    set({ settings: merged, hydrated: true });
    applyTheme(merged.theme);
  },
  update: (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    void storage.set(KEY, next);
    if (patch.theme) applyTheme(patch.theme);
  },
  reset: () => {
    set({ settings: defaults });
    void storage.set(KEY, defaults);
    applyTheme(defaults.theme);
  },
  recordCompress: (saved) => {
    if (saved <= 0) return;
    const s = get().settings;
    const stats: CompressStats = {
      tokensSaved: (s.compressStats?.tokensSaved ?? 0) + saved,
      runs: (s.compressStats?.runs ?? 0) + 1,
      lastAt: Date.now(),
    };
    const next = { ...s, compressStats: stats };
    set({ settings: next });
    void storage.set(KEY, next);
  },
}));

function applyTheme(theme: AppSettings["theme"]) {
  const root = document.documentElement;
  const mode =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  root.classList.toggle("dark", mode === "dark");
}
