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
export function buildWeekFit(meals: PlanMeal[], plan: WeekPlan): WeekFit {
  const withFood = meals.filter((m) => m.ingredients.length > 0);
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
  }));

  const groups = mealGroups(withFood, totalTypes);
  const varsByMeal = new Map<number, number[]>();
  slots.forEach((slot, i) => {
    const list = varsByMeal.get(slot.mealId) ?? [];
    list.push(i);
    varsByMeal.set(slot.mealId, list);
  });

  return {
    items,
    slots,
    rows,
    shares: buildShares(groups, varsByMeal),
    groups,
    unusedDayTypes: rows
      .filter((r) => r.weight === 0)
      .map((r) => ({ id: r.id, name: r.name })),
  };
}

/**
 * Turn the shares you typed into a rule the solver can weigh.
 *
 * A share only means anything where two or more meals come and go together, so
 * groups of one are skipped. Where you have set some shares but not all, the
 * ones you set are honoured and the rest divide what's left in the proportion
 * they are already in — so setting one number doesn't silently rewrite the
 * others.
 */
function buildShares(groups: MealGroup[], varsByMeal: Map<number, number[]>): ShareRule[] {
  const rules: ShareRule[] = [];

  for (const g of groups) {
    if (g.meals.length < 2) continue;
    const stated = g.meals.filter((m) => m.share_pct != null);
    if (!stated.length) continue;

    const kcalOf = (m: PlanMeal) => sumMacros(m.ingredients.map(itemMacros)).kcal * repsOf(m);

    // Your figures first, clamped so they can never claim more than the whole.
    let claimed = 0;
    const want = new Map<number, number>();
    for (const m of stated) {
      const f = Math.min(1, Math.max(0, Number(m.share_pct) / 100));
      want.set(m.id, f);
      claimed += f;
    }
    if (claimed > 1) {
      for (const m of stated) want.set(m.id, (want.get(m.id) ?? 0) / claimed);
      claimed = 1;
    }

    const rest = g.meals.filter((m) => m.share_pct == null);
    const restKcal = rest.reduce((a, m) => a + kcalOf(m), 0);
    for (const m of rest) {
      want.set(m.id, restKcal > 0 ? (1 - claimed) * (kcalOf(m) / restKcal) : (1 - claimed) / rest.length);
    }

    rules.push({
      members: g.meals.map((m) => ({
        mealId: m.id,
        name: m.name,
        vars: varsByMeal.get(m.id) ?? [],
        reps: repsOf(m),
        want: want.get(m.id) ?? 0,
      })),
    });
  }

  return rules;
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
  opts: { mode?: Mode; continuous?: boolean } = {}
): WeekFitResult {
  const fit = buildWeekFit(meals, plan);
  const res = solveRows(fit.items, fit.rows, {
    mode: opts.mode ?? "balanced",
    continuous: opts.continuous,
    shares: fit.shares,
  });

  const withFood = meals.filter((m) => m.ingredients.length > 0);
  const fitted = expand(withFood, fit.slots, res.grams);
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
export function weekStanding(meals: PlanMeal[], plan: WeekPlan): DayStanding[] {
  const totalTypes = plan.order.length;
  const daysUsing = new Map<number, number>();
  for (const d of WEEKDAYS) {
    const id = plan.week[d];
    daysUsing.set(id, (daysUsing.get(id) ?? 0) + 1);
  }

  return plan.order.map((id) => {
    const on = meals.filter((m) => appliesOn(m, id, totalTypes));
    const planned = sumMacros(
      on.flatMap((m) =>
        Array.from({ length: repsOf(m) }, () => sumMacros(m.ingredients.map(itemMacros)))
      )
    );
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
  plan: WeekPlan
): { planned: Macros; target: Macros } {
  const standing = weekStanding(meals, plan);
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
