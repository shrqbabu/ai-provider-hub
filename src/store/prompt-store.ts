import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type { Prompt } from "@/types";
import { storage } from "@/services/storage";
import { BUILTIN_CONTEXT_PROMPTS } from "@/constants/context-prompts";
import { useSettingsStore } from "./settings-store";

const KEY = "prompts";

interface State {
  prompts: Prompt[];
  hydrated: boolean;
}

interface Actions {
  hydrate: () => Promise<void>;
  add: (p: Omit<Prompt, "id" | "createdAt" | "updatedAt">) => Prompt;
  update: (id: string, patch: Partial<Prompt>) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => Prompt | undefined;
  toggleFavorite: (id: string) => void;
  setDefaultContext: (id: string | null) => void;
  seedContextPrompts: () => void;
}

async function persist(list: Prompt[]) {
  await storage.set(KEY, list);
}

export const usePromptStore = create<State & Actions>((set, get) => ({
  prompts: [],
  hydrated: false,
  hydrate: async () => {
    const list = await storage.get<Prompt[]>(KEY, []);
    set({ prompts: list, hydrated: true });
  },
  seedContextPrompts: () => {
    const existing = get().prompts;
    const have = new Set(existing.map((p) => p.title.toLowerCase()));
    const now = Date.now();
    const extras: Prompt[] = BUILTIN_CONTEXT_PROMPTS.filter(
      (p) => !have.has(p.title.toLowerCase())
    ).map((p, i) => ({
      ...p,
      id: uuid(),
      createdAt: now + i,
      updatedAt: now + i,
    }));
    if (extras.length === 0) {
      useSettingsStore.getState().update({ contextPromptsSeeded: true });
      return;
    }
    const list = [...extras, ...existing];
    set({ prompts: list });
    void persist(list);
    useSettingsStore.getState().update({
      contextPromptsSeeded: true,
      defaultContextPromptId:
        useSettingsStore.getState().settings.defaultContextPromptId || extras[0]?.id || "",
    });
  },
  setDefaultContext: (id) => {
    const list = get().prompts.map((p) => ({
      ...p,
      isDefault: !!id && p.id === id,
    }));
    set({ prompts: list });
    void persist(list);
    useSettingsStore.getState().update({ defaultContextPromptId: id || "" });
  },
  add: (p) => {
    const prompt: Prompt = {
      id: uuid(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...p,
    };
    const list = [prompt, ...get().prompts];
    set({ prompts: list });
    void persist(list);
    return prompt;
  },
  update: (id, patch) => {
    const list = get().prompts.map((p) =>
      p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p
    );
    set({ prompts: list });
    void persist(list);
  },
  remove: (id) => {
    const list = get().prompts.filter((p) => p.id !== id);
    set({ prompts: list });
    void persist(list);
  },
  duplicate: (id) => {
    const p = get().prompts.find((x) => x.id === id);
    if (!p) return undefined;
    return get().add({
      title: p.title + " (copy)",
      content: p.content,
      tags: p.tags,
      folder: p.folder,
      kind: p.kind,
    });
  },
  toggleFavorite: (id) => {
    const p = get().prompts.find((x) => x.id === id);
    if (p) get().update(id, { favorite: !p.favorite });
  },
}));
