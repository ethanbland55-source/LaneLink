/**
 * Portion optimiser.
 *
 * Same job as before — given per-100g macros and a target, find the gram
 * amounts that land closest — but it now knows considerably more about food
 * and solves the problem properly rather than sliding downhill and hoping.
 *
 * What's different:
 *
 *  - **Bounds come from the food knowledge base.** Rather than a blind
 *    60%–150% band on everything, olive oil gets ±20%, courgette gets
 *    −50%/+160%, and eggs move in whole eggs. You can still set your own
 *    limits and lock anything, and your numbers always win.
 *  - **Asymmetric penalties.** Missing protein low is worse than overshooting
 *    it; going over calories is worse than going under when you're cutting.
 *    The old symmetric squared error treated those the same.
 *  - **Exact coordinate descent, multi-start.** For a fixed set of other
 *    portions the cost is a one-dimensional convex function of each portion,
 *    so we can solve each coordinate to its exact optimum by ternary search
 *    instead of taking gradient steps. Run from several starting points and
 *    keep the best. This is what closes the last few calories that projected
 *    gradient descent used to leave on the table.
 *  - **A pairwise discrete pass.** After snapping to weighable amounts, a
 *    single portion often can't move without making things worse, while
 *    moving *two* in opposite directions helps. That plateau is exactly where
 *    the old polish pass stopped.
 *  - **An anchor term.** Among equally good answers it prefers the one that
 *    looks most like the plan you wrote, so re-running it doesn't reshuffle
 *    your whole day for a 3-calorie gain.
 *  - **Volume participates**: an optional mode that prefers the more filling
 *    of two equally accurate plans.
 *  - **It explains itself.** When the target can't be reached, it works out
 *    which limit is in the way and what to change it to.
 */

import { smartBounds, profileFor, roundTo } from "./foods";
import type { Item, Macros } from "./nutrition";
import { ZERO_MACROS } from "./nutrition";

export type MacroKey = "kcal" | "protein" | "carbs" | "fat";

export const KEYS: MacroKey[] = ["kcal", "protein", "carbs", "fat"];

export type BoundedItem = Item & {
  min_grams?: number | null;
  max_grams?: number | null;
  locked?: boolean;
  /**
   * Suppress whole-unit snapping. Set on a composite that stands in for a
   * cooked batch: a tray called "Bagel & eggs" is served by weight, and must
   * not inherit the bagel's "whole units only" rule.
   */
  no_unit?: boolean;
};

export type Mode = "balanced" | "protein_first" | "calories_exact" | "volume";

export const MODES: { value: Mode; label: string; blurb: string }[] = [
  {
    value: "balanced",
    label: "Balanced",
    blurb: "All four macros matter, protein most.",
  },
  {
    value: "protein_first",
    label: "Protein first",
    blurb: "Hit protein exactly, let the rest float.",
  },
  {
    value: "calories_exact",
    label: "Calories exact",
    blurb: "Land the kcal number, then balance the split.",
  },
  {
    value: "volume",
    label: "Most food",
    blurb: "Of the accurate answers, pick the most filling.",
  },
];

/** Weight, and how much worse it is to be over vs under, per macro. */
type Penalty = { w: number; over: number; under: number };

const PENALTIES: Record<Mode, Record<MacroKey, Penalty>> = {
  balanced: {
    kcal: { w: 1.0, over: 1.25, under: 1.0 },
    protein: { w: 1.6, over: 0.85, under: 2.2 },
    carbs: { w: 0.55, over: 1.0, under: 1.0 },
    fat: { w: 0.6, over: 1.1, under: 0.9 },
  },
  protein_first: {
    kcal: { w: 0.7, over: 1.2, under: 1.0 },
    protein: { w: 4.0, over: 0.8, under: 3.0 },
    carbs: { w: 0.4, over: 1.0, under: 1.0 },
    fat: { w: 0.4, over: 1.1, under: 0.9 },
  },
  calories_exact: {
    kcal: { w: 5.0, over: 1.3, under: 1.2 },
    protein: { w: 1.4, over: 0.85, under: 2.0 },
    carbs: { w: 0.5, over: 1.0, under: 1.0 },
    fat: { w: 0.5, over: 1.0, under: 1.0 },
  },
  volume: {
    kcal: { w: 1.0, over: 1.4, under: 0.9 },
    protein: { w: 1.6, over: 0.85, under: 2.2 },
    carbs: { w: 0.5, over: 1.0, under: 1.0 },
    fat: { w: 0.6, over: 1.15, under: 0.85 },
  },
};

