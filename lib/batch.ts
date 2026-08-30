/**
 * Batch cooking.
 *
 * If you cook every lunch and dinner for the week on a Sunday, the app's usual
 * assumption — that each ingredient's portion is yours to adjust, meal by meal
 * — is simply false. Once it's a tray of chicken, rice and broccoli in the
 * fridge, you cannot serve 12% more chicken on Saturday. You can only serve
 * more *tray*.
 *
 * So a batch-cooked meal is modelled as what it physically is: **one
 * ingredient, served by weight**. Its per-100g macros are the weighted average
 * of what went in, its portion is how much of the tray goes on the plate, and
 * the components come back out afterwards in the ratio they were cooked in.
 *
 * That falls out of the existing solver for free — a batch is one variable
 * instead of five — and it's why the answer stays realistic: the fit can make
 * Saturday's plate bigger without pretending you picked the chicken out of it.
 *
 * The pieces that *are* still free to move day to day are the ones you plate
 * fresh: the breakfast, the shake, the fruit. Which is exactly right.
 */

import { type BoundedItem } from "./optimise";
import {
  itemMacros,
  sumMacros,
  targetsFor,
  type Item,
  type Macros,
  type WeekPlan,
} from "./nutrition";
import { profileFor } from "./foods";

export type PlanMeal = {
  id: number;
  name: string;
  times_per_day?: number;
  day_type_ids?: number[] | null;
  /** Cooked ahead in one go, served by weight. */
  batch?: boolean;
  /**
   * Share of its group's calories, 0–100, or null to let the fit decide.
   *
   * Only meaningful where two or more meals appear on exactly the same days:
   * they rise and fall together, so nothing in the targets can say how to
   * divide them. This is where you say — 20% of the swim calories in the dates
   * beforehand, 80% in the yoghurt after.
   */
  share_pct?: number | null;
  ingredients: BoundedItem[];
};

/** Where a solved gram figure belongs when it comes back. */
export type Slot =
  | { kind: "batch"; mealId: number; ratios: number[]; baseTotal: number }
  | { kind: "item"; mealId: number; index: number };

export type Collapsed = { items: BoundedItem[]; slots: Slot[] };

/**
 * Fallback serving band when the components don't imply one.
 *
 * Wider than a single ingredient's band on purpose: a plate of mixed food is
 * far more elastic than a portion of olive oil, and you really can put half as
 * much or half again on it. It is still a plate, though — past this the answer
 * isn't a bigger serving, and the cook list says so rather than landing short.
 */
const DEFAULT_BAND: [number, number] = [0.65, 1.5];

/**
 * Turn a batch meal's ingredients into the single composite the solver sees.
 *
 * The serving band is derived from the components rather than invented: the
 * tray can only stretch as far as its tightest ingredient allows. That also
 * means locking anything inside a batch pins the whole serving, which is the
 * honest reading of "this much chicken, no more".
 */
function compositeFor(meal: PlanMeal): { item: BoundedItem; slot: Slot } | null {
  const ings = meal.ingredients.filter((i) => (Number(i.grams) || 0) > 0);
  if (ings.length === 0) return null;

  const baseTotal = ings.reduce((a, i) => a + (Number(i.grams) || 0), 0);
  const totals: Macros = sumMacros(ings.map(itemMacros));

  let lo = -Infinity;
  let hi = Infinity;
  let anyLocked = false;
  for (const i of ings) {
    const base = Number(i.grams) || 0;
    if (i.locked) anyLocked = true;
    if (base <= 0) continue;
    if (i.min_grams != null) lo = Math.max(lo, Number(i.min_grams) / base);
    if (i.max_grams != null) hi = Math.min(hi, Number(i.max_grams) / base);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) {
    [lo, hi] = DEFAULT_BAND;
  }

  const per100 = (v: number) => (baseTotal > 0 ? (v / baseTotal) * 100 : 0);

  return {
    item: {
      name: meal.name,
      grams: baseTotal,
      kcal_100: per100(totals.kcal),
      protein_100: per100(totals.protein),
      carbs_100: per100(totals.carbs),
      fat_100: per100(totals.fat),
      min_grams: Math.round(baseTotal * lo),
      max_grams: Math.round(baseTotal * hi),
      locked: anyLocked,
      // A tray is served by weight, whatever its components are called.
      no_unit: true,
    },
    slot: {
      kind: "batch",
      mealId: meal.id,
      ratios: meal.ingredients.map((i) =>
        baseTotal > 0 ? (Number(i.grams) || 0) / baseTotal : 0
      ),
      baseTotal,
    },
  };
}

