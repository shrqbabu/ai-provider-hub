import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type { ComboLogEntry } from "@/types";
import { storage } from "@/services/storage";
import { getEffectiveUid } from "@/store/auth-store";

const KEY = "combo_logs";
const LOCAL_STORAGE_PREFIX = "aip_cached_combo_logs:";

function localLogsKey(): string {
  return LOCAL_STORAGE_PREFIX + getEffectiveUid();
}

function getInitialLogs(): ComboLogEntry[] {
  try {
    const raw = localStorage.getItem(localLogsKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

interface State {
  logs: ComboLogEntry[];
  hydrated: boolean;
}

interface Actions {
  hydrate: () => Promise<void>;
  record: (entry: Omit<ComboLogEntry, "id" | "createdAt">) => void;
  clear: () => void;
}

async function persist(list: ComboLogEntry[]) {
  try {
    localStorage.setItem(localLogsKey(), JSON.stringify(list.slice(0, 1000)));
  } catch {
    // ignore quota error
  }
  await storage.set(KEY, list).catch((e) => {
    console.error("[combo-log-store] persist failed:", e);
  });
}

export const useComboLogStore = create<State & Actions>((set, get) => ({
  logs: getInitialLogs(),
  hydrated: false,
  hydrate: async () => {
    try {
      const list = await storage.get<ComboLogEntry[]>(KEY, []);
      if (!Array.isArray(list)) return;

      const current = get().logs;
      // If server returned empty but we have local logs, persist local logs to server
      if (list.length === 0 && current.length > 0) {
        void persist(current);
        return;
      }

      // Check if there are actual new logs or changes
      if (
        current.length === list.length &&
        current[0]?.id === list[0]?.id &&
        current[current.length - 1]?.id === list[list.length - 1]?.id
      ) {
        // Zero changes — do NOT trigger unnecessary re-render or flash!
        if (!get().hydrated) set({ hydrated: true });
        return;
      }

      // Merge gracefully by ID without losing anything
      const map = new Map<string, ComboLogEntry>();
      for (const item of list) map.set(item.id, item);
      for (const item of current) {
        if (!map.has(item.id)) map.set(item.id, item);
      }

      const merged = Array.from(map.values())
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 5000);

      try {
        localStorage.setItem(localLogsKey(), JSON.stringify(merged.slice(0, 1000)));
      } catch {
        // ignore
      }

      set({ logs: merged, hydrated: true });
    } catch {
      // On network failure, never clear existing logs!
      set({ hydrated: true });
    }
  },
  record: (entry) => {
    const item: ComboLogEntry = { id: uuid(), createdAt: Date.now(), ...entry };
    const list = [item, ...get().logs].slice(0, 5000);
    set({ logs: list });
    void persist(list);
  },
  clear: () => {
    set({ logs: [] });
    try {
      localStorage.removeItem(localLogsKey());
    } catch {
      // ignore
    }
    void persist([]);
  },
}));
