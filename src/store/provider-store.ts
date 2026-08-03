import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type { ConnectedProvider, ProviderKey } from "@/types";
import { PROVIDERS } from "@/constants/providers";
import { storage } from "@/services/storage";

const KEY = "providers";

interface State {
  providers: ConnectedProvider[];
  hydrated: boolean;
}

interface Actions {
  hydrate: () => Promise<void>;
  add: (p: Omit<ConnectedProvider, "id" | "connectedAt">) => ConnectedProvider;
  update: (id: string, patch: Partial<ConnectedProvider>) => void;
  remove: (id: string) => void;
  markChecked: (id: string) => void;
  toggleDisabled: (id: string) => void;
  getById: (id: string) => ConnectedProvider | undefined;
}

async function persist(list: ConnectedProvider[]) {
  // Keys are stored server-side in Firestore (admin-protected), so no local
  // obfuscation is needed — they never sit in browser storage anymore.
  await storage.set(KEY, list);
}

export const useProviderStore = create<State & Actions>((set, get) => ({
  providers: [],
  hydrated: false,
  hydrate: async () => {
    const list = await storage.get<ConnectedProvider[]>(KEY, []);
    set({ providers: list, hydrated: true });
  },
  add: (p) => {
    const provider: ConnectedProvider = {
      id: uuid(),
      connectedAt: Date.now(),
      ...p,
    };
    const list = [...get().providers, provider];
    set({ providers: list });
    void persist(list);
    return provider;
  },
  update: (id, patch) => {
    const list = get().providers.map((p) =>
      p.id === id ? { ...p, ...patch } : p
    );
    set({ providers: list });
    void persist(list);
  },
  remove: (id) => {
    const list = get().providers.filter((p) => p.id !== id);
    set({ providers: list });
    void persist(list);
  },
  markChecked: (id) => {
    get().update(id, { lastCheckedAt: Date.now() });
  },
  toggleDisabled: (id) => {
    const p = get().providers.find((x) => x.id === id);
    if (p) get().update(id, { disabled: !p.disabled });
  },
  getById: (id) => get().providers.find((p) => p.id === id),
}));

export function getProviderDefinition(key: ProviderKey) {
  return PROVIDERS[key];
}
