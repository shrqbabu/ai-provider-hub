import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null = null;

function getSupabaseCredentials(): { url: string; key: string } | null {
  const url =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    "";

  if (
    !url ||
    !key ||
    url === "https://your-project-id.supabase.co" ||
    url.includes("your_supabase")
  ) {
    return null;
  }

  return { url, key };
}

export function isSupabaseAdminReady(): boolean {
  return getSupabaseCredentials() !== null;
}

export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient;

  const creds = getSupabaseCredentials();
  if (!creds) {
    throw new Error(
      "Supabase credentials not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env."
    );
  }

  adminClient = createClient(creds.url, creds.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return adminClient;
}