/**
 * Anchor and volume are *tie-breakers*, not objectives. They are weighted far
 * below the macro terms on purpose: among answers that are equally accurate
 * they pick the one that looks like your plan and fills you up more — but
 * neither is ever allowed to buy that at the cost of missing a macro.
 */
const ANCHOR_WEIGHT = 0.004;
const VOLUME_WEIGHT = 0.02;

export type Density = {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Fullness contribution per gram — satiety × plate volume. */
  fill: number;
};

/** Per-gram contribution of one ingredient. */
export function density(it: Item): Density {
  const p = profileFor(it.name, it);
  return {
    kcal: (Number(it.kcal_100) || 0) / 100,
    protein: (Number(it.protein_100) || 0) / 100,
    carbs: (Number(it.carbs_100) || 0) / 100,
    fat: (Number(it.fat_100) || 0) / 100,
    fill: (p.spec.satiety * p.mlPerG) / 100,
  };
}

export type Bounds = { min: number; max: number; step: number; unit: number | null };

/**
 * The range this portion may move in. An explicit limit you typed always
 * wins; otherwise the food knowledge base picks one that suits the food.
 */
/**
 * The weighing step for an ingredient.
 *
 * The class has an opinion (you don't measure spinach to the gram), but the
 * real constraint is calories: a step that moves the day by more than about
 * 8 kcal is a step that stops the fit landing. So we take the coarsest step
 * the class allows that still costs less than that — which lands on 1 g for
 * oil and nut butter, and 10 g for leaves.
 */
export function stepFor(it: Item, classStep: number): number {
  const kcalPerG = (Number(it.kcal_100) || 0) / 100;
  const ladder = [25, 10, 5, 2, 1].filter((s) => s <= Math.max(1, classStep));
  for (const s of ladder) {
    if (s * kcalPerG <= 8) return s;
  }
  return 1;
}

export function boundsFor(it: BoundedItem): Bounds {
  const g = Math.max(0, Number(it.grams) || 0);
  const smart = smartBounds(it.name, g, it);
  const unit = it.no_unit ? null : smart.unit;
  const step = unit ?? stepFor(it, smart.profile.spec.step);

  if (it.locked) return { min: g, max: g, step, unit };

  const min = it.min_grams != null ? Math.max(0, Number(it.min_grams)) : smart.min;
  const max = it.max_grams != null ? Math.max(0, Number(it.max_grams)) : smart.max;

  return { min: Math.min(min, max), max: Math.max(min, max), step, unit };
}

/** True when the food only makes sense in whole units (eggs, wraps, scoops). */
export function unitOf(it: BoundedItem): { grams: number; name: string } | null {
  if (it.no_unit) return null;
  const p = profileFor(it.name, it);
  return p.unitGrams ? { grams: p.unitGrams, name: p.unitName ?? "unit" } : null;
}

export function totalsOf(items: Item[], grams: number[]): Macros {
  const out: Macros = { ...ZERO_MACROS };
  items.forEach((it, i) => {
    const d = density(it);
    const g = grams[i] || 0;
    out.kcal += d.kcal * g;
    out.protein += d.protein * g;
    out.carbs += d.carbs * g;
    out.fat += d.fat * g;
  });
  return out;
}

function fillOf(ds: Density[], grams: number[]): number {
  let v = 0;
  for (let i = 0; i < ds.length; i++) v += ds[i].fill * (grams[i] || 0);
  return v;
}

/* ------------------------------------------------------------------ */
/* The problem                                                         */
/* ------------------------------------------------------------------ */

