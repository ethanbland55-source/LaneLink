/**
 * The previous release's optimiser, kept only as the baseline for
 * bench/compare.ts. Nothing in the app imports it.
 */
/**
 * Portion optimiser.
 *
 * Given a set of ingredients (each with per-100g macros and a current gram
 * amount) and a daily macro target, find the gram amounts that land closest to
 * the target — without producing portions nobody would actually eat.
 *
 * Realism comes from anchoring: every ingredient's allowed range defaults to a
 * band around the portion you already wrote down (60%–150%). If your plan says
 * 110 g pasta, the optimiser can reach 165 g but never 500 g. You can tighten,
 * widen or lock any individual range, and a locked ingredient never moves.
 *
 * The maths is a bounded least-squares fit solved by projected gradient
 * descent with backtracking, then a discrete polish pass that snaps every
 * amount to a weighable step (1 g or 5 g) without giving the accuracy back.
 */

import type { Item, Macros } from "../lib/nutrition";

export type MacroKey = "kcal" | "protein" | "carbs" | "fat";

export type BoundedItem = Item & {
  min_grams?: number | null;
  max_grams?: number | null;
  locked?: boolean;
};

/**
 * How much each macro matters when they can't all be satisfied at once.
 * Protein is the one you don't want to miss, calories drive the deficit,
 * carbs and fat are the flexible pair that absorb the slack.
 */
const WEIGHTS: Record<MacroKey, number> = {
  kcal: 1.0,
  protein: 1.5,
  carbs: 0.6,
  fat: 0.6,
};

const KEYS: MacroKey[] = ["kcal", "protein", "carbs", "fat"];

/** Per-gram macro contribution of one ingredient. */
function density(it: Item): Record<MacroKey, number> {
  return {
    kcal: (Number(it.kcal_100) || 0) / 100,
    protein: (Number(it.protein_100) || 0) / 100,
    carbs: (Number(it.carbs_100) || 0) / 100,
    fat: (Number(it.fat_100) || 0) / 100,
  };
}

/** The realistic range for an ingredient, defaulting to a band around the plan. */
export function boundsFor(it: BoundedItem): { min: number; max: number } {
  const g = Math.max(0, Number(it.grams) || 0);
  if (it.locked) return { min: g, max: g };
  const min = it.min_grams != null ? Number(it.min_grams) : Math.max(5, roundTo(g * 0.6, 5));
  const max = it.max_grams != null ? Number(it.max_grams) : Math.max(min, roundTo(g * 1.5, 5));
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

/** Weighing step — you can't realistically weigh a 300 g portion to the gram. */
function stepFor(g: number): number {
  return g >= 50 ? 5 : 1;
}

function roundTo(v: number, step: number): number {
  return Math.round(v / step) * step;
}

export function totalsOf(items: Item[], grams: number[]): Macros {
  const out: any = { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 };
  items.forEach((it, i) => {
    const d = density(it);
    for (const k of KEYS) out[k] += d[k] * grams[i];
  });
  return out;
}

/** Weighted relative squared error against the target. Lower is better. */
function cost(items: Item[], grams: number[], target: Macros): number {
  const t = totalsOf(items, grams);
  let f = 0;
  for (const k of KEYS) {
    const g = target[k];
    if (!g) continue;
    const rel = (t[k] - g) / g;
    f += WEIGHTS[k] * rel * rel;
  }
  return f;
}

function gradient(items: Item[], grams: number[], target: Macros): number[] {
  const t = totalsOf(items, grams);
  const scale: Record<MacroKey, number> = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const k of KEYS) {
    const g = target[k];
    scale[k] = g ? (2 * WEIGHTS[k] * (t[k] - g)) / (g * g) : 0;
  }
  return items.map((it) => {
    const d = density(it);
    let acc = 0;
    for (const k of KEYS) acc += scale[k] * d[k];
    return acc;
  });
}

export type OptimiseResult = {
  grams: number[];
  before: Macros;
  after: Macros;
  /** true if the bounds made it impossible to reach the target */
  constrained: boolean;
};

/**
 * Fit the portions to the target. Returns new gram amounts in input order.
 */
export function optimisePortions(items: BoundedItem[], target: Macros): OptimiseResult {
  const before = totalsOf(items, items.map((i) => Number(i.grams) || 0));
  if (items.length === 0) {
    return { grams: [], before, after: before, constrained: false };
  }

  const bounds = items.map(boundsFor);
  const project = (x: number[]) =>
    x.map((v, i) => Math.min(bounds[i].max, Math.max(bounds[i].min, v)));

  let x = project(items.map((i) => Number(i.grams) || 0));
  let step = 1;

  for (let iter = 0; iter < 4000; iter++) {
    const g = gradient(items, x, target);
    const f0 = cost(items, x, target);
    let moved = false;

    // Backtracking line search — halve the step until the move actually helps.
    for (let k = 0; k < 40; k++) {
      const trial = project(x.map((v, i) => v - step * g[i]));
      if (cost(items, trial, target) < f0 - 1e-12) {
        x = trial;
        step *= 1.3;
        moved = true;
        break;
      }
      step /= 2;
    }
    if (!moved) break; // at a bound or a minimum
  }

  // Snap to weighable amounts, then greedily undo any accuracy that cost us.
  x = x.map((v, i) => {
    const s = stepFor(v);
    return Math.min(bounds[i].max, Math.max(bounds[i].min, roundTo(v, s)));
  });

  for (let sweep = 0; sweep < 12; sweep++) {
    let improved = false;
    for (let i = 0; i < x.length; i++) {
      if (items[i].locked) continue;
      const s = stepFor(x[i]);
      for (const delta of [s, -s]) {
        const v = x[i] + delta;
        if (v < bounds[i].min || v > bounds[i].max) continue;
        const trial = [...x];
        trial[i] = v;
        if (cost(items, trial, target) < cost(items, x, target) - 1e-12) {
          x = trial;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  const after = totalsOf(items, x);
  const constrained = x.some(
    (v, i) => !items[i].locked && (v <= bounds[i].min + 1e-9 || v >= bounds[i].max - 1e-9)
  );

  return { grams: x, before, after, constrained };
}

/**
 * Is the plan far enough off target to actually matter?
 *
 * ~100 kcal/day is roughly 0.4 kg of fat a month — the point where drift stops
 * being noise and starts changing the outcome. Protein gets a tighter gate
 * because it's the macro that's meant to stay put.
 */
export const DRIFT = { kcal: 100, protein: 10, carbs: 25, fat: 12 };

export function offTarget(plan: Macros, target: Macros): null | MacroKey[] {
  const off = KEYS.filter((k) => Math.abs(plan[k] - target[k]) > DRIFT[k]);
  return off.length ? off : null;
}
