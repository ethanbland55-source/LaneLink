/**
 * The whole-week fit, against the plan it was written for.
 *
 * Fitting each day type separately leaves the week 281 kcal/day over target;
 * this is the check that fitting them together does not.
 */
import { buildWeekPlan, sumMacros, targetsFor, totalFor } from "../lib/nutrition";
import { fitWeek, weekStanding, weeklyAverage } from "../lib/weekfit";
import { REAL_DAY_TYPES, REAL_MEALS, REAL_PROFILE } from "./real-plan";

const plan = buildWeekPlan(REAL_PROFILE, REAL_DAY_TYPES, { today: "2026-08-31" });

function show(label: string, meals: typeof REAL_MEALS) {
  console.log(`\n--- ${label} ---`);
  console.log("day type          days   target    plan    diff       P t/p        C t/p        F t/p");
  for (const s of weekStanding(meals, plan)) {
    const flag = s.days === 0 ? " (unused)" : "";
    console.log(
      `${s.name.padEnd(16)}${String(s.days).padStart(3)}   ${String(Math.round(s.target.kcal)).padStart(6)}  ${String(Math.round(s.planned.kcal)).padStart(6)}  ${String(Math.round(s.planned.kcal - s.target.kcal)).padStart(6)}   ` +
        `${String(Math.round(s.target.protein)).padStart(3)}/${String(Math.round(s.planned.protein)).padStart(3)}   ` +
        `${String(Math.round(s.target.carbs)).padStart(3)}/${String(Math.round(s.planned.carbs)).padStart(3)}   ` +
        `${String(Math.round(s.target.fat)).padStart(3)}/${String(Math.round(s.planned.fat)).padStart(3)}${flag}`
    );
  }
  const w = weeklyAverage(meals, plan);
  console.log(
    `weekly average     ${String(Math.round(w.target.kcal)).padStart(9)}  ${String(Math.round(w.planned.kcal)).padStart(6)}  ${String(Math.round(w.planned.kcal - w.target.kcal)).padStart(6)}   ` +
      `${String(Math.round(w.target.protein)).padStart(3)}/${String(Math.round(w.planned.protein)).padStart(3)}`
  );
}

show("as written (each day type fitted on its own)", REAL_MEALS);

const t0 = Date.now();
const res = fitWeek(REAL_MEALS, plan);
const ms = Date.now() - t0;
show("after one whole-week fit", res.meals);
console.log(`\nsolved in ${ms} ms`);

console.log("\nportions:");
for (const m of res.meals) {
  const t = totalFor(m.ingredients);
  const was = totalFor(REAL_MEALS.find((x) => x.id === m.id)!.ingredients);
  console.log(`  ${m.name.padEnd(12)} ${String(Math.round(was.kcal)).padStart(5)} -> ${String(Math.round(t.kcal)).padStart(5)} kcal`);
  for (const [n, i] of m.ingredients.entries()) {
    const before = REAL_MEALS.find((x) => x.id === m.id)!.ingredients[n];
    console.log(`      ${i.name.padEnd(16)} ${String(Math.round(Number(before.grams))).padStart(4)} -> ${String(Math.round(Number(i.grams))).padStart(4)} g`);
  }
}
