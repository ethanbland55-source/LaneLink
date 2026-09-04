/**
 * Shopping list.
 *
 * You shop once a week, Saturday to Saturday, and you want to walk in knowing
 * exactly how much of everything to put in the trolley. So: take the plan,
 * play it forward over however many days you're buying for, and add it all up.
 *
 * Three things make the difference between a sum and a usable list:
 *
 *  - **Day types matter.** Not because the portions change — they don't, the
 *    same containers come out of the same fridge — but because the *menu*
 *    does. A meal limited to swim days is bought for the swim days in the
 *    window and no others, so five bagels across a week rather than seven.
 *  - **You buy packets, not grams.** 1,340 g of chicken is three 500 g packs.
 *    The list rounds up to real pack sizes and tells you the leftover, and
 *    counts unit foods (eggs, wraps, bagels) in units.
 *  - **Fresh food doesn't last ten days.** Anything whose shelf life is
 *    shorter than the window gets flagged, with how much to buy now and how
 *    much to buy later — or freeze.
 */

import {
  AISLE_ORDER,
  ceilTo,
  profileFor,
  shoppingKey,
  type Aisle,
} from "./foods";
import {
  addDays,
  dayTypeIdFor,
  itemMacros,
  scaleMacros,
  sumMacros,
  targetsFor,
  totalFor,
  ZERO_MACROS,
  type Item,
  type Macros,
  type Profile,
  type WeekPlan,
} from "./nutrition";

export type PlanMeal = {
  id: number;
  name: string;
  /** How many times this meal is eaten on a day it applies to. */
  times_per_day?: number;
  /** Which day types it appears on, by id. Empty or omitted = every day. */
  day_type_ids?: number[] | null;
  ingredients: Item[];
};

export type PantryItem = { name: string; grams: number };

export type ShopLine = {
  key: string;
  name: string;
  aisle: Aisle;
  /** What the plan needs over the window, in grams as you'd weigh it. */
  needGrams: number;
  /** Already in the cupboard. */
  haveGrams: number;
  /** Still to buy, before pack rounding. */
  shortGrams: number;
  /** What you'll actually put in the trolley. */
  buyGrams: number;
  packGrams: number;
  packs: number;
  leftoverGrams: number;
  unit: { grams: number; name: string; count: number } | null;
  shelfDays: number;
  /**
   * Long-life, and you need much less than a packet — oil, honey, stock.
   * Almost certainly already in the cupboard, so it's a "check" not a "buy".
   */
  staple: boolean;
  /** More than one shop needed to keep it fresh. */
  trips: number;
  macros: Macros;
  meals: string[];
};

/**
 * Something about this list you should know before you set off.
 *
 * Split into a headline and the rest on purpose: the title is what gets read
 * in a supermarket doorway, and everything that justifies it can wait until
 * someone taps for it.
 */
export type ShopWarning = {
  title: string;
  detail?: string;
  /** The reasoning, behind a disclosure. */
  more?: string;
};

export type ShopList = {
  days: number;
  startDay: string;
  endDay: string;
  /** How many of each day type fell in the window, by day-type id. */
  dayTypeCounts: Record<number, number>;
  /**
   * Those counts as something you can read, with how each day type's meals
   * compare to that day's target.
   */
  dayMix: { id: number; name: string; count: number; planned: number; target: number }[];
  lines: ShopLine[];
  byAisle: { aisle: Aisle; lines: ShopLine[]; kg: number }[];
  totals: Macros;
  perDay: Macros;
  totalKg: number;
  warnings: ShopWarning[];
};

/** Does this meal appear on this kind of day? */
export function appliesOn(meal: PlanMeal, dayTypeId: number, total: number): boolean {
  const ids = meal.day_type_ids;
  if (!ids || ids.length === 0 || ids.length >= total) return true;
  return ids.includes(dayTypeId);
}

/**
 * Walk the window one day at a time and total up every gram of every
 * ingredient that is on that day's menu.
 */
