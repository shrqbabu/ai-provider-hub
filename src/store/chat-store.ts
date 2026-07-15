import { create } from "zustand";
import { v4 as uuid } from "uuid";
import type { Chat, ChatMessage } from "@/types";
import { storage } from "@/services/storage";

const KEY = "chats";

interface State {
  chats: Chat[];
  hydrated: boolean;
  activeId: string | null;
}

interface Actions {
  hydrate: () => Promise<void>;
  create: (init?: Partial<Chat>) => Chat;
  update: (id: string, patch: Partial<Chat>) => void;
  remove: (id: string) => void;
  softDelete: (id: string) => void;
  restore: (id: string) => void;
  hardDelete: (id: string) => void;
  emptyTrash: () => void;
  setActive: (id: string | null) => void;
  addMessage: (chatId: string, msg: Omit<ChatMessage, "id" | "createdAt">) => ChatMessage;
  updateMessage: (chatId: string, msgId: string, patch: Partial<ChatMessage>) => void;
  removeMessage: (chatId: string, msgId: string) => void;
  clone: (id: string) => Chat | undefined;
  byId: (id: string) => Chat | undefined;
}

async function persist(list: Chat[]) {
  await storage.set(KEY, list);
}

export const useChatStore = create<State & Actions>((set, get) => ({
  chats: [],
  hydrated: false,
  activeId: null,
  hydrate: async () => {
    const list = await storage.get<Chat[]>(KEY, []);
    set({ chats: list, hydrated: true });
  },
  create: (init = {}) => {
    const chat: Chat = {
      id: uuid(),
      title: init.title ?? "New chat",
      messages: init.messages ?? [],
      providerId: init.providerId,
      modelId: init.modelId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      systemPrompt: init.systemPrompt,
    };
    const list = [chat, ...get().chats];
    set({ chats: list, activeId: chat.id });
    void persist(list);
    return chat;
  },
  update: (id, patch) => {
    const list = get().chats.map((c) =>
      c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c
    );
    set({ chats: list });
    void persist(list);
  },
  remove: (id) => {
    const list = get().chats.filter((c) => c.id !== id);
    set({ chats: list, activeId: get().activeId === id ? null : get().activeId });
    void persist(list);
  },
  softDelete: (id) => get().update(id, { deleted: true }),
  restore: (id) => get().update(id, { deleted: false }),
  hardDelete: (id) => get().remove(id),
  emptyTrash: () => {
    const list = get().chats.filter((c) => !c.deleted);
    set({ chats: list });
    void persist(list);
  },
  setActive: (id) => set({ activeId: id }),
  addMessage: (chatId, msg) => {
    const message: ChatMessage = { id: uuid(), createdAt: Date.now(), ...msg };
    const list = get().chats.map((c) =>
      c.id === chatId
        ? { ...c, messages: [...c.messages, message], updatedAt: Date.now() }
        : c
    );
    set({ chats: list });
    void persist(list);
    return message;
  },
  updateMessage: (chatId, msgId, patch) => {
    const list = get().chats.map((c) =>
      c.id === chatId
        ? {
            ...c,
            messages: c.messages.map((m) =>
              m.id === msgId ? { ...m, ...patch } : m
            ),
            updatedAt: Date.now(),
          }
        : c
    );
    set({ chats: list });
    void persist(list);
  },
  removeMessage: (chatId, msgId) => {
    const list = get().chats.map((c) =>
      c.id === chatId
        ? { ...c, messages: c.messages.filter((m) => m.id !== msgId) }
        : c
    );
    set({ chats: list });
    void persist(list);
  },
  clone: (id) => {
    const chat = get().chats.find((c) => c.id === id);
    if (!chat) return undefined;
    return get().create({
      title: chat.title + " (copy)",
      messages: chat.messages,
      providerId: chat.providerId,
      modelId: chat.modelId,
      systemPrompt: chat.systemPrompt,
    });
  },
  byId: (id) => get().chats.find((c) => c.id === id),
}));
