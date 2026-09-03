/**
 * Can the plan land every macro on every kind of day?
 *
 * Ethan's question: protein is off on a couple of days and fat is high on
 * others. If fat came down to 0.7 or 0.65 g/kg and protein to 2.7, would the
 * fit close on all four macros, on all five day types?
 *
 * Run: npx tsx bench/macro-exact.ts
 */
import { REAL_DAY_TYPES, REAL_MEALS, REAL_PROFILE } from "./real-plan";
import { buildWeekPlan, targetsFor, type Macros, type Profile } from "../lib/nutrition";
import { fitWeek, weekStanding } from "../lib/weekfit";

const KEYS = ["kcal", "protein", "carbs", "fat"] as const;

/** What counts as "on the number". */
const TOL: Record<(typeof KEYS)[number], number> = { kcal: 25, protein: 3, carbs: 6, fat: 2 };

function assess(profile: Profile, label: string) {
  const plan = buildWeekPlan(profile, REAL_DAY_TYPES, { today: "2026-09-07" });
  const res = fitWeek(structuredClone(REAL_MEALS), plan, { mode: "balanced" });
  const standing = weekStanding(res.meals, plan);

  const used = standing.filter((s) => s.days > 0);
  let worst = 0;
  const misses: string[] = [];

  console.log(`\n${label}`);
  console.log(
    "  day            days   kcal        protein      carbs        fat"
  );
  for (const s of used) {
    const cells = KEYS.map((k) => {
      const d = s.planned[k] - s.target[k];
      const ok = Math.abs(d) <= TOL[k];
      if (!ok) misses.push(`${s.name} ${k} ${d > 0 ? "+" : ""}${Math.round(d)}`);
      worst = Math.max(worst, Math.abs(d) / Math.max(1, s.target[k]));
      const txt = `${Math.round(s.planned[k])}${d >= 0 ? "+" : ""}${Math.round(d)}`;
      return (ok ? " " : "!") + txt.padEnd(11);
    });
    console.log(`  ${s.name.padEnd(13)} ${String(s.days).padStart(2)}   ${cells.join(" ")}`);
  }
  console.log(`  worst relative miss ${(worst * 100).toFixed(1)}%`);
  if (misses.length) console.log(`  off: ${misses.join(", ")}`);
  else console.log("  every macro on every day, within tolerance");
  return misses.length;
}

console.log("Targets are the block's, on a Monday in week 2. Tolerance: 25 kcal, 3 g P, 6 g C, 2 g F.");
console.log(`Protein basis: ${REAL_PROFILE.protein_basis}, no body fat figure, so lean mass is assumed.`);

const combos: { fat: number; protein: number }[] = [
  { fat: 0.8, protein: 2.8 },
  { fat: 0.7, protein: 2.8 },
  { fat: 0.7, protein: 2.7 },
  { fat: 0.65, protein: 2.7 },
];

const results = combos.map((c) => ({
  ...c,
  misses: assess(
    { ...REAL_PROFILE, fat_per_kg: c.fat, protein_per_kg: c.protein },
    `fat ${c.fat} g/kg · protein ${c.protein} g/kg lean`
  ),
}));

console.log("\n=== summary ===");
for (const r of results) {
  console.log(
    `  fat ${r.fat}  protein ${r.protein}  ->  ${r.misses === 0 ? "all clear" : `${r.misses} macro-days off`}`
  );
}
