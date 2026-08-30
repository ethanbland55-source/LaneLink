/**
 * Batch cooking, weigh-in tags and the tape body-fat estimate.
 * Run with: npx tsx bench/batch.ts
 */
import { normaliseProfile } from "../lib/profile";
import {
  SEED_DAY_TYPES,
  buildWeekPlan,
  estimatedBodyFat,
  normaliseDayType,
  proteinTarget,
  targetsFor,
  totalFor,
  type DayType,
  type Profile,
} from "../lib/nutrition";
import { collapse, cookPlan, expand, servingGrams } from "../lib/batch";
import { optimisePortions } from "../lib/optimise";
import { navyBodyFat } from "../lib/bodyfat";
import { learnOffsets, trendLine, weightRate, type WeighIn } from "../lib/trend";

const dayTypes: DayType[] = SEED_DAY_TYPES.map((d, i) =>
  normaliseDayType({ ...d, id: i + 1, sort_order: i }, i)
);
const id = (n: string) => dayTypes.find((d) => d.name === n)!.id;

const profile: Profile = normaliseProfile({
  sex: "male", dob: "2005-03-14", height_cm: 183, weight_kg: 78,
  base_activity: 1.35, energy_model: "sessions", goal: "recomp",
  protein_basis: "lean", protein_per_kg: 2.8, fat_per_kg: 0.8,
  cycling: true, phase_start: "2026-08-31", phase_weeks: 10,
  phase_start_adjust: 0, phase_end_adjust: -0.08,
  neck_cm: 39, bf_source: "tape", waist_cm: 81,
  week_ids: {
    mon: id("Swim only"), tue: id("Swim + gym"), wed: id("Gym only"),
    thu: id("Swim only"), fri: id("Swim + gym"), sat: id("Double swim"), sun: id("Rest"),
  },
});

const plan = buildWeekPlan(profile, dayTypes, { today: "2026-09-14" });

const meals = [
  { id: 1, name: "Breakfast", times_per_day: 1, day_type_ids: null, batch: false, ingredients: [
    { name: "Oats", grams: 100, kcal_100: 379, protein_100: 11, carbs_100: 60, fat_100: 8, fibre_100: 10 },
    { name: "Semi-skimmed milk", grams: 300, kcal_100: 50, protein_100: 3.6, carbs_100: 4.8, fat_100: 1.8, fibre_100: 0 },
    { name: "Whey protein", grams: 30, kcal_100: 386, protein_100: 78, carbs_100: 8, fat_100: 5, fibre_100: 1 },
  ]},
  { id: 2, name: "Chicken & rice tray", times_per_day: 1, day_type_ids: null, batch: true, ingredients: [
    { name: "Chicken breast", grams: 200, kcal_100: 106, protein_100: 24, carbs_100: 0, fat_100: 1.2, fibre_100: 0 },
    { name: "Basmati rice", grams: 120, kcal_100: 349, protein_100: 8.1, carbs_100: 77, fat_100: 1.1, fibre_100: 1.4 },
    { name: "Broccoli", grams: 180, kcal_100: 34, protein_100: 2.8, carbs_100: 4, fat_100: 0.4, fibre_100: 2.6 },
    { name: "Olive oil", grams: 10, kcal_100: 899, protein_100: 0, carbs_100: 0, fat_100: 99.9, fibre_100: 0 },
  ]},
  { id: 3, name: "Beef pasta bake", times_per_day: 1, day_type_ids: null, batch: true, ingredients: [
    { name: "Beef mince", grams: 180, kcal_100: 176, protein_100: 20, carbs_100: 0, fat_100: 10, fibre_100: 0 },
    { name: "Pasta", grams: 110, kcal_100: 359, protein_100: 12, carbs_100: 71, fat_100: 1.8, fibre_100: 3 },
    { name: "Passata", grams: 150, kcal_100: 35, protein_100: 1.4, carbs_100: 6, fat_100: 0.2, fibre_100: 1.4 },
    { name: "Cheddar", grams: 30, kcal_100: 416, protein_100: 25, carbs_100: 0.1, fat_100: 35, fibre_100: 0 },
  ]},
];

console.log("=== 1. A cooked batch is one variable, not four ===");
const { items, slots } = collapse(meals as any);
console.log(`${meals.reduce((a, m) => a + m.ingredients.length, 0)} ingredients collapse to ${items.length} variables`);
console.log("  ", slots.map((s) => (s.kind === "batch" ? `[batch ${s.mealId}]` : `item`)).join(" "));

const target = targetsFor(plan, id("Double swim"));
const res = optimisePortions(items, target, { mode: "balanced" });
const fitted = expand(meals as any, slots, res.grams);