/**
 * One kind of day that the same set of portions has to satisfy.
 *
 * This is the thing that changed. Portions used to be fitted against a single
 * target, one day type at a time — which is fine until the same breakfast has
 * to work on a rest day *and* a training day. It can't be re-weighed on
 * Tuesday because you cooked it on Sunday, so fitting each day separately just
 * means the last one you ran wins and every other day quietly drifts.
 *
 * So the portions are fitted against every kind of day at once. `counts` says
 * how many times each portion is eaten on this kind of day — zero when that
 * meal isn't on the menu — and `weight` is how many weekdays actually use it,
 * so the days that come round most often pull hardest.
 */
export type DayRow = {
  id: number;
  name: string;
  weight: number;
  target: Macros;
  counts: number[];
};

/**
 * How a group of meals divides its calories between them.
 *
 * Part of this problem is genuinely underdetermined. If dates before a swim
 * and yoghurt after it are the only two meals on swim days, the fit knows what
 * the pair must add up to, but nothing tells it the split — 90/10 costs
 * exactly the same as 20/80. Left alone the solver picks whichever is nearest
 * the plan already written, which is how a handful of dates ends up carrying
 * half the session's calories.
 *
 * A share rule says what the split should be. It is a soft term, so it gives
 * way when the macros need it to, but among answers the macros can't tell
 * apart it picks yours.
 */
export type ShareRule = {
  /** Meals in the group: which portions they own, and the share they want. */
  members: { mealId: number; name: string; vars: number[]; reps: number; want: number }[];
};

/**
 * How hard a share pulls.
 *
 * A share exists to break a tie the macros cannot break, so it must be strong
 * enough to choose the split and weak enough never to buy it with accuracy.
 * Swept against the real plan. Below about 0.05 a 20/80 share barely moves the
 * split; above about 1.0 it will buy the split with 100 kcal a day, which is
 * not a trade anyone asked for. At 0.3 the split moves as far as the portion
 * limits allow and the mean daily miss *improves* — pinning the degenerate
 * direction leaves the solver a better-posed problem than it had before.
 *
 * When the share still can't be met it is because a portion is against a
 * limit, and `ShareOutcome.blocked` says so rather than leaving you to wonder.
 */
const SHARE_WEIGHT = 0.3;

type Ctx = {
  ds: Density[];
  anchor: number[];
  rows: DayRow[];
  /** Sum of row weights, so the macro term is a weighted mean and not a sum. */
  totalWeight: number;
  shares: ShareRule[];
  pen: Record<MacroKey, Penalty>;
  mode: Mode;
  fillRef: number;
};

/* ------------------------------------------------------------------ */
/* Cost                                                                */
/* ------------------------------------------------------------------ */

function macroCost(ctx: Ctx, target: Macros, t: Macros): number {
  let f = 0;
  for (const k of KEYS) {
    const g = target[k];
    if (!g) continue;
    const rel = (t[k] - g) / g;
    const p = ctx.pen[k];
    f += p.w * (rel > 0 ? p.over : p.under) * rel * rel;
  }
  return f;
}

/** Totals for one kind of day: each portion counted as often as it is eaten. */
function rowTotals(ctx: Ctx, row: DayRow, grams: number[]): Macros {
  const out: Macros = { ...ZERO_MACROS };
  for (let i = 0; i < ctx.ds.length; i++) {
    const n = row.counts[i];
    if (!n) continue;
    const g = (grams[i] || 0) * n;
    out.kcal += ctx.ds[i].kcal * g;
    out.protein += ctx.ds[i].protein * g;
    out.carbs += ctx.ds[i].carbs * g;
    out.fat += ctx.ds[i].fat * g;
  }
  return out;
}

function anchorCost(ctx: Ctx, grams: number[]): number {
  let f = 0;
  let n = 0;
  for (let i = 0; i < grams.length; i++) {
    const a = ctx.anchor[i];
    if (!a) continue;
    const rel = (grams[i] - a) / a;
    f += rel * rel;
    n++;
  }
  return n ? (ANCHOR_WEIGHT * f) / n : 0;
}

/** Calories one meal contributes to a day it appears on. */
function memberKcal(ctx: Ctx, m: ShareRule["members"][number], grams: number[]): number {
  let k = 0;
  for (const i of m.vars) k += ctx.ds[i].kcal * (grams[i] || 0);
  return k * m.reps;
}

