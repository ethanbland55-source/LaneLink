/**
 * Re-fitting the portions to targets that have moved.
 *
 * The weekly review (lib/review.ts) moves the *targets*. On its own that
 * leaves the plan behind: the portions are still the ones fitted to last
 * month's numbers, so the targets say one thing and the food in the
 * containers says another. So the review re-fits as well, and stages the
 * result for roll day. Same solver the Rebalance button uses, same bounds,
 * same locks — nothing here is a second opinion about what a good plan is.
 *
 * This used to write straight to the plan on Monday morning. By then Sunday's
 * cooking was already in the fridge at last week's sizes and Saturday's shop
 * had bought for them, so the plan changed under food that had already been
 * made. Staged, the shopping list buys for the new portions and the cook on
 * Sunday night weighs them.
 *
 * It only ever touches gram amounts. Names, macros, bounds, locks, shares and
 * which days a meal appears on are all yours, and a re-fit that decided to
 * change one of those would be a re-fit you couldn't trust.
 */

import { sql } from "./db";
import { listPending, stagePortions } from "./pending";
import { buildWeekPlan, normaliseDayType, type DayType, type Profile } from "./nutrition";
import { fitWeek } from "./weekfit";
import type { PlanMeal } from "./batch";
import type { Supplement } from "./supplements";

/**
 * How far a single portion may move in one automatic re-fit, as a ratio.
 *
 * A guard, not a second solver. The bounds you set already keep portions
 * sane; this only catches something having gone wrong upstream — a mistyped
 * body fat figure, a target that moved by a third overnight — and then leaving
 * that one portion where it is is the right answer. Wide enough for the
 * recomposition cut, which can take a small portion like honey or mayonnaise
 * down to its lower bound in one go.
 */
export const MAX_MOVE = 0.5;

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
        prepped: !!i.prepped,
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
  userId: number,
  profile: Profile,
  applyOn: string
): Promise<{ staged: number } | null> {
  try {
    const waiting = await listPending(userId);
    if (!waiting.length) return null;

    const fitted = await fitFromDb(userId, profile, applyOn);
    if (!fitted) return null;

    const rows = fitted.meals.flatMap((m) =>
      (m.ingredients as any[]).map((it, slot) => ({
        meal_id: m.id,
        slot,
        name: String(it.name),
        grams: Math.round(Number(it.grams) * 10) / 10,
      }))
    );

    const staged = await stagePortions(
      userId,
      rows,
      applyOn,
      "Re-fitted after a settings change"
    );
    return { staged };
  } catch (e) {
    console.warn("re-staging skipped:", e);
    return null;
  }
}

/**
 * Load the plan out of the database and fit it. Shared by the two things that
 * want a fresh fit — the weekly review and a settings change — and both write
 * the result to what is staged, never to the plan in force.
 */
export async function fitFromDb(userId: number, profile: Profile, today?: string) {
  const [dtRows, mealRows, ingRows, supRows] = await Promise.all([
    sql`select * from day_types where user_id = ${userId} order by sort_order, id`,
    sql`select * from meals where user_id = ${userId} order by sort_order, id`,
    sql`select * from ingredients where user_id = ${userId} order by sort_order, id`,
    sql`select * from supplements where user_id = ${userId} order by sort_order, id`.catch(
      () => [] as Row[]
    ),
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
  // "keep_close", always, and even. A weekly review moves the targets by a
  // few percent, and a free fit is entitled to answer that by halving the
  // banana — same calories, different breakfast. Taking the same share off
  // every meal first, then letting the fit correct the macros from there, is
  // what makes an automatic re-fit safe to leave switched on.
  const res = fitWeek(meals, plan, { mode: "balanced", supplements, drift: "keep_close", even: true });
  return Object.assign(res, { input: meals });
}
