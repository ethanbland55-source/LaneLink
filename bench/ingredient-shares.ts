/**
 * Ingredient shares: "half the bowl should be yoghurt".
 * Run with: npx tsx bench/ingredient-shares.ts
 */
import { buildWeekPlan, itemMacros, sumMacros } from "../lib/nutrition";
import { fitWeek } from "../lib/weekfit";
import { REAL_DAY_TYPES, REAL_MEALS, REAL_PROFILE } from "./real-plan";

const plan = buildWeekPlan(REAL_PROFILE, REAL_DAY_TYPES, { today: "2026-08-31" });

function run(label: string, shares: (number | null)[] | null) {
  const meals = structuredClone(REAL_MEALS).map((m: any) => {
    if (m.id === 4 && shares) {
      m.ingredients.forEach((it: any, i: number) => (it.share_pct = shares[i]));
    }
    return m;
  });

  const res = fitWeek(meals, plan);
  const post = res.meals.find((m) => m.id === 4)!;
  const total = sumMacros(post.ingredients.map(itemMacros)).kcal;

  console.log(`\n--- ${label} ---`);
  for (const it of post.ingredients) {
    const k = itemMacros(it).kcal;
    console.log(
      `  ${it.name.padEnd(16)} ${String(Math.round(Number(it.grams))).padStart(4)} g  ` +
        `${String(Math.round(k)).padStart(4)} kcal  ${((k / total) * 100).toFixed(0).padStart(3)}%` +
        (it.share_pct != null ? `  (asked ${it.share_pct}%)` : "")
    );
  }
  console.log(`  ${"".padEnd(16)} ${"".padStart(4)}    ${Math.round(total)} kcal total`);

  const live = res.days.filter((d) => d.weight > 0);
  const mean =
    live.reduce((a, d) => a + Math.abs(d.residual.kcal) * d.weight, 0) /
    live.reduce((a, d) => a + d.weight, 0);
  console.log(
    `  week ${res.weekly.after.kcal - res.weekly.target.kcal >= 0 ? "+" : ""}` +
      `${Math.round(res.weekly.after.kcal - res.weekly.target.kcal)} kcal/day, mean daily miss ${mean.toFixed(0)}`
  );
  for (const s of res.shares.filter((x) => x.name.startsWith("Post Swim ·") && x.blocked)) {
    console.log(`  ! ${s.name}: wanted ${Math.round(s.want * 100)}%, got ${Math.round(s.got * 100)}% — held at its ${s.blocked}`);
  }
}

run("as written, no ingredient shares", null);
run("50 yoghurt / 40 granola / 10 honey", [50, 40, 10]);
run("70 yoghurt / 25 granola / 5 honey", [70, 25, 5]);
run("just pin the honey at 10%", [null, null, 10]);