export function buildShoppingList(
  meals: PlanMeal[],
  profile: Profile,
  plan: WeekPlan,
  opts: { days?: number; startDay: string; pantry?: PantryItem[] } = { startDay: "" }
): ShopList {
  const days = Math.max(1, Math.round(opts.days ?? profile.shop_days ?? 7));
  const startDay = opts.startDay;
  const typeCount = plan.order.length;

  /**
   * What the plan actually comes to on each kind of day.
   *
   * The list buys the plan as written — it does not quietly scale portions up
   * to meet a target, because a bigger day is meant to be handled by the meals
   * you've put on it, and scaling on top of that would count the difference
   * twice. If a day type's meals don't add up to its target, that's worth
   * knowing before you shop, so it becomes a warning rather than a silent fix.
   */
  const plannedFor = new Map<number, number>();
  for (const id of plan.order) {
    plannedFor.set(
      id,
      meals
        .filter((m) => appliesOn(m, id, typeCount))
        .reduce(
          (a, m) => a + totalFor(m.ingredients).kcal * Math.max(0, Number(m.times_per_day ?? 1)),
          0
        )
    );
  }

  const pantry = new Map<string, number>();
  for (const p of opts.pantry ?? []) {
    const k = shoppingKey(p.name);
    pantry.set(k, (pantry.get(k) ?? 0) + (Number(p.grams) || 0));
  }

  type Acc = {
    key: string;
    name: string;
    grams: number;
    sample: Item;
    meals: Set<string>;
  };
  const acc = new Map<string, Acc>();
  const dayTypeCounts: Record<number, number> = {};

  for (let d = 0; d < days; d++) {
    const date = addDays(startDay, d);
    const id = dayTypeIdFor(plan, date);
    dayTypeCounts[id] = (dayTypeCounts[id] ?? 0) + 1;

    for (const meal of meals) {
      if (!appliesOn(meal, id, typeCount)) continue;
      const reps = Math.max(0, Number(meal.times_per_day ?? 1));
      if (reps === 0) continue;

      for (const it of meal.ingredients) {
        const grams = (Number(it.grams) || 0) * reps;
        if (grams <= 0) continue;
        const key = shoppingKey(it.name);
        const cur = acc.get(key);
        if (cur) {
          cur.grams += grams;
          cur.meals.add(meal.name);
        } else {
          acc.set(key, {
            key,
            name: it.name.trim() || "Ingredient",
            grams,
            sample: it,
            meals: new Set([meal.name]),
          });
        }
      }
    }
  }

  const lines: ShopLine[] = [...acc.values()].map((a) => {
    const p = profileFor(a.name, a.sample);
    const need = a.grams;
    const have = pantry.get(a.key) ?? 0;
    const short = Math.max(0, need - have);

    const packGrams = Math.max(1, p.packGrams);
    // The epsilon stops 735 g of banana ÷ 105 g becoming eight bananas.
    const packs = short > 0 ? Math.ceil(short / packGrams - 1e-9) : 0;
    const buy = packs * packGrams;
    const staple = p.shelfDays >= 180 && need < packGrams * 0.5;

    const trips = p.shelfDays >= days ? 1 : Math.ceil(days / Math.max(1, p.shelfDays));

    return {
      key: a.key,
      name: a.name,
      aisle: p.aisle,
      needGrams: need,
      haveGrams: have,
      shortGrams: short,
      buyGrams: buy,
      packGrams,
      packs,
      leftoverGrams: Math.max(0, buy - short),
      unit: p.unitGrams
        ? {
            grams: p.unitGrams,
            name: p.unitName ?? "unit",
            count: Math.ceil(short / p.unitGrams - 1e-9),
          }
        : null,
      shelfDays: p.shelfDays,
      staple,
      trips,
      macros: itemMacros({ ...a.sample, grams: need }),
      meals: [...a.meals],
    };
  });

  lines.sort((a, b) => {
    const ai = AISLE_ORDER.indexOf(a.aisle) - AISLE_ORDER.indexOf(b.aisle);
    if (ai !== 0) return ai;
    // Things you're definitely buying first, cupboard staples at the bottom.
    if (a.staple !== b.staple) return a.staple ? 1 : -1;
    return b.needGrams - a.needGrams;
  });

  const byAisle = AISLE_ORDER.map((aisle) => {
    const ls = lines.filter((l) => l.aisle === aisle);
    return { aisle, lines: ls, kg: ls.reduce((s, l) => s + l.needGrams, 0) / 1000 };
  }).filter((g) => g.lines.length > 0);

  const totals = sumMacros(lines.map((l) => l.macros));
  const totalKg = lines.reduce((s, l) => s + l.needGrams, 0) / 1000;

  const dayMix = plan.order
    .filter((id) => (dayTypeCounts[id] ?? 0) > 0)
    .map((id) => ({
      id,
      name: targetsFor(plan, id).name,
      count: dayTypeCounts[id],
      planned: Math.round(plannedFor.get(id) ?? 0),
      target: targetsFor(plan, id).kcal,
    }));

  const warnings: ShopWarning[] = [];

  const mismatched = dayMix.filter(
    (d) => d.planned > 0 && Math.abs(d.planned - d.target) > Math.max(120, d.target * 0.06)
  );
  if (mismatched.length) {
    const worst = [...mismatched].sort(
      (a, b) => Math.abs(b.planned - b.target) - Math.abs(a.planned - a.target)
    )[0];
    const gap = worst.planned - worst.target;
    const scope =
      mismatched.length >= dayMix.length && dayMix.length > 1
        ? "every kind of day"
        : mismatched.length === 1
          ? `${worst.name.toLowerCase()} days`
          : `${mismatched.length} of your day types`;
    warnings.push({
      title:
        `The plan is off target on ${scope} — ${worst.name.toLowerCase()} by ` +
        `${Math.abs(gap).toLocaleString()} kcal ${gap > 0 ? "over" : "under"}`,
      detail: "This list buys it exactly as written.",
      more:
        `${worst.planned.toLocaleString()} against ${worst.target.toLocaleString()}. ` +
        `Rebalance the week on the Plan page first, or add a meal that only appears on those days.`,
    });
  }
  const fresh = lines.filter((l) => l.trips > 1);
  if (fresh.length) {
    warnings.push({
      title: `${fresh.length} item${fresh.length === 1 ? "" : "s"} won't keep for ${days} days`,
      detail: fresh
        .slice(0, 4)
        .map((l) => l.name.toLowerCase())
        .join(", ") + (fresh.length > 4 ? "…" : ""),
      more: "Freeze the surplus, or split the shop into two trips.",
    });
  }
  const heavy = totalKg / days;
  if (heavy > 3.5) {
    warnings.push({
      title: `That's ${heavy.toFixed(1)} kg of food a day`,
      detail: "Worth checking the plan isn't double-counting a meal.",
    });
  }
  if (!meals.length) warnings.push({ title: "No meals in the plan yet, so there's nothing to buy." });

  return {
    days,
    startDay,
    endDay: addDays(startDay, days - 1),
    dayTypeCounts,
    dayMix,
    lines,
    byAisle,
    totals,
    perDay: scaleMacros(totals, 1 / days),
    totalKg,
    warnings,
  };
}

