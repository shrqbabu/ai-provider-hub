import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type { Combo } from "@/types";
import { storage } from "@/services/storage";

const KEY = "combos";

interface State {
  combos: Combo[];
  hydrated: boolean;
}

interface Actions {
  hydrate: () => Promise<void>;
  add: (c: Omit<Combo, "id" | "createdAt" | "updatedAt">) => Combo;
  update: (
    id: string,
    patch: Partial<Omit<Combo, "id" | "createdAt">>
  ) => void;
  remove: (id: string) => void;
}

async function persist(list: Combo[]) {
  await storage.set(KEY, list);
}

export const useComboStore = create<State & Actions>((set, get) => ({
  combos: [],
  hydrated: false,
  hydrate: async () => {
    const list = await storage.get<Combo[]>(KEY, []);
    set({ combos: list, hydrated: true });
  },
  add: (c) => {
    const now = Date.now();
    const combo: Combo = { id: uuid(), createdAt: now, updatedAt: now, ...c };
    const list = [...get().combos, combo];
    set({ combos: list });
    void persist(list);
    return combo;
  },
  update: (id, patch) => {
    const list = get().combos.map((c) =>
      c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c
    );
    set({ combos: list });
    void persist(list);
  },
  remove: (id) => {
    const list = get().combos.filter((c) => c.id !== id);
    set({ combos: list });
    void persist(list);
  },
}));
