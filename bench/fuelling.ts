/**
 * Is each kind of day carrying the carbohydrate its training asks for?
 * Run with: npx tsx bench/fuelling.ts
 */
import { buildWeekPlan, carbCheck, planWeight, trainingLoad } from "../lib/nutrition";
import { CARB_BANDS, CITATIONS, carbBandFor, short } from "../lib/evidence";
import { SUPPLEMENT_LIBRARY, fixedMacros, type Supplement } from "../lib/supplements";
import { REAL_DAY_TYPES, REAL_PROFILE } from "./real-plan";

const plan = buildWeekPlan(REAL_PROFILE, REAL_DAY_TYPES, { today: "2026-08-31" });

console.log(`=== Carbohydrate, ${planWeight(REAL_PROFILE)} kg (${short("burke2011")}) ===\n`);
console.log("day type       load   band        should be      target      ");
for (const c of carbCheck(REAL_PROFILE, plan)) {
  const flag =
    c.verdict === "in"
      ? "ok"
      : c.verdict === "under_fuelled"
        ? "UNDER-FUELLED"
        : c.verdict === "low_by_design"
          ? "low by design"
          : "over";
  console.log(
    `${c.name.padEnd(14)}${String(c.loadMinutes).padStart(4)}m  ${c.band.label.padEnd(10)}  ` +
      `${String(c.lowGrams).padStart(4)}-${String(c.highGrams).padEnd(4)} g   ` +
      `${String(c.grams).padStart(4)} g (${c.perKg} g/kg)  ${flag}`
  );
}

console.log("\n=== The bands ===");
for (const b of CARB_BANDS) {
  console.log(`  ${b.label.padEnd(10)} ${b.low}-${b.high} g/kg — ${b.why}`);
}

console.log("\n=== Load weighting ===");
for (const dt of REAL_DAY_TYPES) {
  const mins = (dt.sessions ?? []).reduce((a, s) => a + s.minutes, 0);
  console.log(
    `  ${dt.name.padEnd(14)} ${String(mins).padStart(3)} clock min -> ` +
      `${String(Math.round(trainingLoad(dt))).padStart(3)} weighted -> ${carbBandFor(trainingLoad(dt)).label}`
  );
}

console.log("\n=== Supplements are a fixed cost, not a variable ===");
const supps: Supplement[] = [
  { id: 1, name: "Creatine monohydrate", dose: 5, unit: "g", timing: "anytime", meal_id: null, day_type_ids: null, times_per_day: 1, kcal: 0, protein: 0, carbs: 0, fat: 0, note: null, sort_order: 0 },
  { id: 2, name: "Whey protein", dose: 30, unit: "g", timing: "post_session", meal_id: null, day_type_ids: [3, 4, 5], times_per_day: 1, kcal: 120, protein: 25, carbs: 2, fat: 1.5, note: null, sort_order: 1 },
];
for (const id of plan.order) {
  const f = fixedMacros(supps, id, plan.order.length);
  console.log(`  ${plan.byId[id].name.padEnd(14)} +${f.kcal} kcal, +${f.protein} g protein from supplements`);
}

console.log("\n=== Evidence grades ===");
for (const s of SUPPLEMENT_LIBRARY) {
  console.log(`  ${s.name.padEnd(24)} ${s.grade.padEnd(13)} ${s.refs.map(short).join(", ")}`);
}

console.log(`\n${Object.keys(CITATIONS).length} sources registered.`);
