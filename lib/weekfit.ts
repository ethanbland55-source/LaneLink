/**
 * Fitting the whole week in one go.
 *
 * The old model asked the wrong question. It fitted portions to one day type
 * at a time, which quietly assumes you can re-weigh breakfast depending on
 * whether there is a swim that evening. You can't: you cook on Sunday and eat
 * out of the same containers all week. Running it once per day type just meant
 * the last one you pressed won, and every other kind of day drifted — by 288
 * kcal on a swim day and 360 on a swim-and-gym day, in the plan that prompted
 * this rewrite.
 *
 * What is actually true is:
 *
 *   - **The portions are fixed.** One number per ingredient, all week.
 *   - **The menu is what changes.** Three meals on a rest day; the pre- and
 *     post-swim meals appear on any day with a swim; the post-gym one on any
 *     day with a gym session.
 *   - **Each kind of day has to land on its own target** with whatever is on
 *     the menu that day.
 *
 * So there is one fit, over every kind of day at once, weighted by how often
 * each comes round. Rest days set what breakfast, lunch and dinner have to
 * be; the gap up to a swim day is what the swim meals have to be; the gap up
 * to a swim-and-gym day is what the gym meal has to be. It all falls out of
 * one solve because it is genuinely one problem.
 *
 * The one thing the maths cannot know is how to divide a gap between two meals
 * that always appear together — dates before a swim and yoghurt after it add
 * up to a fixed number, but any split costs the same. That is what shares are
 * for.
 */

import {
  solveRows,
  type BoundedItem,
  type DayRow,
  type Mode,
  type ShareRule,
  type SolveResult,
} from "./optimise";
import { collapse, expand, type PlanMeal, type Slot } from "./batch";
import {
  WEEKDAYS,
  itemMacros,
  sumMacros,
  targetsFor,
  type Macros,
  type WeekPlan,
} from "./nutrition";
import { fixedMacros, type Supplement } from "./supplements";

export type { PlanMeal };

/** A meal is on the menu unless it has been limited to particular day types. */
export function appliesOn(meal: PlanMeal, dayTypeId: number, totalTypes: number): boolean {
  const ids = meal.day_type_ids;
  if (!ids || ids.length === 0 || ids.length >= totalTypes) return true;
  return ids.includes(dayTypeId);
}

/** How many times this meal is eaten on a day it appears on. */
export function repsOf(meal: PlanMeal): number {
  return Math.max(1, Math.round(Number(meal.times_per_day ?? 1)));
}

/**
 * Meals that appear on exactly the same days belong together.
 *
 * They rise and fall as a unit — nothing in the targets can distinguish them —
 * so they are the natural group for a share to divide.
 */
export function groupKey(meal: PlanMeal, totalTypes: number): string {
  const ids = meal.day_type_ids;
  if (!ids || ids.length === 0 || ids.length >= totalTypes) return "every day";
  return [...ids].sort((a, b) => a - b).join(",");
}

export type MealGroup = {
  key: string;
  /** The day types these meals appear on, or null for every day. */
  dayTypeIds: number[] | null;
  meals: PlanMeal[];
};

export function mealGroups(meals: PlanMeal[], totalTypes: number): MealGroup[] {
  const out = new Map<string, MealGroup>();
  for (const m of meals) {
    if (!m.ingredients.length) continue;
    const key = groupKey(m, totalTypes);
    const g = out.get(key);
    if (g) {
      g.meals.push(m);
      continue;
    }
    out.set(key, {
      key,
      dayTypeIds: key === "every day" ? null : key.split(",").map(Number),
      meals: [m],
    });
  }
  return [...out.values()];
}

/* ------------------------------------------------------------------ */
/* Building the problem                                                */
/* ------------------------------------------------------------------ */

export type WeekFit = {
  /** The meals the fit is actually over: food-bearing, recipe shares applied. */
  meals: PlanMeal[];
  items: BoundedItem[];
  slots: Slot[];
  rows: DayRow[];
  shares: ShareRule[];
  groups: MealGroup[];
  /** Day types that no weekday uses — fitted to nothing, reported separately. */
  unusedDayTypes: { id: number; name: string }[];
};

/**
 * Turn the plan into the problem the solver takes.
 *
 * Every meal contributes its portions once, because there is one of each. Each
 * kind of day contributes a row saying which of those portions are eaten on
 * it, and how heavily it counts — a day type used three times a week matters
 * three times as much as one used once.
 */
