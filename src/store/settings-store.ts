import { create } from "zustand";
import type { AppSettings } from "@/types";
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
};

interface State {
  settings: AppSettings;
  hydrated: boolean;
}
interface Actions {
  hydrate: () => Promise<void>;
  update: (patch: Partial<AppSettings>) => void;
  reset: () => void;
}

export const useSettingsStore = create<State & Actions>((set, get) => ({
  settings: defaults,
  hydrated: false,
  hydrate: async () => {
    const s = await storage.get<AppSettings>(KEY, defaults);
    set({ settings: { ...defaults, ...s }, hydrated: true });
    applyTheme(s.theme);
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
