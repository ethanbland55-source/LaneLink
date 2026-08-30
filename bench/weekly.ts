/**
 * The measure → correct → trend → roll → plan chain.
 * Run with: npx tsx bench/weekly.ts
 */
import { buildWeekPlan, planWeight, targetsFor } from "../lib/nutrition";
import {
  DEFAULT_RISE_PER_HOUR,
  learnOffsets,
  weightRate,
  type WeighIn,
} from "../lib/trend";
import { lastShopDay, nextShopDay, rollFigures, rollState, applyRoll } from "../lib/weekly";
import { navyBodyFat, skinfoldBodyFat } from "../lib/bodyfat";
import { doseSpacing } from "../lib/protein";
import { REAL_DAY_TYPES, REAL_PROFILE } from "./real-plan";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/* ------------------------------------------------------------------ */
console.log("=== 1. A clock time beats a three-way tag ===");

/**
 * Someone genuinely flat at 78 kg who weighs at a different time most days.
 * True rise is 0.10 kg/hr from 06:00. The tag model has to round 09:15 and
 * 10:45 to the same "morning"; the clock model doesn't.
 */
const TRUE_RISE = 0.1;
const HOURS = [7, 9.25, 10.75, 13, 16.5, 20, 7.5];
const timed: WeighIn[] = [];
const tagged: WeighIn[] = [];
for (let d = 0; d < 42; d++) {
  const day = iso(new Date(Date.UTC(2026, 6, 1 + d)));
  const h = HOURS[d % HOURS.length];
  const noise = Math.sin(d * 2.1) * 0.3;
  const reading = Math.round((78 + noise + (h - 6) * TRUE_RISE) * 10) / 10;
  const hh = `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
  timed.push({ day, weight_kg: reading, waist_cm: null, at_time: hh });
  tagged.push({
    day,
    weight_kg: reading,
    waist_cm: null,
    tag: h < 11 ? "morning" : h < 17 ? "other" : "evening",
  });
}

const oTimed = learnOffsets(timed);
const oTagged = learnOffsets(tagged);
console.log(
  `  learned rise  ${(oTimed.risePerHour * 1000).toFixed(0)} g/hr from clock times ` +
    `(true ${(TRUE_RISE * 1000).toFixed(0)}, population default ${(DEFAULT_RISE_PER_HOUR * 1000).toFixed(0)})`
);
const rTimed = weightRate(timed)!;
const rTagged = weightRate(tagged)!;
const rNaive = weightRate(timed.map((e) => ({ ...e, at_time: null, tag: "morning" as const })))!;
console.log(`  with clock times   ${rTimed.current.toFixed(2)} kg, ${rTimed.kgPerWeek.toFixed(3)} kg/wk`);
console.log(`  with tags only     ${rTagged.current.toFixed(2)} kg, ${rTagged.kgPerWeek.toFixed(3)} kg/wk`);
console.log(`  ignoring the time  ${rNaive.current.toFixed(2)} kg, ${rNaive.kgPerWeek.toFixed(3)} kg/wk`);
console.log(`  (true weight 78.00 kg, true drift 0.000 kg/wk)`);

/* ------------------------------------------------------------------ */
console.log("\n=== 2. Body fat, both ways ===");
const tape = navyBodyFat({ sex: "male", heightCm: 182.88, neckCm: 39, waistCm: 81, weightKg: 78.35 });
console.log(`  tape    neck 39, waist 81 -> ${tape?.pct}% (${tape?.leanKg} kg lean, ±${tape?.error})`);
const calip = skinfoldBodyFat({ sex: "male", ageYears: 21, sites: [8, 14, 11], weightKg: 78.35 });
console.log(`  calipers 8/14/11 mm      -> ${calip?.pct}% (${calip?.leanKg} kg lean, ±${calip?.error})`);
const leaner = navyBodyFat({ sex: "male", heightCm: 182.88, neckCm: 39, waistCm: 78, weightKg: 78.35 });
console.log(`  waist 81 -> 78 cm at the same weight: ${tape?.pct}% -> ${leaner?.pct}%`);

/* ------------------------------------------------------------------ */
console.log("\n=== 3. The plan rolls on shopping day, and only then ===");
const shopDow = REAL_PROFILE.shop_start_dow; // 6 = Saturday
for (const d of ["2026-08-30", "2026-09-02", "2026-09-05", "2026-09-06"]) {
  console.log(
    `  ${d} (${new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short" })})` +
      `  last shop ${lastShopDay(shopDow, d)}  next ${nextShopDay(shopDow, d)}`
  );
}

// A trend that has genuinely drifted down since the last roll.
const drifting: WeighIn[] = [];
for (let d = 0; d < 30; d++) {
  const day = iso(new Date(Date.UTC(2026, 7, 8 + d)));
  drifting.push({
    day,
    weight_kg: Math.round((79.2 - d * 0.03 + Math.sin(d * 1.7) * 0.25) * 10) / 10,
    waist_cm: null,
    at_time: "07:00",
  });
}
// Measured a fortnight ago, so it is in scope on the day we roll.
(drifting[20] as any).bf_pct = 13.4;

const stale = { ...REAL_PROFILE, plan_weight_kg: 79.2, plan_updated_on: "2026-08-22" };
const state = rollState(stale, drifting, "2026-09-02");
console.log(`\n  plan built on ${state.current.weightKg} kg, last rolled ${state.lastRolled}`);
console.log(`  shopping day was ${state.dueOn} -> due: ${state.due}`);
console.log(`  trend now ${state.figures?.weightKg} kg from ${state.figures?.readings} weigh-ins`);

const rolled = applyRoll(stale, state.figures!, state.dueOn);
console.log(`  after rolling: ${rolled.plan_weight_kg} kg, ${rolled.plan_bf_pct}% bf, stamped ${rolled.plan_updated_on}`);
console.log(`  due again the same week? ${rollState(rolled, drifting, "2026-09-04").due}`);
console.log(`  due again next shopping day? ${rollState(rolled, drifting, "2026-09-06").due}`);

const before = buildWeekPlan(stale, REAL_DAY_TYPES, { today: "2026-09-02" });
const after = buildWeekPlan(rolled, REAL_DAY_TYPES, { today: "2026-09-02" });
console.log(
  `\n  targets move with it: rest ${targetsFor(before, 1).kcal} -> ${targetsFor(after, 1).kcal} kcal, ` +
    `protein ${targetsFor(before, 1).protein} -> ${targetsFor(after, 1).protein} g ` +
    `(planning weight ${planWeight(stale)} -> ${planWeight(rolled)} kg)`
);

// It must hold still for the rest of the week, then go again on the next
// shopping day — which is exactly what makes a shopping list worth trusting.
for (const d of ["2026-09-03", "2026-09-04", "2026-09-05"]) {
  const dow = new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short" });
  console.log(`  rolls on ${d} (${dow})? ${rollState(rolled, drifting, d).due}`);
}

/* ------------------------------------------------------------------ */
console.log("\n=== 4. Meal times say something about the day ===");
const spacing = doseSpacing(
  [
    { name: "Breakfast", protein: 38, at: "07:30" },
    { name: "Lunch", protein: 100, at: "12:30" },
    { name: "Post Swim", protein: 44, at: "19:45" },
    { name: "Dinner", protein: 80, at: "20:30" },
  ],
  78.35
);
console.log(`  threshold ${(0.4 * 78.35).toFixed(0)} g; ${spacing.timed.filter((d) => d.clears).length} doses clear it`);
for (const n of spacing.notes) console.log(`  - ${n}`);

const bunched = doseSpacing(
  [
    { name: "Breakfast", protein: 38, at: "08:00" },
    { name: "Lunch", protein: 100, at: "13:00" },
    { name: "Dinner", protein: 80, at: "17:30" },
  ],
  78.35
);
console.log("\n  same protein, finished early:");
for (const n of bunched.notes) console.log(`  - ${n}`);