export function collapse(meals: PlanMeal[]): Collapsed {
  const items: BoundedItem[] = [];
  const slots: Slot[] = [];

  for (const meal of meals) {
    if (meal.batch) {
      const c = compositeFor(meal);
      if (c) {
        items.push(c.item);
        slots.push(c.slot);
        continue;
      }
      // An empty batch meal has nothing to collapse; fall through.
    }
    meal.ingredients.forEach((it, index) => {
      items.push(it);
      slots.push({ kind: "item", mealId: meal.id, index });
    });
  }

  return { items, slots };
}

/** Put the solved figures back where they came from. */
export function expand(meals: PlanMeal[], slots: Slot[], grams: number[]): PlanMeal[] {
  const next = meals.map((m) => ({ ...m, ingredients: m.ingredients.map((i) => ({ ...i })) }));
  const byId = new Map(next.map((m) => [m.id, m]));

  slots.forEach((slot, i) => {
    const meal = byId.get(slot.mealId);
    if (!meal) return;
    const g = grams[i] ?? 0;
    if (slot.kind === "batch") {
      meal.ingredients.forEach((it, n) => {
        // Components keep the ratio they were cooked in; only the serving moves.
        it.grams = Math.round(g * (slot.ratios[n] ?? 0) * 10) / 10;
      });
    } else {
      const it = meal.ingredients[slot.index];
      if (it) it.grams = g;
    }
  });

  return next;
}

/** Total planned serving weight of a batch meal, as the plan stands. */
export function servingGrams(meal: PlanMeal): number {
  return meal.ingredients.reduce((a, i) => a + (Number(i.grams) || 0), 0);
}

/* ------------------------------------------------------------------ */
/* Serving size                                                        */
/* ------------------------------------------------------------------ */

function appliesOn(meal: PlanMeal, dayTypeId: number, total: number): boolean {
  const ids = meal.day_type_ids;
  if (!ids || ids.length === 0 || ids.length >= total) return true;
  return ids.includes(dayTypeId);
}

/**
 * A serving is a serving, whatever day it is.
 *
 * This used to re-solve per day type and hand back a different weight for each
 * — 380 g of tray on a rest day, 520 g on a double swim. It is a tidy idea and
 * it is not what happens in a kitchen: you portion the tray into containers on
 * Sunday, and on Thursday you take one out. Weighing a different amount off a
 * cooked tray every morning is not a plan, it is a chore nobody does.
 *
 * So the serving is fixed and the *menu* carries the difference between days,
 * which is what `lib/weekfit.ts` fits. The number on the kitchen scale, the
 * number on the cook list and the number the log expects are all this one.
 */

/* ------------------------------------------------------------------ */
/* The cook list                                                       */
/* ------------------------------------------------------------------ */

export type CookIngredient = {
  name: string;
  /** Raw amount to cook for the whole window. */
  grams: number;
  /** What it becomes once cooked, where that differs. */
  cookedGrams: number;
  rawToCooked: number;
};

export type BatchCook = {
  mealId: number;
  name: string;
  /** How many portions the window needs. */
  servings: number;
  /** Total weight of food to end up with. */
  totalGrams: number;
  /** Average portion, and the spread across the kinds of day. */
  averageServing: number;
  byDayType: { id: number; name: string; count: number; grams: number }[];
  ingredients: CookIngredient[];
};

export type CookPlan = {
  days: number;
  meals: BatchCook[];
  notes: string[];
};

/**
 * What to cook on shopping day, and how to portion it out afterwards.
 *
 * Walks the window day by day exactly as the shopping list does, so the two
 * always agree: what you buy is what you cook is what you eat.
 */
