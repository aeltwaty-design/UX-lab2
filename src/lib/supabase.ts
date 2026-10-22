import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** True when .env.local is filled in. The app shows a setup screen otherwise. */
export const configured = Boolean(url && anon && !url.includes("YOUR-PROJECT"));

export const supabase: SupabaseClient = createClient(
  configured ? url : "https://placeholder.supabase.co",
  configured ? anon : "placeholder",
  { auth: { persistSession: true, autoRefreshToken: true } },
);
