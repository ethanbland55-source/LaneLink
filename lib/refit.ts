/**
 * Re-fitting the plan on roll day.
 *
 * The weekly roll snapshots your trend weight and your latest body fat figure,
 * which moves the *targets*. On its own that leaves the plan behind: the
 * portions are still the ones fitted to last month's numbers, so the targets
 * say one thing and the food in the containers says another, and the gap grows
 * every week until you happen to press Recalculate.
 *
 * So rolling now re-fits as well. Same solver the button uses, same bounds,
 * same locks — nothing here is a second opinion about what a good plan is, it
 * just runs the fit you would have run yourself.
 *
 * It only ever touches gram amounts. Names, macros, bounds, locks, shares and
 * which days a meal appears on are all yours, and a re-fit that decided to
 * change one of those would be a re-fit you couldn't trust.
 */

import { sql } from "./db";
import { snapshot } from "./history";
import { applyDuePortions, listPending, stagePortions } from "./pending";
import { buildWeekPlan, normaliseDayType, type DayType, type Profile } from "./nutrition";
import { fitWeek } from "./weekfit";
import type { PlanMeal } from "./batch";
import type { Supplement } from "./supplements";

/** How far a single portion may move in one automatic re-fit, as a ratio. */
const MAX_MOVE = 0.35;

type Row = Record<string, any>;

function toMeals(meals: Row[], ings: Row[]): PlanMeal[] {
  return meals.map((m) => ({
    id: Number(m.id),
    name: String(m.name),
    times_per_day: Number(m.times_per_day ?? 1),
    day_type_ids: (m.day_type_ids ?? null) as number[] | null,
    batch: !!m.batch,
    share_pct: m.share_pct == null ? null : Number(m.share_pct),
    ingredients: ings
      .filter((i) => Number(i.meal_id) === Number(m.id))
      .map((i) => ({
        // Carried through the fit so the write-back knows which row to update.
        id: Number(i.id),
        name: String(i.name),
        grams: Number(i.grams),
        kcal_100: Number(i.kcal_100),
        protein_100: Number(i.protein_100),
        carbs_100: Number(i.carbs_100),
        fat_100: Number(i.fat_100),
        min_grams: i.min_grams == null ? null : Number(i.min_grams),
        max_grams: i.max_grams == null ? null : Number(i.max_grams),
        share_pct: i.share_pct == null ? null : Number(i.share_pct),
        locked: !!i.locked,
      })) as any,
  }));
}

/**
 * Re-fit the change that is waiting for roll day, against targets that have
 * since moved.
 *
 * Staging writes the portions a fit produced *at the time you pressed it*. Then
 * you change a setting — fat per kg, protein, a session, your weight — and the
 * targets those portions were fitted to no longer exist. Nothing noticed. The
 * plan waiting for Monday was an answer to a question you had already changed,
 * and it would have come into force looking perfectly authoritative.
 *
 * So a settings change re-runs the fit and rewrites what is staged, keeping
 * the day it applies on. It anchors on the *live* portions rather than the
 * staged ones, because "keep it close" should mean close to the food you are
 * actually eating this week, not close to a draft of next week's — otherwise
 * two changes compound and you drift twice as far as you meant to.
 */
export async function restagePlan(
  profile: Profile,
  applyOn: string
): Promise<{ staged: number } | null> {
  try {
    const waiting = await listPending();
    if (!waiting.length) return null;

    const fitted = await fitFromDb(profile, applyOn);
    if (!fitted) return null;

    const rows = fitted.meals.flatMap((m) =>
      (m.ingredients as any[]).map((it, slot) => ({
        meal_id: m.id,
        slot,
        name: String(it.name),
        grams: Math.round(Number(it.grams) * 10) / 10,
      }))
    );

    const staged = await stagePortions(rows, applyOn, "Re-fitted after a settings change");
    return { staged };
  } catch (e) {
    console.warn("re-staging skipped:", e);
    return null;
  }
}

/**
 * Load the plan out of the database and fit it. Shared by the two things that
 * want a fresh fit — the weekly roll, which writes it to the plan, and a
 * settings change, which writes it to what is staged.
 */
async function fitFromDb(profile: Profile, today?: string) {
  const [dtRows, mealRows, ingRows, supRows] = await Promise.all([
    sql`select * from day_types order by sort_order, id`,
    sql`select * from meals order by sort_order, id`,
    sql`select * from ingredients order by sort_order, id`,
    sql`select * from supplements order by sort_order, id`.catch(() => [] as Row[]),
  ]);

  const dayTypes: DayType[] = (dtRows as Row[]).map((r, i) => normaliseDayType(r, i));
  const meals = toMeals(mealRows as Row[], ingRows as Row[]);
  if (!meals.length || !dayTypes.length) return null;

  const supplements = (supRows as Row[]).map((s) => ({
    ...s,
    id: Number(s.id),
    grams: Number(s.grams ?? 0),
  })) as unknown as Supplement[];

  const plan = buildWeekPlan(profile, dayTypes, today ? { today } : {});
  return fitWeek(meals, plan, { mode: "balanced", supplements, drift: "keep_close" });
}

