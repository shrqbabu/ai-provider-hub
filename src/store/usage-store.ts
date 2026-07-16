import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type { UsageEntry } from "@/types";
import { storage } from "@/services/storage";

const KEY = "usage";

interface State {
  usage: UsageEntry[];
  hydrated: boolean;
}
interface Actions {
  hydrate: () => Promise<void>;
  record: (e: Omit<UsageEntry, "id" | "createdAt">) => void;
  clear: () => void;
}

async function persist(list: UsageEntry[]) {
  await storage.set(KEY, list);
}

export const useUsageStore = create<State & Actions>((set, get) => ({
  usage: [],
  hydrated: false,
  hydrate: async () => {
    const list = await storage.get<UsageEntry[]>(KEY, []);
    set({ usage: list, hydrated: true });
  },
  record: (e) => {
    const entry: UsageEntry = { id: uuid(), createdAt: Date.now(), ...e };
    const list = [entry, ...get().usage].slice(0, 5000);
    set({ usage: list });
    void persist(list);
  },
  clear: () => {
    set({ usage: [] });
    void persist([]);
  },
}));
