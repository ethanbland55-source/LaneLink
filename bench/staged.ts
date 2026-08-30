/**
 * The staged plan builder, over whatever profile and meals you hand it.
 *
 * The app's whole-week fit weights every kind of day by how often it comes
 * round, so a rest day that happens once loses every argument with three swim
 * days. That is the right default and the wrong thing here: the rest day is
 * the one that has to be exact, because it is the only day where the everyday
 * meals stand alone, so whatever they come to *is* the rest day.
 *
 * So fit breakfast, lunch and dinner to the rest day on their own; then, with
 * those fixed, fit the swim meals to the gap up to a swim day and the gym meal
 * to the gap up to a swim-and-gym day. Which is how the week is actually eaten.
 */
import { targetsFor, type Macros, type WeekPlan } from "../lib/nutrition";

type Var = {
  meal: number;
  index: number;
  name: string;
  per: Macros;
  min: number;
  max: number;
  step: number;
  locked: boolean;
  grams: number;
};

/** Portion bands that are all things a person would put on a plate. */
const BANDS: Record<string, [number, number, number]> = {
  // name: [min, max, step]  — step 7 on rice cakes because a cake is 7 g
  "Rice Cakes": [28, 70, 7],      // 4-10 cakes; three is not a breakfast
  Banana: [105, 210, 105],
  Honey: [0, 45, 5],              // ~3 tbsp is a drizzle; 90 g is a jar
  Pasta: [150, 350, 5],
  Tuna: [112, 336, 112],
  Mayonnaise: [10, 60, 1],
  Sweetcorn: [60, 220, 10],
  "Chicken Breast": [180, 380, 5],
  "White Rice": [50, 140, 5],
  Dates: [30, 260, 5],            // the main pure-carb lever
  "Greek Yohurt": [400, 550, 10],
  "Protein Grenola": [50, 110, 5],
  Bagel: [85, 170, 85],
  "Peanut Butter": [10, 35, 1],
};

function vars(meals: any[], mealIds: number[]): Var[] {
  const out: Var[] = [];
  for (const m of meals) {
    if (!mealIds.includes(m.id)) continue;
    m.ingredients.forEach((i: any, index: number) => {
      const b = BANDS[i.name] ?? [Math.round(i.grams * 0.6), Math.round(i.grams * 1.6), 1];
      out.push({
        meal: m.id,
        index,
        name: i.name,
        per: {
          kcal: i.kcal_100 / 100,
          protein: i.protein_100 / 100,
          carbs: i.carbs_100 / 100,
          fat: i.fat_100 / 100,
        },
        min: i.locked ? i.grams : b[0],
        max: i.locked ? i.grams : b[1],
        step: i.locked ? 1 : b[2],
        locked: !!i.locked,
        grams: i.grams,
      });
    });
  }
  return out;
}

function totals(vs: Var[], x: number[]): Macros {
  const o: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  vs.forEach((v, i) => {
    o.kcal += v.per.kcal * x[i];
    o.protein += v.per.protein * x[i];
    o.carbs += v.per.carbs * x[i];
    o.fat += v.per.fat * x[i];
  });
  return o;
}

/**
 * The brief, as a number.
 *
 * Falling short of protein or carbohydrate is expensive; overshooting them is
 * nearly free. Going over on fat is expensive; coming in under is nearly free.
 * Calories are pulled to the target from both sides.
 *
 * Always scored against the **whole day**, never against the gap. Score a gap
 * and the arithmetic falls apart: a swim day needs its extra calories to be
 * essentially pure carbohydrate, so the gap's fat target is about 1 g, and a
 * relative error against 1 g makes ten grams of fat look like a thousand per
 * cent miss. The solver then starves the meal to avoid it. Against the day's
 * own 63 g it is what it is — nine grams over — and gets weighed accordingly.
 */
function cost(t: Macros, g: Macros, kcalWeight = 18): number {
  const rel = (a: number, b: number) => (b > 0 ? (a - b) / b : 0);
  const p = rel(g.protein, t.protein);
  const c = rel(g.carbs, t.carbs);
  const f = rel(g.fat, t.fat);
  const k = rel(g.kcal, t.kcal);
  return (
    (p < 0 ? 60 : 1.5) * p * p +
    (c < 0 ? 40 : 1.5) * c * c +
    (f > 0 ? 25 : 1.0) * f * f +
    kcalWeight * k * k
  );
}

/**
 * Coordinate descent over the weighable steps, from several starts.
 *
 * `fixed` is whatever is already on the plate from earlier stages, so every
 * stage is scored against the day it is building rather than against its own
 * contribution to it.
 */
