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
 *  - **Fibre and volume** participate: a fibre floor, and an optional mode
 *    that prefers the more filling of two equally accurate plans.
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
 * Anchor, fibre and volume are *tie-breakers*, not objectives. They are
 * weighted far below the macro terms on purpose: among answers that are
 * equally accurate they pick the one that looks like your plan, carries more
 * fibre and fills you up more — but none of them is ever allowed to buy that
 * at the cost of missing a macro.
 */
const ANCHOR_WEIGHT = 0.004;
const FIBRE_WEIGHT = 0.06;
const VOLUME_WEIGHT = 0.02;

export type Density = {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
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
    fibre: (Number(it.fibre_100) || 0) / 100,
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
    out.fibre += d.fibre * g;
  });
  return out;
}

function fillOf(ds: Density[], grams: number[]): number {
  let v = 0;
  for (let i = 0; i < ds.length; i++) v += ds[i].fill * (grams[i] || 0);
  return v;
}

/* ------------------------------------------------------------------ */
/* Cost                                                                */
/* ------------------------------------------------------------------ */

type Ctx = {
  ds: Density[];
  anchor: number[];
  target: Macros;
  pen: Record<MacroKey, Penalty>;
  mode: Mode;
  fillRef: number;
};

function macroCost(ctx: Ctx, t: Macros): number {
  let f = 0;
  for (const k of KEYS) {
    const g = ctx.target[k];
    if (!g) continue;
    const rel = (t[k] - g) / g;
    const p = ctx.pen[k];
    f += p.w * (rel > 0 ? p.over : p.under) * rel * rel;
  }
  const ft = ctx.target.fibre;
  if (ft > 0 && t.fibre < ft) {
    const rel = (t.fibre - ft) / ft;
    f += FIBRE_WEIGHT * rel * rel;
  }
  return f;
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

function totalCost(ctx: Ctx, grams: number[]): number {
  const t = totalsOf2(ctx.ds, grams);
  let f = macroCost(ctx, t) + anchorCost(ctx, grams);
  if (ctx.mode === "volume" && ctx.fillRef > 0) {
    f -= VOLUME_WEIGHT * (fillOf(ctx.ds, grams) / ctx.fillRef);
  }
  return f;
}

function totalsOf2(ds: Density[], grams: number[]): Macros {
  const out: Macros = { ...ZERO_MACROS };
  for (let i = 0; i < ds.length; i++) {
    const g = grams[i] || 0;
    out.kcal += ds[i].kcal * g;
    out.protein += ds[i].protein * g;
    out.carbs += ds[i].carbs * g;
    out.fat += ds[i].fat * g;
    out.fibre += ds[i].fibre * g;
  }
  return out;
}

/**
 * Cost as a function of one portion, with everything else held still.
 * Evaluated in O(1) from the running totals rather than re-summing the day.
 */
function costAlong(ctx: Ctx, base: Macros, i: number, x: number, grams: number[]): number {
  const d = ctx.ds[i];
  const t: Macros = {
    kcal: base.kcal + d.kcal * x,
    protein: base.protein + d.protein * x,
    carbs: base.carbs + d.carbs * x,
    fat: base.fat + d.fat * x,
    fibre: base.fibre + d.fibre * x,
  };
  let f = macroCost(ctx, t);

  // anchor, only the term that moves
  const a = ctx.anchor[i];
  let anch = 0;
  let n = 0;
  for (let j = 0; j < grams.length; j++) if (ctx.anchor[j]) n++;
  if (a && n) {
    const rel = (x - a) / a;
    anch = (ANCHOR_WEIGHT * rel * rel) / n;
    for (let j = 0; j < grams.length; j++) {
      if (j === i || !ctx.anchor[j]) continue;
      const r = (grams[j] - ctx.anchor[j]) / ctx.anchor[j];
      anch += (ANCHOR_WEIGHT * r * r) / n;
    }
  }
  f += anch;

  if (ctx.mode === "volume" && ctx.fillRef > 0) {
    let v = d.fill * x;
    for (let j = 0; j < grams.length; j++) if (j !== i) v += ctx.ds[j].fill * (grams[j] || 0);
    f -= VOLUME_WEIGHT * (v / ctx.fillRef);
  }
  return f;
}

/** Ternary search — the 1-D slice is convex, so this finds the true minimum. */
function minimiseAlong(ctx: Ctx, base: Macros, i: number, b: Bounds, grams: number[]): number {
  let lo = b.min;
  let hi = b.max;
  if (hi - lo < 1e-9) return lo;
  for (let k = 0; k < 60; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (costAlong(ctx, base, i, m1, grams) <= costAlong(ctx, base, i, m2, grams)) hi = m2;
    else lo = m1;
    if (hi - lo < 1e-4) break;
  }
  return (lo + hi) / 2;
}

/* ------------------------------------------------------------------ */
/* Feasibility                                                         */
/* ------------------------------------------------------------------ */

export type Feasible = { min: Macros; max: Macros };

/** The macro range the bounds physically allow. */
export function feasibleRange(items: BoundedItem[]): Feasible {
  const min: Macros = { ...ZERO_MACROS };
  const max: Macros = { ...ZERO_MACROS };
  items.forEach((it) => {
    const d = density(it);
    const b = boundsFor(it);
    (["kcal", "protein", "carbs", "fat", "fibre"] as const).forEach((k) => {
      const per = d[k];
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
};

/**
 * When a macro can't reach its target, work out whose limit is in the way.
 *
 * For each ingredient pinned against a bound in the unhelpful direction, ask:
 * how far would this bound have to move to close the gap on its own, and is
 * that a sane amount of food? Rank by the least disruptive fix.
 */
export function suggestFixes(
  items: BoundedItem[],
  grams: number[],
  target: Macros,
  after: Macros
): Suggestion[] {
  const out: Suggestion[] = [];

  for (const key of KEYS) {
    const gap = target[key] - after[key];
    if (Math.abs(gap) < Math.max(2, target[key] * 0.02)) continue;
    const wantMore = gap > 0;

    items.forEach((it, i) => {
      if (it.locked) return;
      const d = density(it);
      const per = d[key];
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
      });
    });
  }

  // Cheapest fix first: the smallest change to a limit.
  return out
    .sort((a, b) => Math.abs(a.to - a.from) - Math.abs(b.to - b.from))
    .slice(0, 4);
}

/* ------------------------------------------------------------------ */
/* Solve                                                               */
/* ------------------------------------------------------------------ */

export type OptimiseResult = {
  grams: number[];
  before: Macros;
  after: Macros;
  cost: number;
  residual: Record<MacroKey, number>;
  hit: Record<MacroKey, boolean>;
  constrained: boolean;
  binding: number[];
  feasible: Feasible;
  unreachable: { key: MacroKey; by: number }[];
  suggestions: Suggestion[];
  /** Sum of satiety-weighted volume, and the same for the original plan. */
  fill: { before: number; after: number };
};

export type Options = {
  mode?: Mode;
  /** Skip the discrete snap — used by the accuracy tests. */
  continuous?: boolean;
};

export function optimisePortions(
  items: BoundedItem[],
  target: Macros,
  opts: Options = {}
): OptimiseResult {
  const mode: Mode = opts.mode ?? "balanced";
  const start = items.map((i) => Math.max(0, Number(i.grams) || 0));
  const before = totalsOf(items, start);

  if (items.length === 0) {
    return {
      grams: [],
      before,
      after: before,
      cost: 0,
      residual: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
      hit: { kcal: true, protein: true, carbs: true, fat: true },
      constrained: false,
      binding: [],
      feasible: { min: { ...ZERO_MACROS }, max: { ...ZERO_MACROS } },
      unreachable: [],
      suggestions: [],
      fill: { before: 0, after: 0 },
    };
  }

  const ds = items.map(density);
  const bounds = items.map(boundsFor);
  const ctx: Ctx = {
    ds,
    anchor: start.slice(),
    target,
    pen: PENALTIES[mode],
    mode,
    fillRef: Math.max(1, fillOf(ds, start)),
  };

  const project = (x: number[]) =>
    x.map((v, i) => Math.min(bounds[i].max, Math.max(bounds[i].min, v)));

  // --- Several starting points, because the discrete pass afterwards is what
  // --- actually decides the answer and it is sensitive to where it begins.
  const kcalNow = before.kcal || 1;
  const scale = target.kcal / kcalNow;
  const starts: number[][] = [
    project(start),
    project(start.map((v) => v * scale)),
    project(bounds.map((b) => (b.min + b.max) / 2)),
    project(start.map((v, i) => (ds[i].protein > ds[i].fat ? v * 1.2 : v * 0.85))),
  ];

  let best: number[] | null = null;
  let bestCost = Infinity;

  for (const s of starts) {
    let x = s.slice();
    let prev = totalCost(ctx, x);

    for (let sweep = 0; sweep < 60; sweep++) {
      for (let i = 0; i < x.length; i++) {
        if (items[i].locked) continue;
        const b = bounds[i];
        if (b.max - b.min < 1e-9) continue;

        // running totals with i removed
        const base: Macros = { ...ZERO_MACROS };
        for (let j = 0; j < x.length; j++) {
          if (j === i) continue;
          const g = x[j];
          base.kcal += ds[j].kcal * g;
          base.protein += ds[j].protein * g;
          base.carbs += ds[j].carbs * g;
          base.fat += ds[j].fat * g;
          base.fibre += ds[j].fibre * g;
        }
        x[i] = minimiseAlong(ctx, base, i, b, x);
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

  if (!opts.continuous) {
    x = discretise(ctx, items, bounds, x);
  }

  const after = totalsOf(items, x);
  const residual = {
    kcal: after.kcal - target.kcal,
    protein: after.protein - target.protein,
    carbs: after.carbs - target.carbs,
    fat: after.fat - target.fat,
  };
  const tol = (k: MacroKey) => Math.max(2, target[k] * 0.02);
  const hit = {
    kcal: Math.abs(residual.kcal) <= tol("kcal"),
    protein: Math.abs(residual.protein) <= tol("protein"),
    carbs: Math.abs(residual.carbs) <= tol("carbs"),
    fat: Math.abs(residual.fat) <= tol("fat"),
  };

  const binding = x
    .map((v, i) =>
      !items[i].locked && (v <= bounds[i].min + 1e-6 || v >= bounds[i].max - 1e-6) ? i : -1
    )
    .filter((i) => i >= 0);

  const feasible = feasibleRange(items);
  const unreachable = KEYS.flatMap((k) => {
    if (target[k] > feasible.max[k]) return [{ key: k, by: target[k] - feasible.max[k] }];
    if (target[k] < feasible.min[k]) return [{ key: k, by: target[k] - feasible.min[k] }];
    return [];
  });

  return {
    grams: x,
    before,
    after,
    cost: totalCost(ctx, x),
    residual,
    hit,
    constrained: binding.length > 0,
    binding,
    feasible,
    unreachable,
    suggestions: suggestFixes(items, x, target, after),
    fill: { before: fillOf(ds, start), after: fillOf(ds, x) },
  };
}

/**
 * Snap to amounts you can actually weigh, then win back what that cost.
 *
 * Single-portion nudges plateau quickly — one portion can't move without
 * breaking calories. Pairwise moves (one up, one down) get off that plateau,
 * and they're what closes the last few grams.
 */
function discretise(
  ctx: Ctx,
  items: BoundedItem[],
  bounds: Bounds[],
  xIn: number[]
): number[] {
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
