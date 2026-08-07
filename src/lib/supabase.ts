import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/**
 * True once Supabase env vars are present. The site is built to render
 * gracefully without them (empty states everywhere) so `next build` succeeds on
 * a fresh clone before anyone has wired up a project.
 */
export const supabaseConfigured = Boolean(url && anonKey);
export const supabaseAdminConfigured = Boolean(url && serviceKey);

let readClient: SupabaseClient | null = null;
let writeClient: SupabaseClient | null = null;

/** Read-only client (anon key + Row Level Security). Used by public pages. */
export function db(): SupabaseClient | null {
  if (!supabaseConfigured) return null;
  readClient ??= createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return readClient;
}

/**
 * Full-access client (service role). SERVER ONLY — never import this into a
 * component that runs in the browser. Bypasses Row Level Security.
 */
export function dbAdmin(): SupabaseClient | null {
  if (!supabaseAdminConfigured) return null;
  writeClient ??= createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return writeClient;
}

export const STORAGE_BUCKET = "otters";

/** Public URL for a path inside the storage bucket. */
export function storageUrl(path: string): string {
  if (!url) return path;
  if (path.startsWith("http")) return path;
  return `${url}/storage/v1/object/public/${STORAGE_BUCKET}/${path.replace(/^\/+/, "")}`;
}
