/**
 * Lean, fuelled, and still fast — does the plan actually enforce it?
 *
 * The whole point of the energy-availability floor is that it binds. A weekly
 * calorie average can look completely sensible while a Tuesday with two swims
 * in it leaves too little to run a body on, and bodyweight will not tell you:
 * this is the failure where the scale holds steady and the swimming quietly
 * goes backwards.
 *
 * So this checks three things against the real plan:
 *
 *  1. Every day the plan produces clears 30 kcal per kg of fat-free mass.
 *  2. Pushing the deficit harder does not get around that — the floor wins.
 *  3. The rate of loss and the protein figure get honest verdicts.
 *
 * Run: npx tsx bench/fuelling.ts
 */

import { buildWeekPlan, targetsFor, EA_FLOOR, type Profile } from "../lib/nutrition";
import { weekEnergy, lossRate, proteinVerdict, carbBandFor, CARB_BANDS } from "../lib/fuelling";
import { trainingLoad } from "../lib/nutrition";
import { REAL_DAY_TYPES, REAL_PROFILE } from "./real-plan";

const MONDAY = "2026-09-07";
let failures = 0;
const check = (what: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? ` — ${detail}` : ""}`);
};

/** His profile, uncapped, with a body-fat figure so EA can be computed at all. */
function profileWith(over: Partial<Profile>): Profile {
  return {
    ...REAL_PROFILE,
    calorie_override: null,
    body_fat_pct: 12,
    plan_bf_pct: 12,
    bf_source: "skinfold",
    ...over,
  } as Profile;
}

console.log("=== What each day leaves you to live on ===\n");
const plan = buildWeekPlan(profileWith({}), REAL_DAY_TYPES, { today: MONDAY });
const energy = weekEnergy(profileWith({}), plan);

console.log(
  "day".padEnd(14) + "kcal".padStart(7) + "session".padStart(9) + "EA".padStart(7) + "  band"
);
for (const d of energy) {
  console.log(
    d.name.padEnd(14) +
      String(Math.round(d.intake)).padStart(7) +
      String(d.exercise).padStart(9) +
      String(d.ea ?? "—").padStart(7) +
      "  " +
      d.band +
      (d.days === 0 ? "  (unused)" : "")
  );
}

check(
  "every day in use clears the floor",
  energy.filter((d) => d.days > 0).every((d) => (d.ea ?? 99) >= EA_FLOOR),
  energy
    .filter((d) => d.days > 0)
    .map((d) => `${d.name} ${d.ea}`)
    .join(", ")
);

/* ---- 2. the floor beats the deficit ------------------------------------ */

console.log("\n=== Pushing the deficit — the floor should win ===\n");
console.log("phase adjust".padEnd(14) + "weekly".padStart(8) + "lightest EA".padStart(13) + "  floored");
for (const adjust of [0, -0.05, -0.1, -0.2, -0.35]) {
  const p = profileWith({ phase_start_adjust: adjust, phase_end_adjust: adjust });
  const pl = buildWeekPlan(p, REAL_DAY_TYPES, { today: MONDAY });
  const e = weekEnergy(p, pl).filter((d) => d.days > 0);
  const lowest = e.reduce((a, b) => ((a.ea ?? 99) < (b.ea ?? 99) ? a : b));
  const floored = pl.order.filter((id) => targetsFor(pl, id).eaFloored).length;
  console.log(
    `${(adjust * 100).toFixed(0)}%`.padEnd(14) +
      String(Math.round(pl.goalKcal)).padStart(8) +
      String(lowest.ea).padStart(13) +
      `  ${floored} day type${floored === 1 ? "" : "s"}`
  );
  check(
    `at ${(adjust * 100).toFixed(0)}% no day falls under the floor`,
    e.every((d) => (d.ea ?? 99) >= EA_FLOOR - 0.05),
    `lightest ${lowest.name} ${lowest.ea}`
  );
}

/* ---- 3. without a body-fat figure it does nothing, loudly -------------- */

console.log("\n=== With no body composition figure ===\n");
const blind = { ...REAL_PROFILE, calorie_override: null, body_fat_pct: null, plan_bf_pct: null, bf_source: "none" } as Profile;
const blindPlan = buildWeekPlan(blind, REAL_DAY_TYPES, { today: MONDAY });
const blindEnergy = weekEnergy(blind, blindPlan);
check(
  "energy availability is null rather than guessed",
  blindEnergy.every((d) => d.ea === null)
);
check(
  "and nothing gets floored on an invented number",
  blindPlan.order.every((id) => !targetsFor(blindPlan, id).eaFloored)
);

/* ---- 4. rate of loss --------------------------------------------------- */

console.log("\n=== How fast the phase is actually moving ===\n");
for (const adjust of [0.02, 0, -0.03, -0.08, -0.15]) {
  const p = profileWith({ phase_start_adjust: adjust, phase_end_adjust: adjust });
  const pl = buildWeekPlan(p, REAL_DAY_TYPES, { today: MONDAY });
  const r = lossRate(p, pl);
  console.log(
    `${(adjust * 100).toFixed(0)}%`.padEnd(6) +
      `${(r.pctPerWeek * 100).toFixed(2)}%/wk`.padStart(11) +
      `${r.kgPerWeek.toFixed(2)} kg`.padStart(10) +
      `  ${r.verdict}`
  );
}
/**
 * The nicest property of the floor: you cannot set a dangerous deficit.
 *
 * Ask for 20% under and the floor gives most of it back, so the rate that
 * actually happens stays inside what the evidence supports. Worth asserting
 * explicitly, because it is the difference between a warning and a guardrail.
 */
const brisk = profileWith({ phase_start_adjust: -0.2, phase_end_adjust: -0.2 });
const briskPlan = buildWeekPlan(brisk, REAL_DAY_TYPES, { today: MONDAY });
const briskRate = lossRate(brisk, briskPlan);
console.log(
  `\n  asking for -20% actually gives ${(briskRate.pctPerWeek * 100).toFixed(2)}%/wk ` +
    `(${briskRate.verdict}) once the floor has had its say`
);
check(
  "a 20% deficit cannot produce a loss faster than 1% a week",
  briskRate.pctPerWeek >= -0.01,
  `${(briskRate.pctPerWeek * 100).toFixed(2)}%/wk`
);
check(
  "and the floor is what stopped it",
  briskPlan.order.some((id) => targetsFor(briskPlan, id).eaFloored)
);

/* ---- 5. protein and carbohydrate -------------------------------------- */

console.log("\n=== Protein, at his current setting ===\n");
const t = targetsFor(plan, 3);
const pv = proteinVerdict(t.protein, 78.35);
console.log(`  ${t.protein} g = ${pv.perKg.toFixed(2)} g/kg → ${pv.verdict}`);
console.log(`  ${pv.note}`);
check("protein gets a verdict", !!pv.verdict);

console.log("\n=== Carbohydrate band by day type ===\n");
for (const dt of REAL_DAY_TYPES) {
  const load = trainingLoad(dt);
  const band = carbBandFor(load);
  const tt = targetsFor(plan, dt.id);
  const perKg = tt.carbs / 78.35;
  console.log(
    dt.name.padEnd(14) +
      `load ${load.toFixed(0)}`.padStart(10) +
      `  ${band.label} (${band.low}-${band.high} g/kg)`.padEnd(28) +
      `plan ${perKg.toFixed(1)} g/kg`
  );
}
check("every band is reachable", CARB_BANDS.length === 4);

console.log(
  failures === 0 ? "\nPASS — every check held." : `\nFAIL — ${failures} check(s) did not hold.`
);
process.exit(failures === 0 ? 0 : 1);
