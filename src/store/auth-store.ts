import { create } from "zustand";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { getFirebaseAuth, firebaseConfigured } from "@/services/firebase";

interface State {
  user: User | null;
  /** True until the initial onAuthStateChanged fires — avoids auth flash. */
  loading: boolean;
  configured: boolean;
}

interface Actions {
  init: () => void;
  signup: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

let unsub: (() => void) | null = null;

export const useAuthStore = create<State & Actions>((set) => ({
  user: null,
  loading: true,
  configured: firebaseConfigured,

  init: () => {
    if (!firebaseConfigured) {
      set({ loading: false });
      return;
    }
    if (unsub) return; // already subscribed
    const auth = getFirebaseAuth();
    unsub = onAuthStateChanged(auth, (user) => {
      set({ user, loading: false });
    });
  },

  signup: async (email, password) => {
    const auth = getFirebaseAuth();
    await createUserWithEmailAndPassword(auth, email, password);
  },

  login: async (email, password) => {
    const auth = getFirebaseAuth();
    await signInWithEmailAndPassword(auth, email, password);
  },

  logout: async () => {
    const auth = getFirebaseAuth();
    await signOut(auth);
  },
}));

/**
 * Fresh Firebase ID token for authenticating backend calls (/api/data,
 * /api/keys). Returns null if signed out. Firebase caches and auto-refreshes
 * the token, so calling this per-request is cheap.
 */
export async function getIdToken(): Promise<string | null> {
  if (!firebaseConfigured) return null;
  const user = getFirebaseAuth().currentUser;
  if (!user) return null;
  return user.getIdToken();
}