function shareCost(ctx: Ctx, grams: number[]): number {
  let f = 0;
  for (const rule of ctx.shares) {
    const ks = rule.members.map((m) => memberKcal(ctx, m, grams));
    const total = ks.reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    for (let i = 0; i < ks.length; i++) {
      const rel = ks[i] / total - rule.members[i].want;
      f += SHARE_WEIGHT * rel * rel;
    }
  }
  return f;
}

function totalCost(ctx: Ctx, grams: number[]): number {
  let f = 0;
  for (const row of ctx.rows) {
    f += (row.weight / ctx.totalWeight) * macroCost(ctx, row.target, rowTotals(ctx, row, grams));
  }
  f += anchorCost(ctx, grams) + shareCost(ctx, grams);
  if (ctx.mode === "volume" && ctx.fillRef > 0) {
    f -= VOLUME_WEIGHT * (fillOf(ctx.ds, grams) / ctx.fillRef);
  }
  return f;
}

/**
 * Cost as a function of one portion, with everything else held still.
 *
 * `bases` holds each day's totals with portion `i` removed, so moving it is an
 * O(rows) update rather than re-summing the whole week.
 */
function costAlong(ctx: Ctx, bases: Macros[], i: number, x: number, grams: number[]): number {
  const d = ctx.ds[i];
  let f = 0;

  for (let r = 0; r < ctx.rows.length; r++) {
    const row = ctx.rows[r];
    const n = row.counts[i] || 0;
    const b = bases[r];
    const g = x * n;
    const t: Macros = {
      kcal: b.kcal + d.kcal * g,
      protein: b.protein + d.protein * g,
      carbs: b.carbs + d.carbs * g,
      fat: b.fat + d.fat * g,
    };
    f += (row.weight / ctx.totalWeight) * macroCost(ctx, row.target, t);
  }

  // Anchor and shares both read the whole vector, so swap the value in and out.
  const held = grams[i];
  grams[i] = x;
  f += anchorCost(ctx, grams) + shareCost(ctx, grams);
  if (ctx.mode === "volume" && ctx.fillRef > 0) {
    f -= VOLUME_WEIGHT * (fillOf(ctx.ds, grams) / ctx.fillRef);
  }
  grams[i] = held;

  return f;
}

/** Ternary search — the 1-D slice is convex, so this finds the true minimum. */
function minimiseAlong(ctx: Ctx, bases: Macros[], i: number, b: Bounds, grams: number[]): number {
  let lo = b.min;
  let hi = b.max;
  if (hi - lo < 1e-9) return lo;
  for (let k = 0; k < 60; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (costAlong(ctx, bases, i, m1, grams) <= costAlong(ctx, bases, i, m2, grams)) hi = m2;
    else lo = m1;
    if (hi - lo < 1e-4) break;
  }
  return (lo + hi) / 2;
}

/** Each day's totals with portion `i` taken out. */
function basesWithout(ctx: Ctx, i: number, grams: number[]): Macros[] {
  return ctx.rows.map((row) => {
    const out: Macros = { ...ZERO_MACROS };
    for (let j = 0; j < ctx.ds.length; j++) {
      if (j === i) continue;
      const n = row.counts[j];
      if (!n) continue;
      const g = (grams[j] || 0) * n;
      out.kcal += ctx.ds[j].kcal * g;
      out.protein += ctx.ds[j].protein * g;
      out.carbs += ctx.ds[j].carbs * g;
      out.fat += ctx.ds[j].fat * g;
    }
    return out;
  });
}

/* ------------------------------------------------------------------ */
/* Feasibility                                                         */
/* ------------------------------------------------------------------ */

export type Feasible = { min: Macros; max: Macros };