export function buildWeekFit(
  meals: PlanMeal[],
  plan: WeekPlan,
  supplements: Supplement[] = []
): WeekFit {
  // Recipe shares are applied before anything is collapsed, so the tray the
  // solver sees is the tray you asked for.
  const withFood = applyRecipeShares(meals.filter((m) => m.ingredients.length > 0));
  const { items, slots } = collapse(withFood);
  const totalTypes = plan.order.length;

  const daysUsing = new Map<number, number>();
  for (const d of WEEKDAYS) {
    const id = plan.week[d];
    daysUsing.set(id, (daysUsing.get(id) ?? 0) + 1);
  }

  const mealById = new Map(withFood.map((m) => [m.id, m]));

  const rows: DayRow[] = plan.order.map((id) => ({
    id,
    name: targetsFor(plan, id).name,
    weight: daysUsing.get(id) ?? 0,
    target: targetsFor(plan, id),
    counts: slots.map((slot) => {
      const meal = mealById.get(slot.mealId);
      if (!meal) return 0;
      return appliesOn(meal, id, totalTypes) ? repsOf(meal) : 0;
    }),
    // Supplements are a dose, not a portion: they count toward the day and the
    // fit fills what's left, rather than being shrunk to help it hit a number.
    fixed: fixedMacros(supplements, id, totalTypes),
  }));

  const groups = mealGroups(withFood, totalTypes);
  const varsByMeal = new Map<number, number[]>();
  slots.forEach((slot, i) => {
    const list = varsByMeal.get(slot.mealId) ?? [];
    list.push(i);
    varsByMeal.set(slot.mealId, list);
  });

  return {
    meals: withFood,
    items,
    slots,
    rows,
    shares: buildShares(groups, varsByMeal, withFood, slots),
    groups,
    unusedDayTypes: rows
      .filter((r) => r.weight === 0)
      .map((r) => ({ id: r.id, name: r.name })),
  };
}

/**
 * Turn the shares you typed into fractions that add to one.
 *
 * The ones you set are honoured, clamped so they can never between them claim
 * more than the whole. Anything you left blank divides what's left in the
 * proportion it is already in — so setting one number doesn't silently rewrite
 * the others, which is the behaviour that makes the boxes safe to touch.
 *
 * Returns null when you haven't set any, because a rule that only restates the
 * current split does nothing except slow the solver down.
 */
function wantedShares<T>(
  parts: T[],
  shareOf: (p: T) => number | null | undefined,
  kcalOf: (p: T) => number
): number[] | null {
  if (parts.length < 2) return null;
  if (!parts.some((p) => shareOf(p) != null)) return null;

  const want = new Array<number>(parts.length).fill(0);
  let claimed = 0;
  parts.forEach((p, i) => {
    const v = shareOf(p);
    if (v == null) return;
    want[i] = Math.min(1, Math.max(0, Number(v) / 100));
    claimed += want[i];
  });
  if (claimed > 1) {
    parts.forEach((_, i) => (want[i] /= claimed));
    claimed = 1;
  }

  const restIdx = parts.map((p, i) => (shareOf(p) == null ? i : -1)).filter((i) => i >= 0);
  const restKcal = restIdx.reduce((a, i) => a + kcalOf(parts[i]), 0);
  for (const i of restIdx) {
    want[i] =
      restKcal > 0 ? (1 - claimed) * (kcalOf(parts[i]) / restKcal) : (1 - claimed) / restIdx.length;
  }
  return want;
}

/**
 * Every share rule the solver should weigh.
 *
 * Two levels, the same idea at each:
 *
 *  - **Between meals** that appear on exactly the same days. They rise and
 *    fall together, so nothing in the day's targets can divide them.
 *  - **Between the ingredients of one meal.** Nothing in the targets says how
 *    much of a yoghurt bowl should be yoghurt either — the fit will happily
 *    make it two-thirds granola if the macros come out a shade closer, and
 *    that is not the bowl you wanted.
 *
 * Cooked-ahead meals are left out of the ingredient level on purpose: their
 * proportions are the recipe, fixed when you filled the tray, and are applied
 * directly rather than fitted. See `applyRecipeShares`.
 */
function buildShares(
  groups: MealGroup[],
  varsByMeal: Map<number, number[]>,
  meals: PlanMeal[],
  slots: Slot[]
): ShareRule[] {
  const rules: ShareRule[] = [];
  const mealKcal = (m: PlanMeal) => sumMacros(m.ingredients.map(itemMacros)).kcal * repsOf(m);

  // --- between meals that share their days ---
  for (const g of groups) {
    const want = wantedShares(g.meals, (m) => m.share_pct, mealKcal);
    if (!want) continue;
    rules.push({
      members: g.meals.map((m, i) => ({
        mealId: m.id,
        name: m.name,
        vars: varsByMeal.get(m.id) ?? [],
        reps: repsOf(m),
        want: want[i],
      })),
    });
  }

  // --- between the ingredients of one meal ---
  for (const meal of meals) {
    if (meal.batch) continue; // the recipe is the ratio; see applyRecipeShares

    const rows = meal.ingredients
      .map((it, index) => ({
        it,
        index,
        v: slots.findIndex((s) => s.kind === "item" && s.mealId === meal.id && s.index === index),
      }))
      .filter((r) => r.v >= 0);

    const want = wantedShares(
      rows,
      (r) => r.it.share_pct,
      (r) => itemMacros(r.it).kcal
    );
    if (!want) continue;

    rules.push({
      members: rows.map((r, i) => ({
        mealId: meal.id,
        name: `${meal.name} · ${r.it.name}`,
        vars: [r.v],
        reps: repsOf(meal),
        want: want[i],
      })),
    });
  }

  return rules;
}