export function cookPlan(
  meals: PlanMeal[],
  plan: WeekPlan,
  opts: { days: number; dayTypeForDay: (index: number) => number }
): CookPlan {
  const batchMeals = meals.filter((m) => m.batch && m.ingredients.length > 0);
  const notes: string[] = [];
  if (batchMeals.length === 0) {
    return { days: opts.days, meals: [], notes };
  }

  const typeCount = plan.order.length;

  const out: BatchCook[] = batchMeals.map((meal) => {
    const serving = servingGrams(meal);
    const counts = new Map<number, number>();
    const reps = Math.max(1, Math.round(Number(meal.times_per_day ?? 1)));

    for (let d = 0; d < opts.days; d++) {
      const id = opts.dayTypeForDay(d);
      if (!appliesOn(meal, id, typeCount)) continue;
      counts.set(id, (counts.get(id) ?? 0) + reps);
    }

    const byDayType = plan.order
      .filter((id) => (counts.get(id) ?? 0) > 0)
      .map((id) => ({
        id,
        name: targetsFor(plan, id).name,
        count: counts.get(id) ?? 0,
        grams: serving,
      }));

    const totalGrams = byDayType.reduce((a, d) => a + d.count * d.grams, 0);
    const servingCount = byDayType.reduce((a, d) => a + d.count, 0);
    const base = servingGrams(meal) || 1;

    const ingredients: CookIngredient[] = meal.ingredients.map((it) => {
      const ratio = (Number(it.grams) || 0) / base;
      const grams = totalGrams * ratio;
      const p = profileFor(it.name, it);
      return {
        name: it.name,
        grams,
        cookedGrams: grams * p.rawToCooked,
        rawToCooked: p.rawToCooked,
      };
    });

    return {
      mealId: meal.id,
      name: meal.name,
      servings: servingCount,
      totalGrams,
      averageServing: servingCount > 0 ? totalGrams / servingCount : 0,
      byDayType,
      ingredients,
    };
  });

  // If everything you eat is cooked ahead, a big day can run out of road:
  // there is a limit to how much tray fits on a plate. The fix isn't a bigger
  // serving, it's a meal that only appears on those days — so say that rather
  // than quietly landing short.
  const short: string[] = [];
  for (const dayTypeId of plan.order) {
    const t = targetsFor(plan, dayTypeId);
    let planned = 0;
    for (const meal of meals) {
      if (!appliesOn(meal, dayTypeId, typeCount)) continue;
      const reps = Math.max(1, Math.round(Number(meal.times_per_day ?? 1)));
      const base = servingGrams(meal) || 1;
      const grams = base;
      const kcal = meal.ingredients.reduce((a, i) => a + itemMacros(i).kcal, 0);
      planned += reps * kcal * (grams / base);
    }
    if (t.kcal > 0 && planned > 0 && planned < t.kcal * 0.94) {
      short.push(`${t.name.toLowerCase()} (${Math.round(t.kcal - planned)} kcal short)`);
    }
  }
  if (short.length) {
    const scope =
      short.length >= plan.order.length && plan.order.length > 1
        ? `every kind of day — worst is ${short[short.length - 1]}`
        : short.join(", ");
    notes.push(
      `The cooked meals top out before they reach ${scope}. Serving more tray stops being the answer past a point — add a meal that only appears on those days, like a shake or a bagel, and the numbers close.`
    );
  }

  const bigDays = out.some((m) => m.byDayType.some((d) => d.grams > 800));
  if (bigDays) {
    notes.push(
      "Some servings are over 800 g. If that's more than fits on a plate, split the meal in two or move some of the calories into something you plate fresh."
    );
  }

  return { days: opts.days, meals: out, notes };
}

/** Weighted-average macros of one serving, for display. */
export function servingMacros(meal: PlanMeal, grams: number): Macros {
  const base = servingGrams(meal) || 1;
  const scale = grams / base;
  const totals = sumMacros(meal.ingredients.map(itemMacros));
  return {
    kcal: totals.kcal * scale,
    protein: totals.protein * scale,
    carbs: totals.carbs * scale,
    fat: totals.fat * scale,
  };
}

export type { Item };
