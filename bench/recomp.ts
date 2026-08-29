/**
 * Checks the phase, protein and calibration maths against cases where the
 * right answer is known. Run with: npx tsx bench/recomp.ts
 */
import { normaliseProfile } from "../lib/profile";
import {
  SEED_DAY_TYPES,
  WEEKDAYS,
  buildWeekPlan,
  normaliseDayType,
  phaseOf,
  proteinTarget,
  targetsFor,
  type DayType,
  type Profile,
} from "../lib/nutrition";
import { KCAL_PER_KG, calibrate, weightRate, type IntakeDay, type WeighIn } from "../lib/trend";

const dayTypes: DayType[] = SEED_DAY_TYPES.map((d, i) =>
  normaliseDayType({ ...d, id: i + 1, sort_order: i }, i)
);
const id = (n: string) => dayTypes.find((d) => d.name === n)!.id;

const base = {
  sex: "male",
  dob: "2005-03-14",
  height_cm: 183,
  weight_kg: 78,
  body_fat_pct: 14,
  base_activity: 1.35,
  energy_model: "sessions",
  goal: "recomp",
  protein_basis: "lean",
  protein_per_kg: 2.8,
  fat_per_kg: 0.8,
  cycling: true,
  phase_name: "Toned maintenance",
  phase_start: "2026-08-31",
  phase_weeks: 10,
  phase_start_adjust: 0,
  phase_end_adjust: -0.08,
  week_ids: {
    mon: id("Swim only"),
    tue: id("Swim + gym"),
    wed: id("Gym only"),
    thu: id("Swim only"),
    fri: id("Swim + gym"),
    sat: id("Double swim"),
    sun: id("Rest"),
  },
};
const profile: Profile = normaliseProfile(base);

console.log("--- protein ---");
console.log(
  `78 kg at 14% body fat -> ${(78 * 0.86).toFixed(1)} kg lean, 2.8 g/kg lean =`,
  Math.round(proteinTarget(profile)),
  "g  (that's",
  (proteinTarget(profile) / 78).toFixed(2),
  "g per kg bodyweight)"
);
const noBf = normaliseProfile({ ...base, body_fat_pct: null });
console.log("without a body fat figure it falls back to bodyweight:", Math.round(proteinTarget(noBf)), "g");
const silly = normaliseProfile({ ...base, body_fat_pct: 3, protein_per_kg: 3.5 });
console.log("mistyped 3% body fat + 3.5 g/kg is clamped to:", Math.round(proteinTarget(silly)), "g");

console.log("\n--- the phase drifting ---");
for (const [label, day] of [
  ["day 1", "2026-08-31"],
  ["week 3", "2026-09-16"],
  ["week 6", "2026-10-07"],
  ["week 10 (end)", "2026-11-09"],
  ["after it ends", "2026-12-01"],
] as const) {
  const ph = phaseOf(profile, day);
  const plan = buildWeekPlan(profile, dayTypes, { today: day });
  const week = WEEKDAYS.map((d) => targetsFor(plan, plan.week[d]).kcal);
  console.log(
    `${label.padEnd(14)} ${(ph.adjust * 100).toFixed(1).padStart(5)}%  ` +
      `average ${plan.goalKcal}  rest ${Math.min(...week)}  biggest ${Math.max(...week)}  ` +
      `protein ${targetsFor(plan, plan.week.mon).protein} g`
  );
}

console.log("\n--- does the week still average out? ---");
for (const day of ["2026-08-31", "2026-10-07"]) {
  const plan = buildWeekPlan(profile, dayTypes, { today: day });
  const mean = WEEKDAYS.reduce((a, d) => a + targetsFor(plan, plan.week[d]).kcal, 0) / 7;
  console.log(`${day}: week mean ${mean.toFixed(1)} vs goal ${plan.goalKcal}`);
}

console.log("\n--- rest days don't lose protein or fat ---");
const plan = buildWeekPlan(profile, dayTypes, { today: "2026-10-07" });
for (const n of ["Rest", "Swim only", "Double swim"]) {
  const t = targetsFor(plan, id(n));
  console.log(
    `${n.padEnd(12)} ${String(t.kcal).padStart(4)} kcal  P${t.protein}  C${t.carbs}  F${t.fat}  ` +
      `fat ${Math.round(t.fatPct * 100)}% of kcal`
  );
}

console.log("\n--- calibration recovers a known expenditure ---");
// Simulate someone whose real TDEE is 3,050 while the formula says something
// else, eating 2,900 a day for six weeks. They should be losing
// (3050-2900)/7700 = 0.0195 kg/day, and the calibration should find 3,050.
const REAL_TDEE = 3050;
const EATEN = 2900;
const weighIns: WeighIn[] = [];
const intake: IntakeDay[] = [];
let w = 78;
for (let d = 0; d < 42; d++) {
  const day = new Date(Date.UTC(2026, 6, 1 + d)).toISOString().slice(0, 10);
  w -= (REAL_TDEE - EATEN) / KCAL_PER_KG;
  // Daily noise: water, glycogen, what you had for dinner.
  const noise = Math.sin(d * 2.3) * 0.45 + Math.cos(d * 1.1) * 0.3;
  weighIns.push({ day, weight_kg: Math.round((w + noise) * 10) / 10, waist_cm: null });
  intake.push({ day, kcal: EATEN + Math.round(Math.sin(d) * 120) });
}
const rate = weightRate(weighIns);
const cal = calibrate(weighIns, intake, 3200);
console.log(`true expenditure ${REAL_TDEE}, ate ${EATEN}, so the rate should be -0.137 kg/week`);
console.log(`measured rate    ${rate?.kgPerWeek.toFixed(3)} kg/week over ${rate?.days} days`);
console.log(`calibration says ${cal?.tdee} kcal (${cal?.confidence} confidence) — error ${cal ? cal.tdee - REAL_TDEE : "n/a"} kcal`);

console.log("\n--- calibration applied, week keeps its shape ---");
const calProfile = normaliseProfile({ ...base, calibrated_tdee: 3050, use_calibration: true });
const p2 = buildWeekPlan(calProfile, dayTypes, { today: "2026-10-07" });
const before = buildWeekPlan(profile, dayTypes, { today: "2026-10-07" });
console.log(
  "maintenance",
  before.maintenance,
  "->",
  p2.maintenance,
  "| rest/double ratio",
  (targetsFor(before, id("Rest")).kcal / targetsFor(before, id("Double swim")).kcal).toFixed(4),
  "->",
  (targetsFor(p2, id("Rest")).kcal / targetsFor(p2, id("Double swim")).kcal).toFixed(4)
);