/**
 * Ingredient shares on a cooked-ahead meal are the recipe, not a preference.
 *
 * A tray collapses to one variable because that is what it physically is —
 * you can serve more tray, not more of the chicken in it. So a share here
 * cannot be fitted; it has to be *applied*, by re-proportioning what goes in
 * before the tray is weighed. The tray stays the same size and the mix inside
 * it moves, which is exactly what you would do at the hob.
 */
export function applyRecipeShares(meals: PlanMeal[]): PlanMeal[] {
  return meals.map((meal) => {
    if (!meal.batch || meal.ingredients.length < 2) return meal;
    const want = wantedShares(
      meal.ingredients,
      (it) => it.share_pct,
      (it) => itemMacros(it).kcal
    );
    if (!want) return meal;

    const totalGrams = meal.ingredients.reduce((a, i) => a + (Number(i.grams) || 0), 0);
    const totalKcal = sumMacros(meal.ingredients.map(itemMacros)).kcal;
    if (totalGrams <= 0 || totalKcal <= 0) return meal;

    // Grams that would give each ingredient the calorie share asked for.
    const raw = meal.ingredients.map((it, i) => {
      const per = (Number(it.kcal_100) || 0) / 100;
      return per > 0 ? (want[i] * totalKcal) / per : Number(it.grams) || 0;
    });
    const rawTotal = raw.reduce((a, b) => a + b, 0);
    if (rawTotal <= 0) return meal;

    const k = totalGrams / rawTotal;
    return {
      ...meal,
      ingredients: meal.ingredients.map((it, i) => ({
        ...it,
        grams: Math.round(raw[i] * k * 10) / 10,
      })),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Solving                                                             */
/* ------------------------------------------------------------------ */

export type WeekFitResult = SolveResult & {
  /** The plan as it would be after applying. */
  meals: PlanMeal[];
  fit: WeekFit;
};

/** Fit the whole week and hand back the plan it produces. */
export function fitWeek(
  meals: PlanMeal[],
  plan: WeekPlan,
  opts: { mode?: Mode; continuous?: boolean; supplements?: Supplement[] } = {}
): WeekFitResult {
  const fit = buildWeekFit(meals, plan, opts.supplements);
  const res = solveRows(fit.items, fit.rows, {
    mode: opts.mode ?? "balanced",
    continuous: opts.continuous,
    shares: fit.shares,
  });

  // Expand over the same meals the fit was built on, so a batch whose recipe
  // shares moved its proportions keeps them.
  const fitted = expand(fit.meals, fit.slots, res.grams);
  const byId = new Map(fitted.map((m) => [m.id, m]));

  return {
    ...res,
    fit,
    meals: meals.map((m) => byId.get(m.id) ?? m),
  };
}

/* ------------------------------------------------------------------ */
/* Reading the plan as it stands                                       */
/* ------------------------------------------------------------------ */

export type DayStanding = {
  id: number;
  name: string;
  /** Weekdays using this kind of day. Zero means it is defined but unused. */
  days: number;
  target: Macros;
  planned: Macros;
  meals: string[];
};

/** What each kind of day adds up to right now, before any fitting. */
export function weekStanding(
  meals: PlanMeal[],
  plan: WeekPlan,
  supplements: Supplement[] = []
): DayStanding[] {
  const totalTypes = plan.order.length;
  const daysUsing = new Map<number, number>();
  for (const d of WEEKDAYS) {
    const id = plan.week[d];
    daysUsing.set(id, (daysUsing.get(id) ?? 0) + 1);
  }

  return plan.order.map((id) => {
    const on = meals.filter((m) => appliesOn(m, id, totalTypes));
    const food = sumMacros(
      on.flatMap((m) =>
        Array.from({ length: repsOf(m) }, () => sumMacros(m.ingredients.map(itemMacros)))
      )
    );
    const extra = fixedMacros(supplements, id, totalTypes);
    const planned: Macros = {
      kcal: food.kcal + extra.kcal,
      protein: food.protein + extra.protein,
      carbs: food.carbs + extra.carbs,
      fat: food.fat + extra.fat,
    };
    return {
      id,
      name: targetsFor(plan, id).name,
      days: daysUsing.get(id) ?? 0,
      target: targetsFor(plan, id),
      planned,
      meals: on.map((m) => m.name),
    };
  });
}

/** The weekly average of what the plan actually delivers, and of the targets. */
export function weeklyAverage(
  meals: PlanMeal[],
  plan: WeekPlan,
  supplements: Supplement[] = []
): { planned: Macros; target: Macros } {
  const standing = weekStanding(meals, plan, supplements);
  const planned: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  const target: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  let n = 0;
  for (const s of standing) {
    if (s.days <= 0) continue;
    n += s.days;
    for (const k of ["kcal", "protein", "carbs", "fat"] as const) {
      planned[k] += s.planned[k] * s.days;
      target[k] += s.target[k] * s.days;
    }
  }
  if (n > 0) {
    for (const k of ["kcal", "protein", "carbs", "fat"] as const) {
      planned[k] /= n;
      target[k] /= n;
    }
  }
  return { planned, target };
}
