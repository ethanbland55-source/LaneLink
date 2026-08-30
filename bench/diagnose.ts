/** Where the plan as written actually lands, day type by day type. */
import { buildWeekPlan, sumMacros, targetsFor, totalFor, WEEKDAYS } from "../lib/nutrition";
import { appliesOn } from "../lib/shopping";
import { REAL_DAY_TYPES, REAL_MEALS, REAL_PROFILE } from "./real-plan";

const plan = buildWeekPlan(REAL_PROFILE, REAL_DAY_TYPES, { today: "2026-08-31" });

console.log("BMR", plan.bmr, plan.method, "| baseline", plan.baseline);
console.log("maintenance", plan.maintenance, "| goal", plan.goalKcal, "| balance", plan.balance.toFixed(4));
console.log("phase adjust", plan.phase.adjust.toFixed(4), "week", plan.phase.week, "of", plan.phase.weeks);
console.log();

const used = new Map<number, number>();
for (const d of WEEKDAYS) used.set(plan.week[d], (used.get(plan.week[d]) ?? 0) + 1);

console.log("day type            days  target   plan    diff    P t/p      C t/p      F t/p");
for (const id of plan.order) {
  const t = targetsFor(plan, id);
  const meals = REAL_MEALS.filter((m) => appliesOn(m, id, plan.order.length));
  const got = sumMacros(meals.map((m) => totalFor(m.ingredients)));
  const n = used.get(id) ?? 0;
  console.log(
    `${t.name.padEnd(20)}${String(n).padStart(2)}  ${String(t.kcal).padStart(6)}  ${String(Math.round(got.kcal)).padStart(6)}  ${String(Math.round(got.kcal - t.kcal)).padStart(6)}  ` +
      `${String(t.protein).padStart(3)}/${String(Math.round(got.protein)).padStart(3)}  ` +
      `${String(t.carbs).padStart(3)}/${String(Math.round(got.carbs)).padStart(3)}  ` +
      `${String(t.fat).padStart(3)}/${String(Math.round(got.fat)).padStart(3)}`
  );
}

console.log("\nweighted weekly average of the plan as written:");
let wk = 0;
let wt = 0;
for (const d of WEEKDAYS) {
  const id = plan.week[d];
  const meals = REAL_MEALS.filter((m) => appliesOn(m, id, plan.order.length));
  wk += sumMacros(meals.map((m) => totalFor(m.ingredients))).kcal;
  wt += targetsFor(plan, id).kcal;
}
console.log(`  eaten ${Math.round(wk / 7)} kcal/day vs target ${Math.round(wt / 7)} kcal/day`);

console.log("\nper meal, as written:");
for (const m of REAL_MEALS) {
  const t = totalFor(m.ingredients);
  console.log(
    `  ${m.name.padEnd(12)} days=${(m.day_type_ids ?? "all").toString().padEnd(9)} ${String(Math.round(t.kcal)).padStart(5)} kcal  ${Math.round(t.protein)}P ${Math.round(t.carbs)}C ${Math.round(t.fat)}F`
  );
}
