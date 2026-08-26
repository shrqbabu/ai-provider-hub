import { create } from "zustand";
import type { User as SupabaseUser, Session } from "@supabase/supabase-js";
import { getSupabase, supabaseConfigured } from "@/services/supabase";

export interface AppUser {
  id: string;
  uid: string; // compatibility alias
  email?: string;
  displayName?: string;
  photoURL?: string;
  provider?: string;
  createdAt?: string;
  rawUser: SupabaseUser;
  metadata?: {
    creationTime?: string;
  };
  providerData?: Array<{ providerId: string }>;
}

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

function mapSupabaseUser(user: SupabaseUser | null): AppUser | null {
  if (!user) return null;
  const meta = user.user_metadata || {};
  const appMeta = user.app_metadata || {};
  const provider = (appMeta.provider as string) || "email";
  const displayName =
    meta.full_name ||
    meta.name ||
    meta.user_name ||
    (user.email ? user.email.split("@")[0] : "User");
  const photoURL = meta.avatar_url || meta.picture || "";

  return {
    id: user.id,
    uid: user.id,
    email: user.email,
    displayName,
    photoURL,
    provider,
    createdAt: user.created_at,
    rawUser: user,
    metadata: {
      creationTime: user.created_at,
    },
    providerData: [
      {
        providerId: provider === "google" ? "google.com" : provider,
      },
    ],
  };
}

interface State {
  user: AppUser | null;
  session: Session | null;
  /** True until the initial auth check completes - avoids auth flash. */
  loading: boolean;
  configured: boolean;
  /** Local user ID for when cloud auth is not configured */
  localUid: string;
}

interface Actions {
  init: () => void;
  signup: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  loginWithOAuth: (provider: "google" | "github" | "gitlab" | "discord") => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithGithub: () => Promise<void>;
  logout: () => Promise<void>;
}

let initialized = false;

export const useAuthStore = create<State & Actions>((set, get) => ({
  user: null,
  session: null,
  loading: true,
  configured: supabaseConfigured,
  localUid: getOrCreateLocalUid(),

  init: () => {
    if (!supabaseConfigured) {
      set({ loading: false });
      return;
    }
    if (initialized) return;
    initialized = true;

    try {
      const client = getSupabase();

      // Check current session on startup
      client.auth.getSession().then(({ data: { session }, error }) => {
        if (error) {
          console.warn("[Auth] getSession error:", error);
        }
        set({
          session,
          user: session ? mapSupabaseUser(session.user) : null,
          loading: false,
        });
      });

      // Listen to auth changes (sign in, sign out, token refresh, OAuth redirect)
      client.auth.onAuthStateChange((_event, session) => {
        set({
          session,
          user: session ? mapSupabaseUser(session.user) : null,
          loading: false,
        });
      });
    } catch (e) {
      console.warn("[Auth] Supabase init error:", e);
      set({ loading: false });
    }
  },

  signup: async (email, password) => {
    const client = getSupabase();
    const { data, error } = await client.auth.signUp({
      email,
      password,
    });
    if (error) throw error;
    if (data.session) {
      set({
        session: data.session,
        user: mapSupabaseUser(data.session.user),
      });
    }
  },

  login: async (email, password) => {
    const client = getSupabase();
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    if (data.session) {
      set({
        session: data.session,
        user: mapSupabaseUser(data.session.user),
      });
    }
  },

  loginWithOAuth: async (provider) => {
    const client = getSupabase();
    const redirectTo = window.location.origin;
    const { error } = await client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });
    if (error) throw error;
  },

  loginWithGoogle: async () => {
    await get().loginWithOAuth("google");
  },

  loginWithGithub: async () => {
    await get().loginWithOAuth("github");
  },

  logout: async () => {
    if (supabaseConfigured) {
      const client = getSupabase();
      await client.auth.signOut();
    }
    set({ user: null, session: null });
  },
}));

/**
 * Fresh Supabase JWT access token for authenticating backend calls (/api/data, /api/keys).
 * Returns null if signed out or Supabase is not configured.
 */
export async function getIdToken(): Promise<string | null> {
  if (!supabaseConfigured) return null;
  try {
    const state = useAuthStore.getState();
    if (state.session?.access_token) {
      return state.session.access_token;
    }
    const client = getSupabase();
    const { data } = await client.auth.getSession();
    return data.session?.access_token || null;
  } catch {
    return null;
  }
}

export function getAuthUid(): string | null {
  if (!supabaseConfigured) return getOrCreateLocalUid();
  const state = useAuthStore.getState();
  return state.user?.id || null;
}

/**
 * Stable identifier for scoping CLIENT-side data (localStorage). Always returns
 * a value so every browser tab scopes data to the same user even mid-auth.
 * Two different users on the same browser never share keys.
 */
export function getEffectiveUid(): string {
  return getAuthUid() ?? getOrCreateLocalUid();
}
