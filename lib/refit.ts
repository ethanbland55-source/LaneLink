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

    for (const w of writes) {
      await sql`update ingredients set grams = ${w.grams} where id = ${w.id}`;
    }

    return { changed: writes.length, held };
  } catch (e) {
    console.warn("weekly re-fit skipped:", e);
    return null;
  }
}
