/** When a share can't be met, does it name the limit that's in the way? */
import { buildWeekPlan } from "../lib/nutrition";
import { fitWeek } from "../lib/weekfit";
import { REAL_DAY_TYPES, REAL_MEALS, REAL_PROFILE } from "./real-plan";

const plan = buildWeekPlan(REAL_PROFILE, REAL_DAY_TYPES, { today: "2026-08-31" });

function run(label: string, dateMin: number) {
  const meals = structuredClone(REAL_MEALS).map((m: any) => {
    if (m.id === 3) {
      m.share_pct = 20;
      m.ingredients[0].min_grams = dateMin;
    }
    if (m.id === 4) m.share_pct = 80;
    return m;
  });
  const res = fitWeek(meals, plan);
  console.log(`\n--- ${label} (dates min ${dateMin} g) ---`);
  for (const s of res.shares) {
    const line = `  ${s.name.padEnd(12)} wanted ${(s.want * 100).toFixed(0).padStart(3)}%  got ${(s.got * 100).toFixed(0).padStart(3)}%`;
    console.log(
      s.blocked
        ? `${line}  — held at its ${s.blocked === "min" ? "lower" : "upper"} limit; needs to be ${s.suggestGrams} g to reach ${(s.want * 100).toFixed(0)}%`
        : `${line}  — as asked`
    );
  }
  const dates = res.meals.find((m) => m.id === 3)!.ingredients[0];
  console.log(`  dates ${Math.round(Number(dates.grams))} g`);
  for (const d of res.days.filter((x) => x.weight > 0)) {
    console.log(
      `  ${d.name.padEnd(12)} ${String(Math.round(d.after.kcal)).padStart(4)} / ${d.target.kcal} kcal  (${d.residual.kcal >= 0 ? "+" : ""}${Math.round(d.residual.kcal)})`
    );
  }
}

run("as configured", 100);
run("dates limit relaxed", 40);