for (const m of fitted) {
  if (!m.batch) continue;
  const before = meals.find((x) => x.id === m.id)!;
  const ratiosBefore = before.ingredients.map((i) => i.grams / servingGrams(before as any));
  const ratiosAfter = m.ingredients.map((i) => (i.grams as number) / servingGrams(m));
  const drift = Math.max(...ratiosAfter.map((r, i) => Math.abs(r - ratiosBefore[i])));
  console.log(
    `  ${m.name}: ${Math.round(servingGrams(before as any))} g -> ${Math.round(servingGrams(m))} g serving, ` +
      `recipe ratio drift ${drift.toFixed(6)} (must be 0)`
  );
}
console.log(`  day lands at ${Math.round(res.after.kcal)} kcal vs target ${target.kcal}`);

console.log("\n=== 2. One serving, every day ===");
for (const m of meals.filter((x) => x.batch)) {
  console.log(`  ${m.name}: ${Math.round(servingGrams(m as any))} g, whatever day it is`);
}

console.log("\n=== 3. The cook list for a 7-day shop ===");
const cook = cookPlan(meals as any, plan, {
  days: 7,
  dayTypeForDay: (i) => plan.week[(["mon","tue","wed","thu","fri","sat","sun"] as const)[i % 7]],
});
for (const m of cook.meals) {
  console.log(`  ${m.name} — ${m.servings} servings, ${(m.totalGrams / 1000).toFixed(2)} kg total`);
  for (const i of m.ingredients) {
    console.log(`     ${i.name.padEnd(20)} ${Math.round(i.grams).toString().padStart(5)} g raw` +
      (i.rawToCooked !== 1 ? `  -> ${Math.round(i.cookedGrams)} g cooked` : ""));
  }
}

for (const n of cook.notes) console.log(`  note: ${n}`);

console.log("\n=== 4. Weighing at different times ===");
// Someone whose true morning weight is flat at 78, who weighs in the evening
// on Wed/Sat (+1.2 kg each time). Without correction the trend would wander.
const mixed: WeighIn[] = [];
for (let d = 0; d < 28; d++) {
  const day = new Date(Date.UTC(2026, 7, 1 + d)).toISOString().slice(0, 10);
  const evening = d % 7 === 2 || d % 7 === 5;
  const noise = Math.sin(d * 2.1) * 0.35;
  mixed.push({
    day,
    weight_kg: Math.round((78 + noise + (evening ? 1.2 : 0)) * 10) / 10,
    waist_cm: null,
    tag: evening ? "evening" : "morning",
  });
}
const off = learnOffsets(mixed);
console.log(`  learned evening offset ${off.weight.evening.toFixed(2)} kg (true 1.20), learned: [${off.learned.join(", ")}]`);
const corrected = weightRate(mixed);
const uncorrected = weightRate(mixed.map((e) => ({ ...e, tag: "morning" as const })));
console.log(`  trend now ${corrected?.current.toFixed(2)} kg, drifting ${corrected?.kgPerWeek.toFixed(3)} kg/wk (true 0.000)`);
console.log(`  if tags were ignored: ${uncorrected?.current.toFixed(2)} kg, ${uncorrected?.kgPerWeek.toFixed(3)} kg/wk`);

console.log("\n=== 5. One fat-fingered reading ===");
const typo = mixed.map((e, i) => (i === 20 ? { ...e, weight_kg: 87.2 } : e));
console.log(`  87.2 typed instead of 78.2 moves the trend by ${(
  (weightRate(typo)?.current ?? 0) - (corrected?.current ?? 0)
).toFixed(2)} kg (capped, not 9)`);

console.log("\n=== 6. Body fat from a tape ===");
const bf = navyBodyFat({ sex: "male", heightCm: 183, neckCm: 39, waistCm: 81, weightKg: 78 });
console.log(`  183 cm, 39 cm neck, 81 cm waist -> ${bf?.pct}% (${bf?.leanKg} kg lean, ±${bf?.error} pts)`);
const slimmer = navyBodyFat({ sex: "male", heightCm: 183, neckCm: 39, waistCm: 78, weightKg: 78 });
console.log(`  waist 81 -> 78 cm at the same weight: ${bf?.pct}% -> ${slimmer?.pct}%, lean ${bf?.leanKg} -> ${slimmer?.leanKg} kg`);
console.log(`  protein target with the tape estimate: ${Math.round(proteinTarget(profile))} g`);
const noTape = normaliseProfile({ ...profile, bf_source: "none", neck_cm: null, body_fat_pct: null });
console.log(`  with no body fat figure at all:        ${Math.round(proteinTarget(noTape))} g (was 218 g before this fix)`);
