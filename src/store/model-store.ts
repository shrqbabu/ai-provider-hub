import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type { DiscoveredModel } from "@/types";
import { storage } from "@/services/storage";

const KEY = "models";

interface State {
  models: DiscoveredModel[];
  hydrated: boolean;
}

interface Actions {
  hydrate: () => Promise<void>;
  upsertMany: (list: Array<Omit<DiscoveredModel, "id"> & { id?: string }>) => void;
  add: (m: Omit<DiscoveredModel, "id">) => DiscoveredModel;
  update: (id: string, patch: Partial<DiscoveredModel>) => void;
  remove: (id: string) => void;
  removeByProvider: (providerId: string) => void;
  toggleFavorite: (id: string) => void;
  toggleSaved: (id: string) => void;
  byProvider: (providerId: string) => DiscoveredModel[];
}

async function persist(list: DiscoveredModel[]) {
  await storage.set(KEY, list);
}

export const useModelStore = create<State & Actions>((set, get) => ({
  models: [],
  hydrated: false,
  hydrate: async () => {
    const list = await storage.get<DiscoveredModel[]>(KEY, []);
    set({ models: list, hydrated: true });
  },
  upsertMany: (incoming) => {
    const existing = get().models;
    const map = new Map(existing.map((m) => [`${m.providerId}::${m.modelId}`, m]));
    for (const m of incoming) {
      const key = `${m.providerId}::${m.modelId}`;
      const prev = map.get(key);
      if (prev) {
        map.set(key, { ...prev, ...m, id: prev.id });
      } else {
        map.set(key, { ...m, id: m.id ?? uuid() });
      }
    }
    const list = Array.from(map.values());
    set({ models: list });
    void persist(list);
  },
  add: (m) => {
    const model: DiscoveredModel = { id: uuid(), ...m };
    const list = [...get().models, model];
    set({ models: list });
    void persist(list);
    return model;
  },
  update: (id, patch) => {
    const list = get().models.map((m) => (m.id === id ? { ...m, ...patch } : m));
    set({ models: list });
    void persist(list);
  },
  remove: (id) => {
    const list = get().models.filter((m) => m.id !== id);
    set({ models: list });
    void persist(list);
  },
  removeByProvider: (providerId) => {
    const list = get().models.filter((m) => m.providerId !== providerId);
    set({ models: list });
    void persist(list);
  },
  toggleFavorite: (id) => {
    const m = get().models.find((x) => x.id === id);
    if (m) get().update(id, { favorite: !m.favorite });
  },
  toggleSaved: (id) => {
    const m = get().models.find((x) => x.id === id);
    if (m) get().update(id, { saved: !m.saved });
  },
  byProvider: (providerId) =>
    get().models.filter((m) => m.providerId === providerId),
}));
