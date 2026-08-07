import "server-only";
import { dbAdmin } from "./supabase";

/**
 * Admin reads use the service-role client so drafts and unpublished rows are
 * visible. Public pages never use these.
 */
export async function adminList<T = Record<string, unknown>>(
  table: string,
  opts: {
    select?: string;
    orderBy?: string;
    ascending?: boolean;
    limit?: number;
    eq?: [string, string];
  } = {}
): Promise<T[]> {
  const client = dbAdmin();
  if (!client) return [];
  let query = client.from(table).select(opts.select ?? "*");
  if (opts.eq) query = query.eq(opts.eq[0], opts.eq[1]);
  if (opts.orderBy) {
    query = query.order(opts.orderBy, { ascending: opts.ascending ?? true, nullsFirst: false });
  }
  if (opts.limit) query = query.limit(opts.limit);
  const { data } = await query;
  return (data as T[]) ?? [];
}

export async function adminOne<T = Record<string, unknown>>(
  table: string,
  id: string,
  select = "*"
): Promise<T | null> {
  const client = dbAdmin();
  if (!client) return null;
  const { data } = await client.from(table).select(select).eq("id", id).maybeSingle();
  return (data as T) ?? null;
}

export async function adminCount(table: string): Promise<number> {
  const client = dbAdmin();
  if (!client) return 0;
  const { count } = await client.from(table).select("*", { count: "exact", head: true });
  return count ?? 0;
}