/** The macro range the bounds physically allow, for one kind of day. */
export function feasibleRange(items: BoundedItem[], counts?: number[]): Feasible {
  const min: Macros = { ...ZERO_MACROS };
  const max: Macros = { ...ZERO_MACROS };
  items.forEach((it, i) => {
    const n = counts ? counts[i] ?? 0 : 1;
    if (!n) return;
    const d = density(it);
    const b = boundsFor(it);
    (["kcal", "protein", "carbs", "fat"] as const).forEach((k) => {
      const per = d[k] * n;
      min[k] += per * (per >= 0 ? b.min : b.max);
      max[k] += per * (per >= 0 ? b.max : b.min);
    });
  });
  return { min, max };
}

export type Suggestion = {
  index: number;
  name: string;
  key: MacroKey;
  /** Direction the limit needs to move. */
  direction: "up" | "down";
  from: number;
  to: number;
  /** How much of the shortfall this one change would close, in macro units. */
  closes: number;
  /** Which kind of day it would fix, when there is more than one. */
  dayName?: string;
};

/**
 * When a macro cannot reach its target, work out whose limit is in the way.
 *
 * For each ingredient pinned against a bound in the unhelpful direction, ask:
 * how far would this bound have to move to close the gap on its own, and is
 * that a sane amount of food? Rank by the least disruptive fix.
 */
export function suggestFixes(
  items: BoundedItem[],
  grams: number[],
  target: Macros,
  after: Macros,
  opts: { counts?: number[]; dayName?: string } = {}
): Suggestion[] {
  const out: Suggestion[] = [];

  for (const key of KEYS) {
    const gap = target[key] - after[key];
    if (Math.abs(gap) < Math.max(2, target[key] * 0.02)) continue;
    const wantMore = gap > 0;

    items.forEach((it, i) => {
      if (it.locked) return;
      const n = opts.counts ? opts.counts[i] ?? 0 : 1;
      if (!n) return;
      const per = density(it)[key] * n;
      if (per <= 1e-6) return;
      const b = boundsFor(it);
      const at = grams[i];
      const pinned = wantMore ? at >= b.max - 1e-6 : at <= b.min + 1e-6;
      if (!pinned) return;

      const need = Math.abs(gap) / per; // grams of this food to close it alone
      const to = wantMore ? b.max + need : Math.max(0, b.min - need);

      // Only suggest it if the new limit is still a portion of food, not a bucket.
      const plausible = wantMore ? to <= b.max * 2.2 + 40 : to >= b.min * 0.35;
      if (!plausible) return;

      out.push({
        index: i,
        name: it.name,
        key,
        direction: wantMore ? "up" : "down",
        from: wantMore ? b.max : b.min,
        to: Math.round(to),
        closes: Math.abs(gap),
        dayName: opts.dayName,
      });
    });
  }

  // Cheapest fix first: the smallest change to a limit.
  return out.sort((a, b) => Math.abs(a.to - a.from) - Math.abs(b.to - b.from)).slice(0, 4);
}

/* ------------------------------------------------------------------ */
/* Solve                                                               */
/* ------------------------------------------------------------------ */

export type DayResult = {
  id: number;
  name: string;
  weight: number;
  target: Macros;
  before: Macros;
  after: Macros;
  residual: Record<MacroKey, number>;
  hit: Record<MacroKey, boolean>;
  feasible: Feasible;
  unreachable: { key: MacroKey; by: number }[];
};

export type SolveResult = {
  grams: number[];
  days: DayResult[];
  /** Every day averaged by how often it comes round, which is what a week is. */
  weekly: { target: Macros; before: Macros; after: Macros };
  binding: number[];
  suggestions: Suggestion[];
  shares: ShareOutcome[];
  fill: { before: number; after: number };
};

/**
 * What actually happened to a share, and why.
 *
 * A share you asked for and did not get is not a failure to report quietly:
 * it always means a portion limit is in the way, and the fix is a number you
 * can change. `blocked` says which end, and `suggestGrams` is what that limit
 * would have to become.
 */
export type ShareOutcome = {
  mealId: number;
  name: string;
  want: number;
  got: number;
  blocked: "min" | "max" | null;
  /** Total grams this meal would need for the share you asked for. */
  suggestGrams: number | null;
};

export type Options = {
  mode?: Mode;
  /** Skip the discrete snap — used by the accuracy tests. */
  continuous?: boolean;
  /** How each group of meals should divide its calories. */
  shares?: ShareRule[];
};

