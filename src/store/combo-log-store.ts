import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type { ComboLogEntry } from "@/types";
import { storage } from "@/services/storage";

const KEY = "combo_logs";

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
  await storage.set(KEY, list);
}

export const useComboLogStore = create<State & Actions>((set, get) => ({
  logs: [],
  hydrated: false,
  hydrate: async () => {
    const list = await storage.get<ComboLogEntry[]>(KEY, []);
    set({ logs: list, hydrated: true });
  },
  record: (entry) => {
    const item: ComboLogEntry = { id: uuid(), createdAt: Date.now(), ...entry };
    const list = [item, ...get().logs].slice(0, 5000);
    set({ logs: list });
    void persist(list);
  },
  clear: () => {
    set({ logs: [] });
    void persist([]);
  },
}));
