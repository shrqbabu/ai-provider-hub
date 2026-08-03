import { create } from "zustand";
import { v4 as uuid } from "uuid";
import { storage } from "@/services/storage";

const KEY = "keystore";

export interface KeyStoreItem {
  id: string;
  label: string;
  keyValue: string;
  createdAt: number;
}

interface State {
  items: KeyStoreItem[];
  hydrated: boolean;
}

interface Actions {
  hydrate: () => Promise<void>;
  add: (label: string, keyValue: string) => KeyStoreItem;
  remove: (id: string) => void;
}

async function persist(list: KeyStoreItem[]) {
  await storage.set(KEY, list);
}

export const useKeyStoreStore = create<State & Actions>((set, get) => ({
  items: [],
  hydrated: false,
  hydrate: async () => {
    const list = await storage.get<KeyStoreItem[]>(KEY, []);
    set({ items: list, hydrated: true });
  },
  add: (label, keyValue) => {
    const item: KeyStoreItem = {
      id: uuid(),
      label: label.trim() || "API Key",
      keyValue: keyValue.trim(),
      createdAt: Date.now(),
    };
    const list = [...get().items, item];
    set({ items: list });
    void persist(list);
    return item;
  },
  remove: (id) => {
    const list = get().items.filter((item) => item.id !== id);
    set({ items: list });
    void persist(list);
  },
}));
