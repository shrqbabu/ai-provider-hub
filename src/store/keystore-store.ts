import { create } from "zustand";
import { v4 as uuid } from "uuid";
import { storage } from "@/services/storage";

const KEY = "keystore";
const LOCAL_BACKUP_KEY = "ai_hub_keystore_backup";

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
  try {
    localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
  await storage.set(KEY, list);
}

export const useKeyStoreStore = create<State & Actions>((set, get) => ({
  items: [],
  hydrated: false,
  hydrate: async () => {
    try {
      // 1. Try remote Firestore "keystore"
      let list = await storage.get<KeyStoreItem[]>(KEY, []);

      // 2. If empty, check alternate legacy keys
      if (!list || !list.length) {
        const alt = await storage.get<KeyStoreItem[]>("key_store", []);
        if (alt && alt.length) list = alt;
      }
      if (!list || !list.length) {
        const alt2 = await storage.get<KeyStoreItem[]>("api_keys", []);
        if (alt2 && alt2.length) list = alt2;
      }

      // 3. If still empty, check local backup
      if (!list || !list.length) {
        try {
          const raw = localStorage.getItem(LOCAL_BACKUP_KEY);
          if (raw) list = JSON.parse(raw);
        } catch {
          // ignore
        }
      }

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
