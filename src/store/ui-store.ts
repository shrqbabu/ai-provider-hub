import { create } from "zustand";

interface State {
  sidebarOpen: boolean;
}
interface Actions {
  setSidebarOpen: (v: boolean) => void;
  toggleSidebar: () => void;
}

export const useUIStore = create<State & Actions>((set, get) => ({
  sidebarOpen: false,
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
}));
