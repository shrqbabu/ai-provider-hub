import { create } from "zustand";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
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
  loginWithGoogle: () => Promise<void>;
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

    // Check if returning from redirect sign-in
    getRedirectResult(auth).catch(() => {
      // ignore redirect error if any
    });

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

  loginWithGoogle: async () => {
    const auth = getFirebaseAuth();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      if (
        err?.code === "auth/popup-blocked" ||
        err?.code === "auth/cancelled-popup-request" ||
        err?.code === "auth/popup-closed-by-user"
      ) {
        // Fallback to full page redirect if popup is blocked by browser
        await signInWithRedirect(auth, provider);
        return;
      }
      throw err;
    }
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

export function getAuthUid(): string | null {
  if (!firebaseConfigured) return null;
  const user = getFirebaseAuth().currentUser;
  return user?.uid || null;
}