const emptyMacros = (): Macros => ({ ...ZERO_MACROS });

function tolerance(target: Macros, k: MacroKey): number {
  return Math.max(2, target[k] * 0.02);
}

/**
 * Fit one set of portions to every kind of day at once.
 *
 * The portions are the unknowns and there is exactly one of each, because
 * there is exactly one of each in the fridge. What varies from day to day is
 * which meals are on the menu, and that is what `rows` describes.
 */
export function solveRows(items: BoundedItem[], rows: DayRow[], opts: Options = {}): SolveResult {
  const mode: Mode = opts.mode ?? "balanced";
  const start = items.map((i) => Math.max(0, Number(i.grams) || 0));
  const ds = items.map(density);
  const bounds = items.map(boundsFor);

  // A day type nobody has put in the week is not a day you eat, and fitting to
  // it would drag every shared portion toward a meal that never happens.
  const live = rows.filter((r) => r.weight > 0);
  const usable = live.length ? live : rows;

  if (items.length === 0 || usable.length === 0) {
    return {
      grams: start,
      days: [],
      weekly: { target: emptyMacros(), before: emptyMacros(), after: emptyMacros() },
      binding: [],
      suggestions: [],
      shares: [],
      fill: { before: 0, after: 0 },
    };
  }

  const ctx: Ctx = {
    ds,
    anchor: start.slice(),
    rows: usable,
    totalWeight: usable.reduce((a, r) => a + r.weight, 0) || 1,
    shares: opts.shares ?? [],
    pen: PENALTIES[mode],
    mode,
    fillRef: Math.max(1, fillOf(ds, start)),
  };

  const project = (x: number[]) =>
    x.map((v, i) => Math.min(bounds[i].max, Math.max(bounds[i].min, v)));

  // --- Several starting points, because the discrete pass afterwards is what
  // --- actually decides the answer and it is sensitive to where it begins.
  const heaviest = usable.reduce((a, r) => (r.weight > a.weight ? r : a), usable[0]);
  const nowKcal = rowTotals(ctx, heaviest, start).kcal || 1;
  const scale = heaviest.target.kcal / nowKcal;
  const starts: number[][] = [
    project(start),
    project(start.map((v) => v * scale)),
    project(bounds.map((b) => (b.min + b.max) / 2)),
    project(start.map((v, i) => (ds[i].protein > ds[i].fat ? v * 1.2 : v * 0.85))),
  ];

  let best: number[] | null = null;
  let bestCost = Infinity;

  for (const s of starts) {
    const x = s.slice();
    let prev = totalCost(ctx, x);

    for (let sweep = 0; sweep < 60; sweep++) {
      for (let i = 0; i < x.length; i++) {
        if (items[i].locked) continue;
        const b = bounds[i];
        if (b.max - b.min < 1e-9) continue;
        x[i] = minimiseAlong(ctx, basesWithout(ctx, i, x), i, b, x);
      }
      const now = totalCost(ctx, x);
      if (prev - now < 1e-10) break;
      prev = now;
    }

    const c = totalCost(ctx, x);
    if (c < bestCost) {
      bestCost = c;
      best = x;
    }
  }

  let x = best ?? project(start);
  if (!opts.continuous) x = discretise(ctx, items, bounds, x);

  // --- Results, day by day ------------------------------------------------
  const days: DayResult[] = rows.map((row) => {
    const before = rowTotals(ctx, row, start);
    const after = rowTotals(ctx, row, x);
    const residual = {
      kcal: after.kcal - row.target.kcal,
      protein: after.protein - row.target.protein,
      carbs: after.carbs - row.target.carbs,
      fat: after.fat - row.target.fat,
    };
    const feasible = feasibleRange(items, row.counts);
    return {
      id: row.id,
      name: row.name,
      weight: row.weight,
      target: row.target,
      before,
      after,
      residual,
      hit: {
        kcal: Math.abs(residual.kcal) <= tolerance(row.target, "kcal"),
        protein: Math.abs(residual.protein) <= tolerance(row.target, "protein"),
        carbs: Math.abs(residual.carbs) <= tolerance(row.target, "carbs"),
        fat: Math.abs(residual.fat) <= tolerance(row.target, "fat"),
      },
      feasible,
      unreachable: KEYS.flatMap((k) => {
        if (row.target[k] > feasible.max[k])
          return [{ key: k, by: row.target[k] - feasible.max[k] }];
        if (row.target[k] < feasible.min[k])
          return [{ key: k, by: row.target[k] - feasible.min[k] }];
        return [];
      }),
    };
  });

  // --- The week, averaged by how often each kind of day comes round -------
  const weekly = { target: emptyMacros(), before: emptyMacros(), after: emptyMacros() };
  let wsum = 0;
  for (const d of days) {
    if (d.weight <= 0) continue;
    wsum += d.weight;
    for (const k of KEYS) {
      weekly.target[k] += d.target[k] * d.weight;
      weekly.before[k] += d.before[k] * d.weight;
      weekly.after[k] += d.after[k] * d.weight;
    }
  }
  if (wsum > 0) {
    for (const k of KEYS) {
      weekly.target[k] /= wsum;
      weekly.before[k] /= wsum;
      weekly.after[k] /= wsum;
    }
  }

  const binding = x
    .map((v, i) =>
      !items[i].locked && (v <= bounds[i].min + 1e-6 || v >= bounds[i].max - 1e-6) ? i : -1
    )
    .filter((i) => i >= 0);

  // Explain the day that came out worst, which is the one worth fixing.
  const worst = days
    .filter((d) => d.weight > 0)
    .sort(
      (a, b) =>
        Math.abs(b.residual.kcal) / Math.max(1, b.target.kcal) -
        Math.abs(a.residual.kcal) / Math.max(1, a.target.kcal)
    )[0];

  const suggestions = worst
    ? suggestFixes(items, x, worst.target, worst.after, {
        counts: rows.find((r) => r.id === worst.id)?.counts,
        dayName: days.filter((d) => d.weight > 0).length > 1 ? worst.name : undefined,
      })
    : [];

  const shares: ShareOutcome[] = ctx.shares.flatMap((rule) => {
    const ks = rule.members.map((m) => memberKcal(ctx, m, x));
    const total = ks.reduce((a, b) => a + b, 0);
    return rule.members.map((m, i) => {
      const got = total > 0 ? ks[i] / total : 0;
      const off = got - m.want;
      const free = m.vars.filter((v) => !items[v].locked);

      // A share only misses because something is pinned. Too big a share means
      // its portions are on their minimums; too small, on their maximums.
      const allAt = (end: "min" | "max") =>
        free.length > 0 &&
        free.every((v) =>
          end === "min" ? x[v] <= bounds[v].min + 1e-6 : x[v] >= bounds[v].max - 1e-6
        );

      let blocked: "min" | "max" | null = null;
      if (Math.abs(off) > 0.02) {
        if (off > 0 && allAt("min")) blocked = "min";
        else if (off < 0 && allAt("max")) blocked = "max";
      }

      const nowGrams = m.vars.reduce((a, v) => a + x[v], 0);
      const suggestGrams =
        blocked && ks[i] > 0
          ? Math.round((nowGrams * (m.want * total)) / ks[i])
          : null;

      return { mealId: m.mealId, name: m.name, want: m.want, got, blocked, suggestGrams };
    });
  });

  return {
    grams: x,
    days,
    weekly,
    binding,
    suggestions,
    shares,
    fill: { before: fillOf(ds, start), after: fillOf(ds, x) },
  };
}

