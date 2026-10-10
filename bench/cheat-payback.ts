/**
 * A second cheat meal in a week, and the week after paying for it.
 *
 * What has to be true:
 *
 *  1. The first meal of a week costs nothing; only the extras do, and each at
 *     what it put on top of the day — its calories less the meal it replaced.
 *  2. The payback is small and even: never more than `PAYBACK_CAP` of
 *     maintenance a day, however big the meal.
 *  3. It survives a taper. A race week has no planned deficit, and the payback
 *     still comes off — that was the condition the feature was asked for on.
 *  4. Training fuel still holds: the fuel floor keeps each swim day's carbs
 *     within reach of its band while the payback runs.
 *
 * Run: npx tsx bench/cheat-payback.ts
 */

import { buildWeekPlan, planWeight, weekDeficitScale, WEEKDAYS, type Profile } from "../lib/nutrition";
import { cheatDebt, paybackAdjust, PAYBACK_CAP, type CheatMeal } from "../lib/cheat";
import { REAL_DAY_TYPES, REAL_PROFILE } from "./real-plan";

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

const meal = (day: string, kcal: number, meal_id: number | null, name = "Meal out"): CheatMeal => ({
  day,
  meal_id,
  name,
  kcal,
  protein: 0,
  carbs: 0,
  fat: 0,
});

/* --- 1. pricing -------------------------------------------------------- */

console.log("\npricing");
const sizes = new Map([[3, 850]]); // dinner, as planned
const from = "2026-10-05";
const to = "2026-10-11";

const one = cheatDebt([meal("2026-10-05", 1211, null)], sizes, from, to);
check("the week's first meal is the allowance", one.kcal === 0 && one.extras.length === 0);

const two = cheatDebt(
  [meal("2026-10-10", 1400, 3, "Tea out"), meal("2026-10-05", 1211, null, "Yoghurt bowl")],
  sizes,
  from,
  to
);
check(
  "the second is priced at what it put on top of the day",
  two.kcal === 550 && two.extras[0]?.name === "Tea out",
  `${two.kcal} kcal`
);

const outside = cheatDebt(
  [meal("2026-10-04", 1500, null), meal("2026-10-05", 1211, null), meal("2026-10-12", 1500, null)],
  sizes,
  from,
  to
);
check("meals outside the plan week don't count", outside.kcal === 0);

const smaller = cheatDebt([meal("2026-10-05", 900, null), meal("2026-10-10", 600, 3)], sizes, from, to);
check("a meal smaller than the one it replaced owes nothing", smaller.kcal === 0);

/* --- 2. size ----------------------------------------------------------- */

console.log("\nsize");
const maint = 3100;
const small = paybackAdjust(550, maint);
check("a small debt is spread evenly over the week", Math.abs(-small * maint - 550 / 7) < 1, `${Math.round(-small * maint)} kcal/day`);
const huge = paybackAdjust(5000, maint);
check("a huge one is capped", Math.abs(-huge - PAYBACK_CAP) < 1e-4, `${Math.round(-huge * maint)} kcal/day`);
check("no debt, no payback", paybackAdjust(0, maint) === 0 && paybackAdjust(-50, maint) === 0);

/* --- 3 & 4. against the real plan, in a race week ---------------------- */

console.log("\nthe real plan, in Manchester's race week");
const events = [
  { kind: "meet" as const, name: "Manchester", start: "2026-10-16", end: "2026-10-18", taper: "partial" as const },
];
const scale = weekDeficitScale(events, "2026-10-12");
check("the week of the meet carries no planned deficit", scale === 0);

const base: Profile = {
  ...(REAL_PROFILE as Profile),
  calorie_override: null,
  goal: "recomp",
  pace: "steady",
  events,
  pace_adjust: -0.034,
  recomp_adjust: 0,
  deficit_scale: scale,
};
const hold = buildWeekPlan(base, REAL_DAY_TYPES);
const debt = paybackAdjust(1000, hold.maintenance);
const paid = buildWeekPlan({ ...base, payback_adjust: debt }, REAL_DAY_TYPES);

const avg = (plan: typeof hold, k: "kcal" | "carbs" | "fat" | "protein") =>
  WEEKDAYS.reduce((a, d) => a + plan.byId[plan.week[d]][k], 0) / 7;
const cut = avg(hold, "kcal") - avg(paid, "kcal");
console.log(
  `  hold ${Math.round(avg(hold, "kcal"))} kcal → paying back ${Math.round(avg(paid, "kcal"))} kcal ` +
    `(${Math.round(-debt * hold.maintenance)} asked, ${Math.round(cut)} landed)`
);
check("the payback comes off despite the taper", cut > 0.6 * -debt * hold.maintenance, `${Math.round(cut)} kcal/day`);
check("and no more than the cap", cut <= PAYBACK_CAP * hold.maintenance + 5);
check("protein isn't what pays", avg(paid, "protein") >= avg(hold, "protein") - 1);

for (const id of new Set(WEEKDAYS.map((d) => hold.week[d]))) {
  const a = hold.byId[id];
  const b = paid.byId[id];
  const kg = planWeight(base);
  const name = REAL_DAY_TYPES.find((t) => t.id === id)?.name ?? String(id);
  console.log(
    `  ${name.padEnd(14)} ${Math.round(a.kcal)} → ${Math.round(b.kcal)} kcal, ` +
      `carbs ${(a.carbs / kg).toFixed(1)} → ${(b.carbs / kg).toFixed(1)} g/kg, ` +
      `fat ${Math.round(a.fat)} → ${Math.round(b.fat)} g${b.fuelFloored ? "  (fuel floor)" : ""}`
  );
}

console.log(failed ? `\n${failed} failed` : "\nall good");
process.exitCode = failed ? 1 : 0;
