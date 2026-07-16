import localforage from "localforage";

localforage.config({
  name: "ai-provider-hub",
  storeName: "kv",
  description: "AI Provider Hub local storage",
});

export const storage = {
  async get<T>(key: string, fallback: T): Promise<T> {
    const val = await localforage.getItem<T>(key);
    return val ?? fallback;
  },
  async set<T>(key: string, value: T): Promise<void> {
    await localforage.setItem(key, value);
  },
  async remove(key: string): Promise<void> {
    await localforage.removeItem(key);
  },
  async clear(): Promise<void> {
    await localforage.clear();
  },
};
