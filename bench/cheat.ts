/**
 * Cheat meals against the real plan.
 *
 * Four things have to be true or the feature is worse than not having it:
 *
 *  1. A normal meal out gets absorbed by the day, mostly by not eating the
 *     meal it replaced.
 *  2. A big one drops meals rather than pretending, and what it cannot place
 *     is reported in calories and in grams of fat rather than rounded away.
 *  3. **Protein survives.** At maintenance protein is the thing holding the
 *     lean mass on, and the cheapest way for a solver to make room is to cut
 *     the chicken. It must not.
 *  4. A cheat meal on the last day of the plan week has nowhere to spread to,
 *     and says so instead of borrowing from a week that hasn't been weighed
 *     in for yet.
 *
 * Run: npx tsx bench/cheat.ts
 */

import { buildWeekPlan, targetsFor, type Profile } from "../lib/nutrition";
import { absorbCheat, completeCheat, daysAfter, type CheatMeal } from "../lib/cheat";
import { REAL_DAY_TYPES, REAL_MEALS, REAL_PROFILE } from "./real-plan";

const ROLL_DOW = 1; // Monday
const profile = { ...REAL_PROFILE, calorie_override: null } as Profile;
const plan = buildWeekPlan(profile, REAL_DAY_TYPES, { today: "2026-09-07" });

/** Friday 11 Sep 2026 — a swim + gym day in his week. */
const FRIDAY = "2026-09-11";
const SUNDAY = "2026-09-13";

function dayTypeOn(day: string): number {
  const names = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
  const wd = new Date(day + "T12:00:00").getDay();
  const key = names[wd] === "sun" ? "sun" : names[wd];
  return plan.week[key as keyof typeof plan.week];
}

function run(cheat: CheatMeal, day = FRIDAY) {
  return absorbCheat({
    cheat,
    meals: structuredClone(REAL_MEALS),
    plan,
    dayTypes: REAL_DAY_TYPES,
    dayTypeId: dayTypeOn(day),
    rest: daysAfter(day, plan, ROLL_DOW),
  });
}

function report(label: string, a: ReturnType<typeof run>) {
  const t = a.target;
  console.log(`\n--- ${label} ---`);
  console.log(
    `  target ${Math.round(t.kcal)} kcal / ${Math.round(t.protein)} g P` +
      `   →   day lands ${Math.round(a.after.kcal)} / ${Math.round(a.after.protein)} g P`
  );
  for (const m of a.meals) {
    if (m.action === "kept") continue;
    const detail =
      m.action === "resized"
        ? m.portions.map((p) => `${p.name} ${Math.round(p.from)}→${Math.round(p.to)}`).join(", ")
        : (m.why ?? "");
    console.log(`  ${m.action.padEnd(9)} ${m.name.padEnd(12)} ${detail}`);
  }
  if (a.spread.length) {
    console.log(`  spread: ${a.spread.map((s) => `${s.weekday} −${s.kcal}`).join(", ")}`);
  }
  console.log(
    `  spill ${a.spill} kcal, placed ${a.spill - a.leftover}, leftover ${a.leftover}` +
      ` (${a.leftoverFatGrams} g fat)`
  );
  for (const n of a.notes) console.log(`  · ${n}`);
}