export type OptimiseResult = {
  grams: number[];
  before: Macros;
  after: Macros;
  residual: Record<MacroKey, number>;
  hit: Record<MacroKey, boolean>;
  constrained: boolean;
  binding: number[];
  feasible: Feasible;
  unreachable: { key: MacroKey; by: number }[];
  suggestions: Suggestion[];
  fill: { before: number; after: number };
};

/**
 * Fit one set of portions to one target — the single-day case, which is still
 * what the shopping list and the log want.
 */
export function optimisePortions(
  items: BoundedItem[],
  target: Macros,
  opts: Options = {}
): OptimiseResult {
  const row: DayRow = { id: 0, name: "", weight: 1, target, counts: items.map(() => 1) };
  const res = solveRows(items, [row], opts);
  const day = res.days[0];

  if (!day) {
    const before = totalsOf(
      items,
      items.map((i) => Math.max(0, Number(i.grams) || 0))
    );
    return {
      grams: res.grams,
      before,
      after: before,
      residual: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
      hit: { kcal: true, protein: true, carbs: true, fat: true },
      constrained: false,
      binding: [],
      feasible: { min: emptyMacros(), max: emptyMacros() },
      unreachable: [],
      suggestions: [],
      fill: res.fill,
    };
  }

  return {
    grams: res.grams,
    before: day.before,
    after: day.after,
    residual: day.residual,
    hit: day.hit,
    constrained: res.binding.length > 0,
    binding: res.binding,
    feasible: day.feasible,
    unreachable: day.unreachable,
    suggestions: res.suggestions,
    fill: res.fill,
  };
}