function solve(vs: Var[], target: Macros, fixed?: Macros, kcalWeight = 18): number[] {
  const withFixed = (m: Macros): Macros =>
    fixed
      ? {
          kcal: m.kcal + fixed.kcal,
          protein: m.protein + fixed.protein,
          carbs: m.carbs + fixed.carbs,
          fat: m.fat + fixed.fat,
        }
      : m;
  const score = (x: number[]) => cost(target, withFixed(totals(vs, x)), kcalWeight);
  const snap = (v: Var, g: number) =>
    Math.min(v.max, Math.max(v.min, Math.round(g / v.step) * v.step));

  const starts: number[][] = [
    vs.map((v) => (v.locked ? v.grams : snap(v, v.grams))),
    vs.map((v) => (v.locked ? v.grams : snap(v, (v.min + v.max) / 2))),
    vs.map((v) => (v.locked ? v.grams : v.min)),
    vs.map((v) => (v.locked ? v.grams : v.max)),
  ];

  let best: number[] | null = null;
  let bestCost = Infinity;

  for (const start of starts) {
    let x = start.slice();
    for (let pass = 0; pass < 400; pass++) {
      let moved = false;
      for (let i = 0; i < vs.length; i++) {
        if (vs[i].locked) continue;
        let cur = score(x);
        for (const d of [vs[i].step, -vs[i].step, 2 * vs[i].step, -2 * vs[i].step]) {
          const g = x[i] + d;
          if (g < vs[i].min - 1e-9 || g > vs[i].max + 1e-9) continue;
          const trial = x.slice();
          trial[i] = g;
          const c = score(trial);
          if (c < cur - 1e-12) {
            x = trial;
            cur = c;
            moved = true;
          }
        }
      }
      // pairwise, to get off the plateaus single moves stick on
      for (let i = 0; i < vs.length && !moved; i++) {
        if (vs[i].locked) continue;
        for (let j = 0; j < vs.length; j++) {
          if (i === j || vs[j].locked) continue;
          for (const [a, b] of [
            [vs[i].step, -vs[j].step],
            [-vs[i].step, vs[j].step],
          ]) {
            const gi = x[i] + a;
            const gj = x[j] + b;
            if (gi < vs[i].min || gi > vs[i].max || gj < vs[j].min || gj > vs[j].max) continue;
            const trial = x.slice();
            trial[i] = gi;
            trial[j] = gj;
            const c = score(trial);
            if (c < score(x) - 1e-12) {
              x = trial;
              moved = true;
            }
          }
        }
      }
      if (!moved) break;
    }
    const c = score(x);
    if (c < bestCost) {
      bestCost = c;
      best = x;
    }
  }
  return best!;
}

/**
 * Which meals are the everyday ones.
 *
 * Passing 4 puts the yoghurt bowl in the base — eaten every day rather than
 * only after a swim. That is not a smaller version of the same plan, it is a
 * different one, and it is the only arrangement that gets a swim day close:
 * with the bowl's protein and fat already counted on every day, the swim
 * top-up can be dates, which are nearly all carbohydrate, and the gap between
 * a rest day and a swim day is nothing but carbohydrate.
 */
const EVERY_DAY = process.argv.includes("--bowl-daily") ? [1, 2, 6, 4] : [1, 2, 6];
const SWIM_EXTRA = EVERY_DAY.includes(4) ? [3] : [3, 4];


export type StagedResult = {
  portions: { meal: number; index: number; name: string; grams: number; min: number; max: number; locked: boolean; was: number }[];
  days: { id: number; name: string; got: Macros; target: Macros }[];
};

const add = (a: Macros, b: Macros): Macros => ({
  kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat,
});

/**
 * @param baseIds   meals eaten every day
 * @param swimIds   meals added on a swim day
 * @param gymIds    meals added on top for a swim-and-gym day
 */
export function stagedPlan(
  plan: WeekPlan,
  meals: any[],
  ids: { base: number[]; swim: number[]; gym: number[] },
  days: { rest: number; swim: number; swimGym: number }
): StagedResult {
  const T = (id: number) => targetsFor(plan, id);

  const baseVars = vars(meals, ids.base);
  const baseX = solve(baseVars, T(days.rest));
  const base = totals(baseVars, baseX);

  const swimVars = vars(meals, ids.swim);
  // Calories carry far more weight on a training day: the gap between two day
  // types is pure carbohydrate by construction, no real food is pure
  // carbohydrate, and chasing the carb figure means overshooting the number
  // that actually decides body composition.
  const swimX = solve(swimVars, T(days.swim), base, 3000);
  const swim = totals(swimVars, swimX);

  const gymVars = vars(meals, ids.gym);
  const gymX = solve(gymVars, T(days.swimGym), add(base, swim), 3000);
  const gym = totals(gymVars, gymX);

  const pack = (vs: Var[], x: number[]) =>
    vs.map((v, i) => ({ meal: v.meal, index: v.index, name: v.name, grams: Math.round(x[i]),
      min: v.min, max: v.max, locked: v.locked, was: v.grams }));

  return {
    portions: [...pack(baseVars, baseX), ...pack(swimVars, swimX), ...pack(gymVars, gymX)],
    days: [
      { id: days.rest, name: T(days.rest).name, got: base, target: T(days.rest) },
      { id: days.swim, name: T(days.swim).name, got: add(base, swim), target: T(days.swim) },
      { id: days.swimGym, name: T(days.swimGym).name, got: add(add(base, swim), gym), target: T(days.swimGym) },
    ],
  };
}