/** Plain text, for pasting into notes or a message. */
export function shopListText(list: ShopList): string {
  const out: string[] = [];
  out.push(`Shopping list — ${list.days} days (${list.startDay} to ${list.endDay})`);
  out.push("");
  for (const group of list.byAisle) {
    out.push(group.aisle.toUpperCase());
    for (const l of group.lines) {
      const amount = l.unit
        ? `${l.unit.count} ${l.unit.name}${l.unit.count === 1 ? "" : "s"}`
        : l.buyGrams >= 1000
          ? `${(l.buyGrams / 1000).toFixed(l.buyGrams % 1000 === 0 ? 0 : 2)} kg`
          : `${Math.round(l.buyGrams)} g`;
      const have = l.haveGrams > 0 ? ` (have ${Math.round(l.haveGrams)} g)` : "";
      const note = l.staple ? " — check you have it" : "";
      out.push(`  [ ] ${l.name} — ${amount}${have}${note}`);
    }
    out.push("");
  }
  if (list.warnings.length) {
    out.push("NOTES");
    for (const w of list.warnings) {
      out.push(`  - ${w.title}${w.detail ? ` — ${w.detail}` : ""}`);
    }
  }
  return out.join("\n");
}

export const EMPTY_LIST: ShopList = {
  days: 7,
  startDay: "",
  endDay: "",
  dayTypeCounts: {},
  dayMix: [],
  lines: [],
  byAisle: [],
  totals: { ...ZERO_MACROS },
  perDay: { ...ZERO_MACROS },
  totalKg: 0,
  warnings: [],
};

export { ceilTo };