/**
 * Snap to amounts you can actually weigh, then win back what that cost.
 *
 * Single-portion nudges plateau quickly — one portion cannot move without
 * breaking calories. Pairwise moves (one up, one down) get off that plateau,
 * and they are what closes the last few grams.
 */
function discretise(ctx: Ctx, items: BoundedItem[], bounds: Bounds[], xIn: number[]): number[] {
  const snap = (v: number, i: number) => {
    const b = bounds[i];
    const s = b.unit ?? b.step;
    const r = b.unit ? Math.max(b.unit, roundTo(v, b.unit)) : roundTo(v, s);
    return Math.min(b.max, Math.max(b.min, r));
  };

  let x = xIn.map((v, i) => (items[i].locked ? v : snap(v, i)));
  let cur = totalCost(ctx, x);

  const stepOf = (i: number) => bounds[i].unit ?? bounds[i].step;
  const within = (v: number, i: number) => v >= bounds[i].min - 1e-6 && v <= bounds[i].max + 1e-6;

  for (let pass = 0; pass < 40; pass++) {
    let improved = false;

    // single moves, up to two steps
    for (let i = 0; i < x.length; i++) {
      if (items[i].locked) continue;
      const s = stepOf(i);
      for (const dlt of [s, -s, 2 * s, -2 * s]) {
        const v = x[i] + dlt;
        if (!within(v, i)) continue;
        const trial = x.slice();
        trial[i] = v;
        const c = totalCost(ctx, trial);
        if (c < cur - 1e-12) {
          x = trial;
          cur = c;
          improved = true;
        }
      }
    }

    // pairwise: one up, one down
    for (let i = 0; i < x.length; i++) {
      if (items[i].locked) continue;
      for (let j = 0; j < x.length; j++) {
        if (i === j || items[j].locked) continue;
        const si = stepOf(i);
        const sj = stepOf(j);
        for (const [a, b] of [
          [si, -sj],
          [-si, sj],
        ] as const) {
          const vi = x[i] + a;
          const vj = x[j] + b;
          if (!within(vi, i) || !within(vj, j)) continue;
          const trial = x.slice();
          trial[i] = vi;
          trial[j] = vj;
          const c = totalCost(ctx, trial);
          if (c < cur - 1e-12) {
            x = trial;
            cur = c;
            improved = true;
          }
        }
      }
    }

    if (!improved) break;
  }

  return x;
}

/* ------------------------------------------------------------------ */
/* Drift                                                               */
/* ------------------------------------------------------------------ */

/**
 * Is the plan far enough off target to actually matter?
 *
 * ~100 kcal/day is roughly 0.4 kg of fat a month — the point where drift
 * stops being noise and starts changing the outcome.
 */
export const DRIFT = { kcal: 100, protein: 10, carbs: 25, fat: 12 };

export function offTarget(plan: Macros, target: Macros): null | MacroKey[] {
  const off = KEYS.filter((k) => Math.abs(plan[k] - target[k]) > DRIFT[k]);
  return off.length ? off : null;
}
