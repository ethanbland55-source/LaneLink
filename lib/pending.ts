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
 *
 * ## Why not key on the ingredient id
 *
 * Because there isn't one, not a lasting one. Saving a meal runs `delete from
 * ingredients where meal_id = ...` and re-inserts the list, so every row gets a
 * fresh serial id on every save. The first version of this keyed on that id and
 * the button did nothing at all: staging saved the meals first, which changed
 * every id, and then posted the old ones — which the foreign key refused.
 *
 * What does survive a save is the meal, the position within it, and the name.
 * So that is the key. If a change falls due and the name at that position no
 * longer matches, it is skipped: missing a change is a small problem, and
 * resizing the wrong food is a much bigger one.
 */

import { sql } from "./db";
import { dayKey } from "./nutrition";
import { snapshot } from "./history";
import { dowOf, nextRollDay } from "./weekly";

export type PendingPortion = {
  meal_id: number;
  slot: number;
  name: string;
  meal_name: string;
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
 * Two statements, and only when there is something waiting — the count is the
 * cheap query that keeps this off the critical path on every page load, and it
 * is an index-only scan on a table that is almost always empty.
 *
 * Returns how many portions changed, which the caller may ignore.
 */
export async function applyDuePortions(today?: string): Promise<number> {
  try {
    const day = today ?? dayKey();
    const due = (await sql`
      select meal_id, slot, name, grams
        from pending_portions
       where apply_on <= ${day}::date`) as any[];
    if (!due.length) return 0;

    // What they were, before they stop being what they were.
    await snapshot("staged change", day);

    const rows = (await sql`
      with moved as (
        update ingredients i
           set grams = v.grams
          from (select * from jsonb_to_recordset(${JSON.stringify(
            due.map((d) => ({
              meal_id: Number(d.meal_id),
              slot: Number(d.slot),
              name: String(d.name),
              grams: Number(d.grams),
            }))
          )}::jsonb) as t(meal_id int, slot int, name text, grams numeric)) v
         where i.meal_id = v.meal_id and i.sort_order = v.slot and i.name = v.name
        returning i.id
      )
      select count(*)::int as n from moved`) as any[];

    await sql`delete from pending_portions where apply_on <= ${day}::date`;
    return Number(rows[0]?.n ?? 0);
  } catch (e) {
    // A page that can't apply a staged change should still render the plan it
    // has. Silence here is much better than a blank screen.
    console.warn("pending portions not applied:", e);
    return 0;
  }
}

/** Everything still waiting, in plan order, with the names to show it. */
export async function listPending(): Promise<PendingPortion[]> {
  const rows = (await sql`
    select p.meal_id,
           p.slot,
           p.name,
           p.grams,
           p.was_grams,
           p.note,
           to_char(p.apply_on, 'YYYY-MM-DD') as apply_on,
           to_char(p.staged_on, 'YYYY-MM-DD') as staged_on,
           m.name as meal_name
      from pending_portions p
      join meals m on m.id = p.meal_id
     order by m.sort_order, m.id, p.slot`) as any[];

  return rows.map((r) => ({
    meal_id: Number(r.meal_id),
    slot: Number(r.slot),
    name: String(r.name),
    meal_name: String(r.meal_name),
    grams: Number(r.grams),
    was_grams: r.was_grams == null ? null : Number(r.was_grams),
    apply_on: String(r.apply_on),
    staged_on: String(r.staged_on),
    note: r.note ?? null,
  }));
}

export type StageRow = { meal_id: number; slot: number; name: string; grams: number };

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

  const wanted = rows.filter(
    (r) =>
      Number.isFinite(r.grams) &&
      r.grams > 0 &&
      Number.isFinite(r.meal_id) &&
      Number.isFinite(r.slot) &&
      !!r.name
  );
  if (!wanted.length) return 0;

  // Only stage against portions that actually exist, and only where the value
  // really moves. Both checks happen in the database rather than in JavaScript
  // so that a stale tab cannot stage a change against a meal that has since
  // been edited out from under it.
  const inserted = (await sql`
    insert into pending_portions (meal_id, slot, name, grams, was_grams, apply_on, note)
    select v.meal_id, v.slot, v.name, v.grams, i.grams, ${applyOn}::date, ${note ?? null}
      from (select * from jsonb_to_recordset(${JSON.stringify(
        wanted.map((r) => ({
          meal_id: Number(r.meal_id),
          slot: Number(r.slot),
          name: String(r.name),
          grams: Math.round(Number(r.grams) * 10) / 10,
        }))
      )}::jsonb) as t(meal_id int, slot int, name text, grams numeric)) v
      join ingredients i
        on i.meal_id = v.meal_id and i.sort_order = v.slot and i.name = v.name
     where abs(i.grams - v.grams) >= 0.5
    on conflict (meal_id, slot) do update
      set name      = excluded.name,
          grams     = excluded.grams,
          was_grams = excluded.was_grams,
          apply_on  = excluded.apply_on,
          note      = excluded.note
    returning meal_id`) as any[];

  return inserted.length;
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
export function overlayPending<T extends { name: string; grams: number }>(
  mealId: number,
  items: T[],
  pending: Pick<PendingPortion, "meal_id" | "slot" | "name" | "grams">[]
): T[] {
  if (!pending.length) return items;
  const by = new Map(
    pending.filter((p) => p.meal_id === mealId).map((p) => [`${p.slot}:${p.name}`, p.grams])
  );
  if (!by.size) return items;
  return items.map((it, slot) => {
    const g = by.get(`${slot}:${it.name}`);
    return g == null ? it : { ...it, grams: g };
  });
}