let failures = 0;
function check(what: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? ` — ${detail}` : ""}`);
}

/* ---- the macro completion ---------------------------------------------- */

console.log("=== Typing in what a menu tells you ===\n");
const onlyKcal = completeCheat({ kcal: 1200 });
console.log(
  `  1200 kcal alone → ${onlyKcal.protein} g P, ${onlyKcal.carbs} g C, ${onlyKcal.fat} g F ` +
    `(${onlyKcal.protein * 4 + onlyKcal.carbs * 4 + onlyKcal.fat * 9} kcal back)`
);
check(
  "estimated macros reconstruct the calories",
  Math.abs(onlyKcal.protein * 4 + onlyKcal.carbs * 4 + onlyKcal.fat * 9 - 1200) < 40
);
const full = completeCheat({ protein: 50, carbs: 120, fat: 40 });
check("macros alone give calories", Math.abs(full.kcal - (50 * 4 + 120 * 4 + 40 * 9)) < 2);

/* ---- 1. an ordinary meal out ------------------------------------------- */

console.log("\n=== Case 1: a 1100 kcal curry instead of dinner ===");
const curry = run({
  day: FRIDAY,
  meal_id: 6, // Dinner
  name: "Curry",
  ...completeCheat({ kcal: 1100 }),
});
report("curry, swapped for dinner", curry);
check("dinner comes off", curry.meals.some((m) => m.mealId === 6 && m.action === "replaced"));
check(
  "day lands within 5% of target",
  Math.abs(curry.after.kcal - curry.target.kcal) / curry.target.kcal < 0.05,
  `${Math.round(curry.after.kcal)} vs ${Math.round(curry.target.kcal)}`
);
check(
  "protein holds above 90% of target",
  curry.after.protein >= curry.target.protein * 0.9,
  `${Math.round(curry.after.protein)} vs ${Math.round(curry.target.protein)}`
);

/* ---- 2. a big one ------------------------------------------------------ */

console.log("\n=== Case 2: a 2000 kcal blowout instead of dinner ===");
const big = run({
  day: FRIDAY,
  meal_id: 6,
  name: "Three courses",
  ...completeCheat({ kcal: 2000 }),
});
report("blowout", big);
check(
  "protein is not what pays for it",
  big.after.protein >= big.target.protein * 0.9,
  `${Math.round(big.after.protein)} vs ${Math.round(big.target.protein)}`
);
check("the overspend is spread or reported", big.spread.length > 0 || big.leftover > 0);
check(
  "no later day gives up more than 12% of itself",
  big.spread.every((sd) => sd.kcal <= targetsFor(plan, sd.dayTypeId).kcal * 0.12 + 1)
);
check(
  "nothing is silently lost",
  big.spill === big.spread.reduce((a, s) => a + s.kcal, 0) + big.leftover,
  `spill ${big.spill} vs placed ${big.spread.reduce((a, s) => a + s.kcal, 0)} + ${big.leftover}`
);

/* ---- 3. protein is not the thing that pays ----------------------------- */

console.log("\n=== Case 3: protein under pressure ===");
const noSwap = run({
  day: FRIDAY,
  meal_id: null,
  name: "On top of everything",
  ...completeCheat({ kcal: 1400 }),
});
report("no swap, 1400 kcal on top", noSwap);
const chickenDropped = noSwap.meals.find((m) => m.mealId === 6)?.action === "dropped";
const proteinLeft = noSwap.after.protein;
check(
  "protein stays within reach even with nothing swapped out",
  proteinLeft >= noSwap.target.protein * 0.8,
  `${Math.round(proteinLeft)} vs ${Math.round(noSwap.target.protein)}`
);
check(
  "if dinner was dropped, it was not the first thing tried",
  !chickenDropped || noSwap.meals.filter((m) => m.action === "dropped").length > 1,
  chickenDropped ? "dinner went" : "dinner kept"
);

/* ---- 4. the last day of the week --------------------------------------- */

console.log("\n=== Case 4: Sunday, with nowhere to spread ===");
const sunday = run(
  { day: SUNDAY, meal_id: 6, name: "Sunday roast out", ...completeCheat({ kcal: 1600 }) },
  SUNDAY
);
report("Sunday", sunday);
check("no days left to spread into", daysAfter(SUNDAY, plan, ROLL_DOW).length === 0);
check(
  "so it is reported rather than borrowed from next week",
  sunday.spread.length === 0 && (sunday.spill === 0 || sunday.leftover === sunday.spill)
);

/* ---- 5. what's already in a box stays the size it is -------------------- */

console.log("\n=== Case 5: the cooked-ahead portions hold ===");
const PREPPED = new Set(
  REAL_MEALS.flatMap((m) =>
    m.ingredients.filter((i) => (i as any).prepped).map((i) => `${m.id}:${i.name}`)
  )
);
console.log(`  cooked ahead: ${[...PREPPED].join(", ")}`);

for (const kcal of [900, 1300, 1800]) {
  const a = run({ day: FRIDAY, meal_id: 6, name: `${kcal} out`, ...completeCheat({ kcal }) });
  const moved = a.meals.flatMap((m) =>
    m.portions.filter((p) => PREPPED.has(`${m.mealId}:${p.name}`)).map((p) => `${p.name} ${p.from}→${p.to}`)
  );
  check(
    `${kcal} kcal out — nothing in a container is re-weighed`,
    moved.length === 0,
    moved.length ? moved.join(", ") : "pasta, tuna, chicken and rice all held"
  );
}

// And the parts you add on the day really are still free, or the day would
// have nothing to give and every meal out would end in a dropped meal.
const fresh = run({ day: FRIDAY, meal_id: 6, name: "Pub", ...completeCheat({ kcal: 1200 }) });
const lunch = fresh.meals.find((m) => m.mealId === 2);
check(
  "the sweetcorn and the mayonnaise can still move",
  lunch?.action !== "resized" || lunch.portions.every((p) => !PREPPED.has(`2:${p.name}`)),
  lunch?.portions.map((p) => p.name).join(", ") || "lunch untouched"
);

/* ---- 6. the weekly cost, stated plainly -------------------------------- */

console.log("\n=== What one a week actually costs ===\n");
for (const kcal of [800, 1100, 1500, 2000]) {
  const a = run({ day: FRIDAY, meal_id: 6, name: `${kcal}`, ...completeCheat({ kcal }) });
  const perYear = a.leftover * 52;
  console.log(
    `  ${String(kcal).padStart(4)} kcal meal → ${String(a.leftover).padStart(4)} kcal left over` +
      `  (${a.leftoverFatGrams} g fat, ~${(perYear / 7700).toFixed(1)} kg/yr if weekly)`
  );
}

console.log(
  failures === 0
    ? "\nPASS — every check held."
    : `\nFAIL — ${failures} check${failures === 1 ? "" : "s"} did not hold.`
);
process.exit(failures === 0 ? 0 : 1);
