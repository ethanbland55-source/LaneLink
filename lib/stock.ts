/**
 * What's in the cupboard, kept up to date by eating.
 *
 * The shopping list used to take a "have in" figure you typed and trust it
 * forever — so a kilo of chicken typed in on Saturday was still a kilo the
 * following Saturday, however much of it you had eaten in between. The list
 * would then under-buy by exactly a week's worth of chicken.
 *
 * Now a figure is a *count*: this many grams, true at this moment. Every meal
 * you log after that moment takes its grams off, ingredient by ingredient, so
 * the figure runs down on its own through the week and next Saturday's list
 * already knows what's left. Three things set a new count:
 *
 *  - **Ticking a line in the shop** adds what you bought to what was there.
 *  - **Changing the figure by hand** replaces it — the chicken went off, you
 *    had a friend round, you just looked in the fridge.
 *  - **Unticking** takes the same amount back out again.
 *
 * Grams are as the plan weighs them — raw meat, dry rice — because that's what
 * the log records and what the list buys, so the subtraction is like for like.
 */

import { sql } from "./db";
import { shoppingKey } from "./foods";

export type StockRow = {
  name: string;
  /** The count, as it was at `counted_at`. */
  grams: number;
  counted_at: string | null;
  counted_on: string | null;
};

export type Eaten = { day: string; created_at: string; items: { name: string; grams: number }[] };

export type Stock = {
  key: string;
  name: string;
  /** What's there now: the count, less everything logged since. */
  grams: number;
  counted: number;
  used: number;
  counted_at: string | null;
  counted_on: string | null;
  /**
   * False for a figure typed in before the cupboard tracked itself. Those
   * were "what I have before this shop", never a count of what was left, so
   * running them down by everything eaten since would ignore every shop in
   * between and read far too low. They stand exactly as they did — the list
   * subtracts them, nothing subtracts from them — until the next time the line
   * is ticked in a shop or the figure is corrected by hand, and from then on
   * they track.
   */
  tracking: boolean;
};

/**
 * Whether a logged meal came out of this count.
 *
 * Logged after the count *and* for a day on or after it. The second half is
 * for catching up: a meal from Thursday typed in on Saturday afternoon, after
 * you'd counted the fridge that morning, was already missing from what you
 * counted — taking it off again would count it twice.
 */
function after(e: Eaten, r: StockRow): boolean {
  if (r.counted_at && !(Date.parse(e.created_at) > Date.parse(r.counted_at))) return false;
  if (r.counted_on && e.day < r.counted_on) return false;
  return true;
}

export function stockNow(rows: StockRow[], eaten: Eaten[]): Stock[] {
  return rows.map((r) => {
    const key = shoppingKey(r.name);
    const tracking = r.counted_on != null;
    let used = 0;
    for (const e of tracking ? eaten : []) {
      if (!after(e, r)) continue;
      for (const it of e.items ?? []) {
        if (it?.name && shoppingKey(String(it.name)) === key) used += Number(it.grams) || 0;
      }
    }
    const counted = Number(r.grams) || 0;
    return {
      key,
      name: r.name,
      counted,
      used: Math.round(used),
      grams: Math.max(0, Math.round(counted - used)),
      counted_at: r.counted_at,
      counted_on: r.counted_on,
      tracking,
    };
  });
}

/** Everything in the cupboard for one account, as it stands now. */
export async function listStock(userId: number): Promise<Stock[]> {
  const rows = (await sql`
    select name, grams,
           to_char(counted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as counted_at,
           to_char(counted_on, 'YYYY-MM-DD') as counted_on
      from pantry where user_id = ${userId} order by name`) as any[];
  if (!rows.length) return [];

  // Only the log since the oldest count can matter, so only that is read.
  const eaten = (await sql`
    select to_char(day, 'YYYY-MM-DD') as day,
           to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
           items
      from log_entries
     where user_id = ${userId}
       and created_at > coalesce(
             (select min(counted_at) from pantry where user_id = ${userId}),
             now() - interval '60 days')`) as any[];

  return stockNow(
    rows.map((r) => ({
      name: String(r.name),
      grams: Number(r.grams),
      counted_at: r.counted_at ?? null,
      counted_on: r.counted_on ?? null,
    })),
    eaten.map((e) => ({ day: e.day, created_at: e.created_at, items: e.items ?? [] }))
  );
}

/** What's there now for one ingredient, matched the way the list matches. */
async function stockOf(userId: number, name: string): Promise<Stock | null> {
  const key = shoppingKey(name);
  return (await listStock(userId)).find((s) => s.key === key) ?? null;
}

/**
 * Replace the count — you looked, and this is what's there.
 *
 * Written against the row the list would match, so "Chicken breasts" typed in
 * the shop and "Chicken Breast" in the plan are one cupboard shelf, not two.
 */
export async function setStock(
  userId: number,
  name: string,
  grams: number,
  day: string
): Promise<void> {
  const existing = await stockOf(userId, name);
  const row = existing?.name ?? name.trim();
  if (!(grams > 0)) {
    await sql`delete from pantry where user_id = ${userId} and name = ${row}`;
    return;
  }
  await sql`
    insert into pantry (user_id, name, grams, counted_at, counted_on, updated_at)
    values (${userId}, ${row}, ${grams}, now(), ${day}, now())
    on conflict (user_id, name) do update set
      grams = ${grams}, counted_at = now(), counted_on = ${day}, updated_at = now()`;
}

/** Add to (or, negative, take from) what's there now. */
export async function adjustStock(
  userId: number,
  name: string,
  delta: number,
  day: string
): Promise<void> {
  if (!Number.isFinite(delta) || delta === 0) return;
  const existing = await stockOf(userId, name);
  await setStock(userId, existing?.name ?? name, Math.max(0, (existing?.grams ?? 0) + delta), day);
}
