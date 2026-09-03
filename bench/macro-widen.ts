/**
 * The remaining misses are small. Can moderate changes to the portion bands
 * close them — without turning a 400 g bowl of yoghurt into 180 g?
 *
 * Run: npx tsx bench/macro-widen.ts
 */
import { REAL_DAY_TYPES, REAL_MEALS, REAL_PROFILE } from "./real-plan";
import { buildWeekPlan, type Profile } from "../lib/nutrition";
import { fitWeek, weekStanding } from "../lib/weekfit";
import type { PlanMeal } from "../lib/batch";

const KEYS = ["kcal", "protein", "carbs", "fat"] as const;
const TOL = { kcal: 25, protein: 3, carbs: 6, fat: 2 } as const;

/**
 * Wider, but still a plate of food. Nothing here more than about a third
 * either side of what's in the plan now, and the locked items stay locked.
 */
const WIDER: Record<string, [number, number]> = {
  "Greek Yohurt": [340, 460],
  "Protein Grenola": [80, 115],
  Honey: [10, 30],
  Dates: [30, 90],
  "Rice Cakes": [40, 90],
  Banana: [105, 240],
  Pasta: [150, 300],
  Sweetcorn: [60, 200],
  "White Rice": [60, 160],
  "Chicken Breast": [170, 300],
  Mayonnaise: [8, 55],
  Bagel: [85, 170],
  "Peanut Butter": [8, 40],
  Tuna: [112, 250],
};

function widen(meals: PlanMeal[]): PlanMeal[] {
  return meals.map((m) => ({
    ...m,
    ingredients: m.ingredients.map((i) => {
      const w = WIDER[i.name];
      if (!w || i.locked) return { ...i };
      return { ...i, min_grams: w[0], max_grams: w[1] };
    }),
  }));
}

function assess(profile: Profile, meals: PlanMeal[], label: string) {
  const plan = buildWeekPlan(profile, REAL_DAY_TYPES, { today: "2026-09-07" });
  const res = fitWeek(structuredClone(meals), plan, { mode: "balanced" });
  const standing = weekStanding(res.meals, plan).filter((s) => s.days > 0);

  const misses: string[] = [];
  for (const s of standing) {
    for (const k of KEYS) {
      const d = s.planned[k] - s.target[k];
      if (Math.abs(d) > TOL[k]) misses.push(`${s.name} ${k} ${d > 0 ? "+" : ""}${Math.round(d)}`);
    }
  }
  console.log(`${label.padEnd(46)} ${misses.length === 0 ? "ALL CLEAR" : misses.join(", ")}`);
  return { misses, meals: res.meals, standing };
}

console.log("Tolerance: 25 kcal, 3 g protein, 6 g carbs, 2 g fat.\n");

for (const fat of [0.8, 0.75, 0.7]) {
  for (const protein of [2.8, 2.7]) {
    const p = { ...REAL_PROFILE, fat_per_kg: fat, protein_per_kg: protein };
    assess(p, REAL_MEALS, `as now      fat ${fat} protein ${protein}`);
    assess(p, widen(REAL_MEALS), `wider bands fat ${fat} protein ${protein}`);
  }
}

console.log("\n=== the portions the winning setup asks for ===");
const best = { ...REAL_PROFILE, fat_per_kg: 0.8, protein_per_kg: 2.8 };
const out = assess(best, widen(REAL_MEALS), "chosen      fat 0.8 protein 2.8");
for (const m of out.meals) {
  const line = m.ingredients
    .map((i) => `${i.name} ${Math.round(Number(i.grams))}g`)
    .join(", ");
  console.log(`  ${m.name.padEnd(11)} ${line}`);
}
console.log("\n=== and what each day then comes to ===");
for (const s of out.standing) {
  console.log(
    `  ${s.name.padEnd(12)} ${Math.round(s.planned.kcal)}/${s.target.kcal} kcal   ` +
      `P ${Math.round(s.planned.protein)}/${s.target.protein}   ` +
      `C ${Math.round(s.planned.carbs)}/${s.target.carbs}   ` +
      `F ${Math.round(s.planned.fat)}/${s.target.fat}`
  );
}

console.log("\n=== what is holding Swim + gym at +29? ===");
// The suspicion is the bagel: a whole-unit food with a floor of one bagel.
const wide = widen(REAL_MEALS);
const halfBagel = wide.map((m) => ({
  ...m,
  ingredients: m.ingredients.map((i) =>
    i.name === "Bagel" ? { ...i, min_grams: 42, max_grams: 170 } : { ...i }
  ),
}));
assess({ ...REAL_PROFILE, fat_per_kg: 0.75 }, wide, "wider bands, whole bagels only  ");
assess({ ...REAL_PROFILE, fat_per_kg: 0.75 }, halfBagel, "wider bands, half a bagel allowed");
