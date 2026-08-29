/**
 * Accuracy harness: old solver vs new, on randomised but realistic plans.
 *
 * Score is the mean absolute percentage error across the four macros after
 * the solver has finished and portions have been snapped to weighable
 * amounts. Lower is better. Run with: npx tsx bench/compare.ts
 */
import { optimisePortions as oldSolve } from "./old-optimise";
import { optimisePortions as newSolve, boundsFor as newBounds } from "../lib/optimise";
import type { Macros } from "../lib/nutrition";

type Food = { name: string; kcal_100: number; protein_100: number; carbs_100: number; fat_100: number; fibre_100: number };

const PANTRY: Food[] = [
  { name: "Chicken breast", kcal_100: 106, protein_100: 24, carbs_100: 0, fat_100: 1.2, fibre_100: 0 },
  { name: "Basmati rice", kcal_100: 349, protein_100: 8.1, carbs_100: 77, fat_100: 1.1, fibre_100: 1.4 },
  { name: "Olive oil", kcal_100: 899, protein_100: 0, carbs_100: 0, fat_100: 99.9, fibre_100: 0 },
  { name: "Broccoli", kcal_100: 34, protein_100: 2.8, carbs_100: 4, fat_100: 0.4, fibre_100: 2.6 },
  { name: "Oats", kcal_100: 379, protein_100: 11, carbs_100: 60, fat_100: 8, fibre_100: 10 },
  { name: "Whey protein", kcal_100: 386, protein_100: 78, carbs_100: 8, fat_100: 5, fibre_100: 1 },
  { name: "Semi-skimmed milk", kcal_100: 50, protein_100: 3.6, carbs_100: 4.8, fat_100: 1.8, fibre_100: 0 },
  { name: "Eggs", kcal_100: 143, protein_100: 12.6, carbs_100: 0.7, fat_100: 9.5, fibre_100: 0 },
  { name: "Sweet potato", kcal_100: 86, protein_100: 1.6, carbs_100: 20, fat_100: 0.1, fibre_100: 3 },
  { name: "Greek yoghurt", kcal_100: 57, protein_100: 10, carbs_100: 4, fat_100: 0.4, fibre_100: 0 },
  { name: "Peanut butter", kcal_100: 597, protein_100: 25, carbs_100: 12, fat_100: 50, fibre_100: 6 },
  { name: "Salmon fillet", kcal_100: 208, protein_100: 20, carbs_100: 0, fat_100: 13, fibre_100: 0 },
  { name: "Wholemeal bread", kcal_100: 247, protein_100: 10, carbs_100: 41, fat_100: 3.4, fibre_100: 7 },
  { name: "Banana", kcal_100: 89, protein_100: 1.1, carbs_100: 23, fat_100: 0.3, fibre_100: 2.6 },
  { name: "Pasta", kcal_100: 359, protein_100: 12, carbs_100: 71, fat_100: 1.8, fibre_100: 3 },
  { name: "Cheddar", kcal_100: 416, protein_100: 25, carbs_100: 0.1, fat_100: 35, fibre_100: 0 },
];

// Deterministic PRNG so the numbers are reproducible.
let seed = 20260829;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick<T>(a: T[]): T {
  return a[Math.floor(rnd() * a.length)];
}

function makePlan(n: number) {
  const used = new Set<string>();
  const items: any[] = [];
  while (items.length < n) {
    const f = pick(PANTRY);
    if (used.has(f.name)) continue;
    used.add(f.name);
    const base = f.kcal_100 > 500 ? 15 : f.kcal_100 > 250 ? 70 : 150;
    items.push({ ...f, grams: Math.round(base * (0.6 + rnd() * 0.9)) });
  }
  return items;
}

function mape(after: Macros, target: Macros) {
  const keys = ["kcal", "protein", "carbs", "fat"] as const;
  let s = 0;
  for (const k of keys) s += Math.abs(after[k] - target[k]) / target[k];
  return (100 * s) / keys.length;
}

const SNAPPED = process.argv.includes("--snapped");
const TRIALS = 400;
let oldSum = 0;
let newSum = 0;
let oldKcal = 0;
let newKcal = 0;
let newWins = 0;
let oldProteinMiss = 0;
let newProteinMiss = 0;
let oldWorst = 0;
let newWorst = 0;

/**
 * Build a target that is genuinely reachable: take a random point inside each
 * ingredient's own allowed band and use the macros that produces. Anything a
 * solver misses from here is the solver's fault, not the plan's.
 */
function reachableTarget(items: any[], snapped: boolean): Macros {
  const pt = items.map((it) => {
    const b = newBounds(it);
    const raw = b.min + rnd() * (b.max - b.min);
    if (!snapped) return raw;
    const s = b.unit ?? b.step;
    return Math.min(b.max, Math.max(b.min, Math.round(raw / s) * s));
  });
  const t: any = { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 };
  items.forEach((it, i) => {
    const f = pt[i] / 100;
    t.kcal += it.kcal_100 * f;
    t.protein += it.protein_100 * f;
    t.carbs += it.carbs_100 * f;
    t.fat += it.fat_100 * f;
    t.fibre += it.fibre_100 * f;
  });
  for (const k of Object.keys(t)) t[k] = Math.round(t[k]);
  return t as Macros;
}

for (let t = 0; t < TRIALS; t++) {
  const items = makePlan(5 + Math.floor(rnd() * 6));
  const target = reachableTarget(items, SNAPPED);

  const a = oldSolve(structuredClone(items), target);
  const b = newSolve(structuredClone(items), target, { mode: "balanced" });

  const ea = mape(a.after, target);
  const eb = mape(b.after, target);
  oldSum += ea;
  newSum += eb;
  oldWorst = Math.max(oldWorst, ea);
  newWorst = Math.max(newWorst, eb);
  oldKcal += Math.abs(a.after.kcal - target.kcal);
  newKcal += Math.abs(b.after.kcal - target.kcal);
  oldProteinMiss += Math.max(0, target.protein - a.after.protein);
  newProteinMiss += Math.max(0, target.protein - b.after.protein);
  if (eb <= ea + 1e-9) newWins++;
}

const f = (x: number) => x.toFixed(2);
console.log(`trials                      ${TRIALS}`);
console.log(`mean macro error    old     ${f(oldSum / TRIALS)}%`);
console.log(`mean macro error    new     ${f(newSum / TRIALS)}%`);
console.log(`worst macro error   old     ${f(oldWorst)}%`);
console.log(`worst macro error   new     ${f(newWorst)}%`);
console.log(`mean kcal miss      old     ${f(oldKcal / TRIALS)} kcal`);
console.log(`mean kcal miss      new     ${f(newKcal / TRIALS)} kcal`);
console.log(`mean protein short  old     ${f(oldProteinMiss / TRIALS)} g`);
console.log(`mean protein short  new     ${f(newProteinMiss / TRIALS)} g`);
console.log(`new at least as good in     ${((100 * newWins) / TRIALS).toFixed(1)}% of plans`);
