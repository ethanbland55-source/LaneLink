/**
 * Changes that are agreed but not in force yet.
 *
 * The week has three separate moments and they are deliberately not the same
 * day:
 *
 *   - **Saturday** you shop. The list has to be for the week the food is *for*,
 *     which is the one starting Monday.
 *   - **Sunday evening** you cook it, into containers, by weight.
 *   - **Monday** you start eating it, and that is the first day the new numbers
 *     are true.
 *
 * Recalculate used to ignore all of that and write straight to the plan. Press
 * it on a Wednesday and Wednesday's lunch changed size — except lunch was
 * already cooked and sitting in a box, so the app was now describing food that
 * did not exist. Worse, you would then shop on Saturday against numbers that
 * had been live for three days and were built on a body weight from before the
 * week you had just eaten.
 *
 * So a recalculation is *staged*. The new portions are written here with the
 * day they come into force, the shopping list buys against them because that's
 * the food it is buying, and the plan itself keeps saying what is in the fridge
 * until roll day arrives and they swap in.
 *
 * Nothing here needs a scheduler. The swap happens on the first read on or
 * after the day it is due, which on a phone that gets opened every morning is
 * as good as a cron job and has no moving parts.
 */

import { sql } from "./db";
import { dayKey } from "./nutrition";
import { dowOf, nextRollDay } from "./weekly";

export type PendingPortion = {
  ingredient_id: number;
  meal_id: number;
  meal_name: string;
  name: string;
  /** What it will become. */
  grams: number;
  /** What it was when the change was staged, for the "70 → 56 g" line. */
  was_grams: number | null;
  apply_on: string;
  staged_on: string;
  note: string | null;
};

/**
 * The day a change staged today should come into force.
 *
 * Roll day if that is today — pressing Recalculate on a Monday morning means
 * you want it for the week you are starting, not the one after. Otherwise the
 * next one.
 */
export function applyDayFor(rollDow: number, today: string = dayKey()): string {
  return dowOf(today) === rollDow ? today : nextRollDay(rollDow, today);
}

/**
 * Swap in anything that has come due.
 *
 * One statement on purpose. This sits on the read path for every page that
 * shows a portion, so it has to cost one round trip whether there is anything
 * waiting or not — the `delete ... returning` feeding the `update` does the
 * whole job, and does nothing at all when the table is empty.
 *
 * Returns how many portions changed, which the caller may ignore.
 */
export async function applyDuePortions(today?: string): Promise<number> {
  try {
    const day = today ?? dayKey();
    const rows = (await sql`
      with due as (
        delete from pending_portions
        where apply_on <= ${day}::date
        returning ingredient_id, grams
      )
      update ingredients i
         set grams = d.grams
        from due d
       where i.id = d.ingredient_id
      returning i.id`) as any[];
    return rows.length;
  } catch (e) {
    // A page that can't apply a staged change should still render the plan it
    // has. Silence here is much better than a blank screen.
    console.warn("pending portions not applied:", e);
    return 0;
  }
}

/** Everything still waiting, newest staging first, with the names to show it. */
export async function listPending(): Promise<PendingPortion[]> {
  const rows = (await sql`
    select p.ingredient_id,
           p.grams,
           p.was_grams,
           p.note,
           to_char(p.apply_on, 'YYYY-MM-DD') as apply_on,
           to_char(p.staged_on, 'YYYY-MM-DD') as staged_on,
           i.name,
           i.meal_id,
           m.name as meal_name
      from pending_portions p
      join ingredients i on i.id = p.ingredient_id
      join meals m on m.id = i.meal_id
     order by m.sort_order, m.id, i.sort_order, i.id`) as any[];

  return rows.map((r) => ({
    ingredient_id: Number(r.ingredient_id),
    meal_id: Number(r.meal_id),
    meal_name: String(r.meal_name),
    name: String(r.name),
    grams: Number(r.grams),
    was_grams: r.was_grams == null ? null : Number(r.was_grams),
    apply_on: String(r.apply_on),
    staged_on: String(r.staged_on),
    note: r.note ?? null,
  }));
}

export type StageRow = { ingredient_id: number; grams: number };

/**
 * Stage a set of portions.
 *
 * Replaces whatever was staged before rather than merging with it: two
 * recalculations in a week are two opinions about the same week, and the
 * second one is the one you meant. A portion that isn't actually moving is
 * dropped, so the "12 changes pending" count means twelve real changes.
 */
export async function stagePortions(
  rows: StageRow[],
  applyOn: string,
  note?: string
): Promise<number> {
  await sql`delete from pending_portions`;

  const wanted = rows.filter((r) => Number.isFinite(r.grams) && r.grams > 0);
  if (!wanted.length) return 0;

  const current = (await sql`
    select id, grams from ingredients where id = any(${wanted.map((r) => r.ingredient_id)}::int[])
  `) as any[];
  const was = new Map(current.map((c) => [Number(c.id), Number(c.grams)]));

  const real = wanted.filter((r) => {
    const before = was.get(r.ingredient_id);
    return before == null || Math.abs(before - r.grams) >= 0.5;
  });
  if (!real.length) return 0;

  // One multi-row insert, not one per portion — this runs from a button press
  // and the HTTP driver charges a round trip per statement.
  await sql`
    insert into pending_portions (ingredient_id, grams, was_grams, apply_on, note)
    select * from unnest(
      ${real.map((r) => r.ingredient_id)}::int[],
      ${real.map((r) => Math.round(r.grams * 10) / 10)}::numeric[],
      ${real.map((r) => was.get(r.ingredient_id) ?? null)}::numeric[],
      ${real.map(() => applyOn)}::date[],
      ${real.map(() => note ?? null)}::text[]
    )
    on conflict (ingredient_id) do update
      set grams = excluded.grams,
          was_grams = excluded.was_grams,
          apply_on = excluded.apply_on,
          note = excluded.note`;

  return real.length;
}

/** Throw away what's staged, leaving the live plan alone. */
export async function discardPending(): Promise<void> {
  await sql`delete from pending_portions`;
}

/**
 * The plan as the staged changes would leave it.
 *
 * Used by the shopping list, which must buy for the week the food is for
 * rather than the week that is ending. Pure, so the same overlay works on the
 * client without a second fetch.
 */
export function overlayPending<T extends { id: number; grams: number }>(
  items: T[],
  pending: Pick<PendingPortion, "ingredient_id" | "grams">[]
): T[] {
  if (!pending.length) return items;
  const by = new Map(pending.map((p) => [p.ingredient_id, p.grams]));
  return items.map((it) => (by.has(it.id) ? { ...it, grams: by.get(it.id) as number } : it));
}
