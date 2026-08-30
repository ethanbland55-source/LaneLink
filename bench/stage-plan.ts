/**
 * Build the plan the way it is actually eaten, in two stages.
 *
 * The app's whole-week fit weights every kind of day by how often it comes
 * round, so a rest day that happens once loses every argument with three swim
 * days. That is the right default and the wrong thing here, because the rest
 * day is the one that has to be exact: it is the only day where the everyday
 * meals stand alone, so whatever they come to *is* the rest day.
 *
 * So: fit breakfast, lunch and dinner to the rest day on their own. Then, with
 * those fixed, fit the swim meals to the gap up to a swim day and the gym meal
 * to the gap up to a swim-and-gym day. Which is exactly how the week is eaten.
 *
 * The objective is asymmetric on purpose, because the brief was:
 *   protein and carbohydrate must not fall short,
 *   fat may come in under but must not go over,
 *   calories as close as possible.
 * Run with: npx tsx bench/stage-plan.ts
 */
import { buildWeekPlan, itemMacros, sumMacros, targetsFor, type Macros } from "../lib/nutrition";
import { REAL_DAY_TYPES, REAL_MEALS, REAL_PROFILE } from "./real-plan";

const plan = buildWeekPlan(REAL_PROFILE, REAL_DAY_TYPES, { today: "2026-08-31" });
const T = (id: number) => targetsFor(plan, id);

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
  "Rice Cakes": [42, 70, 7],      // 6-10 cakes; four is not a breakfast
  Banana: [105, 210, 105],
  Honey: [0, 45, 5],              // ~3 tbsp is a drizzle; 90 g is a jar
  Pasta: [150, 350, 5],
  Tuna: [112, 336, 112],
  Mayonnaise: [10, 60, 1],
  Sweetcorn: [60, 220, 10],
  "Chicken Breast": [180, 380, 5],
  "White Rice": [50, 140, 5],
  Dates: [30, 260, 5],            // the main pure-carb lever
  // The bowl is the one meal built to a preference rather than to the maths:
  // yoghurt high, granola high, honey a drizzle. Everything else moves around it.
  "4:Greek Yohurt": [400, 400, 10],
  "4:Protein Grenola": [100, 100, 5],
  "4:Honey": [20, 20, 5],
  Bagel: [85, 170, 85],
  "Peanut Butter": [10, 35, 1],
};

function vars(mealIds: number[]): Var[] {
  const out: Var[] = [];
  for (const m of REAL_MEALS) {
    if (!mealIds.includes(m.id)) continue;
    m.ingredients.forEach((i: any, index) => {
      // `meal:name` wins over a bare name, so the honey in the bowl can be a
      // drizzle while the honey on breakfast stays a lever.
      const b =
        BANDS[`${m.id}:${i.name}`] ??
        BANDS[i.name] ?? [Math.round(i.grams * 0.6), Math.round(i.grams * 1.6), 1];
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

const sub = (a: Macros, b: Macros): Macros => ({
  kcal: a.kcal - b.kcal,
  protein: a.protein - b.protein,
  carbs: a.carbs - b.carbs,
  fat: a.fat - b.fat,
});
const add = (a: Macros, b: Macros): Macros => ({
  kcal: a.kcal + b.kcal,
  protein: a.protein + b.protein,
  carbs: a.carbs + b.carbs,
  fat: a.fat + b.fat,
});

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

/* --- Stage 1: the everyday meals are the rest day --------------------- */
const baseVars = vars(EVERY_DAY);
const baseX = solve(baseVars, T(1));
const base = totals(baseVars, baseX);

/* --- Stage 2: the swim meals fill the gap up to a swim day ------------ */
const swimVars = vars(SWIM_EXTRA);
/*
 * Calories carry far more weight on the training days than they do on the rest
 * day, and it is the one trade worth making here. The gap between a rest day
 * and a swim day is pure carbohydrate by construction, and no real food is
 * pure carbohydrate — so chasing the carb figure means overshooting calories,
 * which is the number that actually decides body composition. Land the
 * calories, take the carbohydrate as close as the food allows, and accept the
 * protein that comes with it.
 */
const swimX = solve(swimVars, T(3), base, 3000);
const swim = totals(swimVars, swimX);

/* --- Stage 3: the gym meal fills the gap up to swim + gym ------------- */
const gymVars = vars([5]);
const gymX = solve(gymVars, T(4), add(base, swim), 3000);
const gym = totals(gymVars, gymX);

/* --- Report ----------------------------------------------------------- */
const line = (n: string, g: Macros, t: Macros) => {
  const d = (a: number, b: number) => {
    const v = Math.round(a - b);
    return `${String(Math.round(a)).padStart(4)}/${String(Math.round(b)).padEnd(4)} ${(v >= 0 ? "+" + v : String(v)).padStart(5)}`;
  };
  return `${n.padEnd(14)} ${d(g.kcal, t.kcal)}  ${d(g.protein, t.protein)}  ${d(g.carbs, t.carbs)}  ${d(g.fat, t.fat)}`;
};

console.log("                 kcal              protein           carbs             fat");
console.log(line("Rest", base, T(1)));
console.log(line("Swim only", add(base, swim), T(3)));
console.log(line("Swim + gym", add(add(base, swim), gym), T(4)));

console.log("\nPORTIONS");
const all = [
  ...baseVars.map((v, i) => ({ v, g: baseX[i] })),
  ...swimVars.map((v, i) => ({ v, g: swimX[i] })),
  ...gymVars.map((v, i) => ({ v, g: gymX[i] })),
];
let lastMeal = -1;
for (const { v, g } of all) {
  if (v.meal !== lastMeal) {
    const m = REAL_MEALS.find((x) => x.id === v.meal)!;
    const mt = totals(
      all.filter((a) => a.v.meal === v.meal).map((a) => a.v),
      all.filter((a) => a.v.meal === v.meal).map((a) => a.g)
    );
    console.log(
      `  ${m.name} — ${Math.round(mt.kcal)} kcal, ${Math.round(mt.protein)}P ${Math.round(mt.carbs)}C ${Math.round(mt.fat)}F`
    );
    lastMeal = v.meal;
  }
  const unit =
    v.name === "Rice Cakes" ? ` = ${Math.round(g / 7)} cakes`
    : v.name === "Tuna" ? ` = ${(g / 112).toFixed(0)} tins`
    : v.name === "Bagel" ? ` = ${(g / 85).toFixed(0)} bagel${g / 85 === 1 ? "" : "s"}`
    : v.name === "Banana" ? ` = ${(g / 105).toFixed(0)}`
    : "";
  console.log(
    `      ${v.name.padEnd(17)} ${String(v.grams).padStart(4)} -> ${String(Math.round(g)).padStart(4)} g${unit}${v.locked ? "  (locked)" : ""}`
  );
}

export { all, baseVars, baseX, swimVars, swimX, gymVars, gymX };
