/** Shares: does telling it 20/80 actually move the split, and does it say so when it can't? */
import { buildWeekPlan, itemMacros, sumMacros } from "../lib/nutrition";
import { fitWeek } from "../lib/weekfit";
import { REAL_DAY_TYPES, REAL_MEALS, REAL_PROFILE } from "./real-plan";

const plan = buildWeekPlan(REAL_PROFILE, REAL_DAY_TYPES, { today: "2026-08-31" });
const kcal = (m: any) => sumMacros(m.ingredients.map(itemMacros)).kcal;

function run(label: string, pre: number | null, post: number | null, relax = false) {
  const meals = structuredClone(REAL_MEALS).map((m: any) => {
    if (m.id === 3) m.share_pct = pre;
    if (m.id === 4) m.share_pct = post;
    if (relax && m.id === 3) m.ingredients[0].min_grams = 30;
    if (relax && m.id === 4) {
      m.ingredients[0].min_grams = 200;
      m.ingredients[1].min_grams = 40;
      m.ingredients[1].max_grams = 200;
    }
    return m;
  });
  const res = fitWeek(meals, plan);
  const preK = kcal(res.meals.find((m) => m.id === 3));
  const postK = kcal(res.meals.find((m) => m.id === 4));
  const tot = preK + postK;
  console.log(
    `${label.padEnd(34)} pre ${String(Math.round(preK)).padStart(4)} (${((preK / tot) * 100).toFixed(0).padStart(2)}%)  ` +
      `post ${String(Math.round(postK)).padStart(4)} (${((postK / tot) * 100).toFixed(0).padStart(2)}%)  ` +
      `swim day ${String(Math.round(res.days.find((d) => d.id === 3)!.after.kcal)).padStart(4)}/${res.days.find((d) => d.id === 3)!.target.kcal}`
  );
  if (res.suggestions.length) {
    for (const s of res.suggestions.slice(0, 2)) {
      console.log(
        `      would help: ${s.direction === "up" ? "allow up to" : "allow down to"} ${s.to} g of ${s.name.toLowerCase()}` +
          (s.dayName ? ` (${s.dayName})` : "")
      );
    }
  }
  return res;
}

run("no shares set", null, null);
run("20 / 80", 20, 80);
run("25 / 75", 25, 75);
run("20 / 80, limits relaxed", 20, 80, true);
run("50 / 50, limits relaxed", 50, 50, true);
