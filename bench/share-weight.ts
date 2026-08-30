/** How hard should a share pull? Strong enough to pick the split, not to cost calories. */
import { buildWeekPlan, itemMacros, sumMacros } from "../lib/nutrition";
import { fitWeek } from "../lib/weekfit";
import { REAL_DAY_TYPES, REAL_MEALS, REAL_PROFILE } from "./real-plan";

const plan = buildWeekPlan(REAL_PROFILE, REAL_DAY_TYPES, { today: "2026-08-31" });
const kcal = (m: any) => sumMacros(m.ingredients.map(itemMacros)).kcal;

function build(shares: boolean, relax: boolean) {
  return structuredClone(REAL_MEALS).map((m: any) => {
    if (shares && m.id === 3) m.share_pct = 20;
    if (shares && m.id === 4) m.share_pct = 80;
    if (relax && m.id === 3) m.ingredients[0].min_grams = 30;
    if (relax && m.id === 4) {
      m.ingredients[0].min_grams = 200;
      m.ingredients[1].min_grams = 40;
      m.ingredients[1].max_grams = 200;
    }
    return m;
  });
}

for (const [label, shares, relax] of [
  ["no shares, tight limits", false, false],
  ["no shares, relaxed", false, true],
  ["20/80, tight limits", true, false],
  ["20/80, relaxed", true, true],
] as const) {
  const res = fitWeek(build(shares, relax), plan);
  const pre = kcal(res.meals.find((m) => m.id === 3));
  const post = kcal(res.meals.find((m) => m.id === 4));
  const live = res.days.filter((d) => d.weight > 0);
  const worst = Math.max(...live.map((d) => Math.abs(d.residual.kcal)));
  const mean =
    live.reduce((a, d) => a + Math.abs(d.residual.kcal) * d.weight, 0) /
    live.reduce((a, d) => a + d.weight, 0);
  console.log(
    `${label.padEnd(26)} split ${((pre / (pre + post)) * 100).toFixed(0).padStart(2)}/${((post / (pre + post)) * 100).toFixed(0)}  ` +
      `mean |kcal miss| ${mean.toFixed(0).padStart(3)}  worst ${worst.toFixed(0).padStart(3)}  ` +
      `weekly ${(res.weekly.after.kcal - res.weekly.target.kcal).toFixed(0).padStart(4)}`
  );
}
