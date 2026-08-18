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
  add: (label: string, keyValue: string) => Promise<KeyStoreItem>;
  update: (id: string, patch: Partial<KeyStoreItem>) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

async function persist(list: KeyStoreItem[]) {
  // storage.set persists to uid-scoped localStorage AND the remote KV store,
  // so data is always scoped to the signed-in user on this browser.
  await storage.set(KEY, list).catch((e) => {
    console.error("[keystore-store] persist failed:", e);
  });
}

export const useKeyStoreStore = create<State & Actions>((set, get) => ({
  items: [],
  hydrated: false,
  hydrate: async () => {
    try {
      // Try the user's own remote/local "keystore" only. Alternate legacy keys
      // (key_store / api_keys) are intentionally NOT read here — they were a
      // past source of cross-user data leaking in.
      let list = await storage.get<KeyStoreItem[]>(KEY, []);
      set({ items: list || [], hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
  add: async (label, keyValue) => {
    const item: KeyStoreItem = {
      id: uuid(),
      label: label.trim() || "API Key",
      keyValue: keyValue.trim(),
      createdAt: Date.now(),
    };
    const list = [...get().items, item];
    set({ items: list });
    await persist(list);
    return item;
  },
  update: async (id, patch) => {
    const list = get().items.map((item) =>
      item.id === id ? { ...item, ...patch } : item
    );
    set({ items: list });
    await persist(list);
  },
  remove: async (id) => {
    const list = get().items.filter((item) => item.id !== id);
    set({ items: list });
    await persist(list);
  },
}));
