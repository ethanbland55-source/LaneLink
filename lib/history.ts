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
 * history to undo. Every logged meal stores its items exactly as they were
 * when you tapped it, so the log is a record of what the plan said on the day.
 *
 * ## Why it reads every day and not just the last one
 *
 * Because a log entry is what you *ate*, and what you ate is the plan plus
 * whatever happened. You weigh 19 g of honey when the plan said 20 and tap it
 * anyway; the jar runs out and you have 15. Take the most recent entry and one
 * bad morning becomes the plan.
 *
 * So every entry in the window votes, and the winner is the value that comes up
 * most often. Four days at 70 g and one at 63 g gives 70 g, which is right. A
 * genuine tie falls back to the median, which for two readings is their
 * midpoint and for one is simply that one — the honest answer when the log has
 * nothing more to say.
 *
 * ## Locked portions are left alone
 *
 * A locked portion is one the optimiser is not allowed to touch, so no re-fit
 * ever moved it and the live value is already correct. It is also the most
 * reliable thing in the plan, which makes it the wrong thing to overwrite with
 * an estimate from a week of tapping.
 */
export type LogPortion = PortionRow & {
  /** How many logged days agreed on this. */
  votes: number;
  /** How many days had an opinion at all. */
  seen: number;
  /** Everything the log said, so a wide spread can be shown rather than hidden. */
  values: number[];
  locked: boolean;
};

/**
 * What the plan said, out of a week of what you actually ate.
 *
 * The obvious answer is the most common value, and it is wrong. Consider a
 * re-fit that ran on the Tuesday: the log then holds 70, 70, 43, 43, 43 and the
 * most common value is 43 — the number you are trying to get rid of. The more
 * days pass before you notice, the more confidently it gives you the wrong one.
 *
 * What is actually wanted is the value in force *before* things moved, with
 * typing mistakes filtered out. Those are different jobs and need two steps:
 *
 *  1. **Keep only what is near the earliest reading.** Within 8 %, or a gram,
 *     whichever is larger. A rewrite moves a portion by a fifth or more, so
 *     this drops everything from after it — that is the point. Weighing 19 g
 *     instead of 20 stays, because that is the same portion, badly weighed.
 *  2. **Take the most common of what's left**, earliest winning a tie. One bad
 *     morning cannot outvote four good ones.
 *
 * Values must arrive in the order they were logged; the first one carries the
 * whole method.
 */
export function consensus(values: number[]): number {
  if (!values.length) return 0;

  const first = values[0];
  const tolerance = Math.max(1, Math.abs(first) * 0.08);
  const pool = values.filter((v) => Math.abs(v - first) <= tolerance);
  if (!pool.length) return Math.round(first * 10) / 10;

  const counts = new Map<number, number>();
  for (const v of pool) {
    const k = Math.round(v * 10) / 10;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  let best = pool[0];
  let bestCount = -1;
  // Walked in logged order, so an equal count keeps the earlier value.
  for (const v of pool) {
    const k = Math.round(v * 10) / 10;
    const n = counts.get(k) ?? 0;
    if (n > bestCount) {
      bestCount = n;
      best = k;
    }
  }
  return best;
}

export async function portionsFromLog(from: string, to: string): Promise<LogPortion[]> {
  const rows = (await sql`
    select meal_id, items
      from log_entries
     where day between ${from}::date and ${to}::date
       and meal_id is not null
       and meal_id > 0
     order by day, id`) as any[];

  const live = (await sql`
    select meal_id, sort_order as slot, name, grams, locked
      from ingredients
     order by meal_id, sort_order`) as any[];

  const liveBy = new Map(
    live.map((r) => [
      `${Number(r.meal_id)}:${Number(r.slot)}`,
      { name: String(r.name), grams: Number(r.grams), locked: !!r.locked },
    ])
  );

  // Every value the log has for each position, in the order they were logged.
  const seen = new Map<string, number[]>();
  for (const r of rows) {
    const items = Array.isArray(r.items) ? r.items : [];
    const mealId = Number(r.meal_id);
    items.forEach((it: any, slot: number) => {
      const grams = Number(it?.grams);
      if (!Number.isFinite(grams) || grams <= 0) return;
      const key = `${mealId}:${slot}`;
      const now = liveBy.get(key);
      // Only where the food still matches. A log entry for an ingredient that
      // has since been renamed or replaced says nothing about the one there
      // now, and applying it would be worse than doing nothing.
      if (!now || String(it?.name ?? "") !== now.name) return;
      const list = seen.get(key) ?? [];
      list.push(grams);
      seen.set(key, list);
    });
  }

  const out: LogPortion[] = [];
  for (const [key, values] of seen) {
    const now = liveBy.get(key);
    if (!now || now.locked) continue; // locked portions never moved; leave them
    const [mealId, slot] = key.split(":").map(Number);
    const grams = consensus(values);
    const votes = values.filter((v) => Math.abs(v - grams) < 0.05).length;
    out.push({
      meal_id: mealId,
      slot,
      name: now.name,
      grams,
      votes,
      seen: values.length,
      values,
      locked: false,
    });
  }
  return out.sort((a, b) => a.meal_id - b.meal_id || a.slot - b.slot);
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