export type RefitResult = {
  changed: number;
  /** Portions the guard refused to move, by name. */
  held: string[];
};

/**
 * Re-fit the stored plan against the current targets and write the new gram
 * amounts back.
 *
 * Deliberately quiet about failure. This runs off the back of a page load, and
 * a plan that didn't re-fit is last week's plan — which is the one you shopped
 * for and cooked, so it is a perfectly good thing to be left with. A page that
 * failed to load because the re-fit threw would be much worse.
 */
export async function refitPlan(profile: Profile, today?: string): Promise<RefitResult | null> {
  try {
    /**
     * A staged change beats a re-fit, and they land on the same day.
     *
     * Both of these fire on the first page load on or after roll day, and the
     * page fetches `/api/profile` and `/api/meals` in the same `Promise.all` —
     * so they run concurrently, and whichever finishes last wins. When the
     * re-fit won it silently overwrote the portions the staged change had just
     * applied, using grams it had read before they moved. That is the plan you
     * looked at, approved and pressed a button for, gone, with nothing to say
     * it ever happened.
     *
     * So the staged change goes first here, and if one came into force today —
     * whether this call applied it or the other request did a moment ago — the
     * re-fit stands down. It has nothing to add: a staged plan was already
     * fitted to these targets, by you, on purpose.
     */
    const day = today ?? new Date().toISOString().slice(0, 10);
    await applyDuePortions(day);
    const staged = (await sql`
      select 1 from portion_history
       where reason = 'staged change' and changed_on = ${day}::date
       limit 1`) as any[];
    if (staged.length) return null;

    const [dtRows, mealRows, ingRows, supRows] = await Promise.all([
      sql`select * from day_types order by sort_order, id`,
      sql`select * from meals order by sort_order, id`,
      sql`select * from ingredients order by sort_order, id`,
      sql`select * from supplements order by sort_order, id`.catch(() => [] as Row[]),
    ]);

    const dayTypes: DayType[] = (dtRows as Row[]).map((r, i) => normaliseDayType(r, i));
    const meals = toMeals(mealRows as Row[], ingRows as Row[]);
    if (!meals.length || !dayTypes.length) return null;

    const supplements = (supRows as Row[]).map((s) => ({
      ...s,
      id: Number(s.id),
      grams: Number(s.grams ?? 0),
    })) as unknown as Supplement[];

    const plan = buildWeekPlan(profile, dayTypes, today ? { today } : {});
    // "keep_close", always. A weekly roll moves the targets by a percent or
    // two, and a free fit is entitled to answer a 2 % change by halving the
    // banana — same calories, different breakfast, and you'd find out at 6am
    // on Monday. Spreading it is the only behaviour that makes an automatic
    // re-fit safe to leave switched on.
    const res = fitWeek(meals, plan, { mode: "balanced", supplements, drift: "keep_close" });

    const before = new Map<number, number>();
    for (const m of meals) {
      for (const i of m.ingredients as any[]) before.set(i.id, Number(i.grams));
    }

    /**
     * A guard, not a second solver. The bounds already keep portions sane, so
     * this only catches the case where something has gone wrong upstream — a
     * mistyped body fat figure, a target that moved by a third overnight — and
     * in that case doing nothing is the right answer, because you can still
     * press Recalculate and see it for yourself.
     */
    const writes: { id: number; grams: number }[] = [];
    const held: string[] = [];
    for (const m of res.meals) {
      for (const i of m.ingredients as any[]) {
        const was = before.get(i.id);
        if (was == null) continue;
        const now = Math.round(Number(i.grams) * 10) / 10;
        if (!Number.isFinite(now) || now <= 0) continue;
        if (Math.abs(now - was) < 0.5) continue;
        if (was > 0 && Math.abs(now - was) / was > MAX_MOVE) {
          held.push(i.name);
          continue;
        }
        writes.push({ id: i.id, grams: now });
      }
    }

    if (writes.length) {
      // What they were, before they stop being what they were. This runs
      // without anyone pressing anything, so "put it back" has to be an option
      // afterwards — otherwise you open the app on a Monday, find the numbers
      // have moved, and have no way to say that was fine as it was.
      await snapshot("weekly re-fit", today);

      // One statement rather than one per portion: an automatic rewrite that
      // can stop halfway leaves a plan that is half of each.
      await sql`
        update ingredients i
           set grams = v.grams
          from (select * from jsonb_to_recordset(${JSON.stringify(writes)}::jsonb)
                       as t(id int, grams numeric)) v
         where i.id = v.id`;
    }

    return { changed: writes.length, held };
  } catch (e) {
    console.warn("weekly re-fit skipped:", e);
    return null;
  }
}
