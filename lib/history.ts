/**
 * Being able to put the portions back.
 *
 * Three things in this app rewrite every portion at once: the weekly re-fit,
 * a staged change falling due, and Recalculate. Two of those happen without
 * anyone pressing anything. That is the right behaviour — a plan that needs
 * you to remember to press a button is a plan that drifts — but it means you
 * can open the app on a Monday, find the numbers have moved, and have no way
 * to say "that was fine as it was".
 *
 * So every bulk rewrite writes down what the portions were first. One row, one
 * snapshot, and an undo that puts them all back.
 *
 * Snapshots are keyed the same way staged changes are — meal, position, name —
 * rather than by ingredient id, for the same reason: saving a meal deletes its
 * ingredient rows and inserts new ones, so ids do not survive. A snapshot that
 * cannot be matched back is skipped rather than guessed at.
 */

import { sql } from "./db";

export type PortionRow = {
  meal_id: number;
  slot: number;
  name: string;
  grams: number;
};

export type Snapshot = {
  id: number;
  changed_on: string;
  reason: string;
  rows: PortionRow[];
};

/** How many snapshots to keep. Enough to undo a bad week, not a diary. */
const KEEP = 12;

/** Every portion as it stands right now, in the form a snapshot takes. */
export async function currentPortions(): Promise<PortionRow[]> {
  const rows = (await sql`
    select meal_id, sort_order as slot, name, grams
      from ingredients
     order by meal_id, sort_order`) as any[];
  return rows.map((r) => ({
    meal_id: Number(r.meal_id),
    slot: Number(r.slot),
    name: String(r.name),
    grams: Number(r.grams),
  }));
}

/**
 * Write down what the plan looks like before changing it.
 *
 * Called *before* the change, always. Deliberately swallows its own failures:
 * a snapshot that could not be taken is a shame, but refusing to re-fit the
 * plan because the undo table was unhappy would be worse.
 */
export async function snapshot(reason: string, on?: string): Promise<number | null> {
  try {
    const rows = await currentPortions();
    if (!rows.length) return null;
    const res = (await sql`
      insert into portion_history (changed_on, reason, rows)
      values (${on ?? new Date().toISOString().slice(0, 10)}::date,
              ${reason},
              ${JSON.stringify(rows)}::jsonb)
      returning id`) as any[];

    // Trim, so this never becomes a table nobody looks at that only grows.
    await sql`
      delete from portion_history
       where id not in (select id from portion_history order by id desc limit ${KEEP})`;

    return Number(res[0]?.id ?? 0) || null;
  } catch (e) {
    console.warn("portion snapshot skipped:", e);
    return null;
  }
}

/** The snapshots there are, newest first, without their contents. */
export async function listSnapshots(): Promise<Omit<Snapshot, "rows">[]> {
  const rows = (await sql`
    select id, to_char(changed_on, 'YYYY-MM-DD') as changed_on, reason
      from portion_history
     order by id desc`) as any[];
  return rows.map((r) => ({
    id: Number(r.id),
    changed_on: String(r.changed_on),
    reason: String(r.reason),
  }));
}

/**
 * Put the portions back to a snapshot.
 *
 * Matched on meal, position and name. A row that no longer matches — you
 * renamed the ingredient, or reordered the meal — is reported rather than
 * forced, because the one thing worse than not restoring a portion is
 * restoring it onto the wrong food.
 */
export async function restore(id: number): Promise<{ restored: number; skipped: string[] }> {
  const got = (await sql`select rows from portion_history where id = ${id}`) as any[];
  const rows = (got[0]?.rows ?? []) as PortionRow[];
  if (!rows.length) return { restored: 0, skipped: [] };

  const live = await currentPortions();
  const key = (r: PortionRow) => `${r.meal_id}:${r.slot}:${r.name}`;
  const liveBy = new Map(live.map((r) => [key(r), r]));

  const wanted = rows.filter((r) => {
    const now = liveBy.get(key(r));
    return now != null && Math.abs(now.grams - r.grams) >= 0.5;
  });
  const skipped = rows.filter((r) => !liveBy.has(key(r))).map((r) => r.name);

  if (wanted.length) {
    // One statement. The whole point of an undo is that it is not a sequence
    // of writes that can stop halfway and leave a plan that is half of each.
    await sql`
      update ingredients i
         set grams = v.grams
        from (select * from jsonb_to_recordset(${JSON.stringify(wanted)}::jsonb)
                     as t(meal_id int, slot int, name text, grams numeric)) v
       where i.meal_id = v.meal_id and i.sort_order = v.slot and i.name = v.name`;
  }

  return { restored: wanted.length, skipped };
}

/* ------------------------------------------------------------------ */
/* Recovering a week from what you actually ate                        */
/* ------------------------------------------------------------------ */

/**
 * The portions as your own log remembers them.
 *
 * This is the escape hatch for a change that happened before there was any
 * history to undo. Every logged meal stores the items exactly as they were
 * when you tapped it, so the log is a record of what the plan said on the day
 * — the most recent entry for each meal in a window gives back the portions
 * that were in force then.
 *
 * It only covers meals you actually logged, which is the honest limit of it:
 * this restores what you ate, not what you meant to.
 */
export async function portionsFromLog(from: string, to: string): Promise<PortionRow[]> {
  const rows = (await sql`
    select distinct on (meal_id) meal_id, items
      from log_entries
     where day between ${from}::date and ${to}::date
       and meal_id is not null
       and meal_id > 0
     order by meal_id, day desc, id desc`) as any[];

  const live = await currentPortions();
  const nameAt = new Map(live.map((r) => [`${r.meal_id}:${r.slot}`, r.name]));

  const out: PortionRow[] = [];
  for (const r of rows) {
    const items = Array.isArray(r.items) ? r.items : [];
    items.forEach((it: any, slot: number) => {
      const grams = Number(it?.grams);
      if (!Number.isFinite(grams) || grams <= 0) return;
      const mealId = Number(r.meal_id);
      // Trust the live name over the logged one: the log is the source for the
      // gram amount, not for what the food is called now.
      const name = nameAt.get(`${mealId}:${slot}`);
      if (!name) return;
      out.push({ meal_id: mealId, slot, name, grams });
    });
  }
  return out;
}

/** Apply a set of portions read back out of the log. */
export async function applyPortions(rows: PortionRow[]): Promise<number> {
  if (!rows.length) return 0;
  await sql`
    update ingredients i
       set grams = v.grams
      from (select * from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
                   as t(meal_id int, slot int, name text, grams numeric)) v
     where i.meal_id = v.meal_id and i.sort_order = v.slot and i.name = v.name`;
  return rows.length;
}
