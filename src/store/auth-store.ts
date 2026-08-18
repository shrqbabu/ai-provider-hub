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

const LOCAL_UID_KEY = "ai-provider-hub:local-uid";

function getOrCreateLocalUid(): string {
  if (typeof window === "undefined") return "local_user";
  let uid = localStorage.getItem(LOCAL_UID_KEY);
  if (!uid) {
    uid = "local_" + crypto.randomUUID();
    localStorage.setItem(LOCAL_UID_KEY, uid);
  }
  return uid;
}

interface State {
  user: User | null;
  /** True until the initial onAuthStateChanged fires — avoids auth flash. */
  loading: boolean;
  configured: boolean;
  /** Local user ID for when Firebase is not configured */
  localUid: string;
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
  localUid: getOrCreateLocalUid(),

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
 * /api/keys). Returns null if signed out or Firebase not configured.
 * Firebase caches and auto-refreshes the token, so calling this per-request is cheap.
 */
export async function getIdToken(): Promise<string | null> {
  if (!firebaseConfigured) return null;
  const user = getFirebaseAuth().currentUser;
  if (!user) return null;
  return user.getIdToken();
}

export function getAuthUid(): string | null {
  if (!firebaseConfigured) return getOrCreateLocalUid();
  const user = getFirebaseAuth().currentUser;
  return user?.uid || null;
}

/**
 * Stable identifier for scoping CLIENT-side data (localStorage). Always returns
 * a value so every browser tab scopes data to the same user even mid-auth.
 * Two different users on the same browser never share keys.
 */
export function getEffectiveUid(): string {
  return getAuthUid() ?? getOrCreateLocalUid();
}