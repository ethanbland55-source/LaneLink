/**
 * How hard should a re-fit hold on to the plan you already have?
 *
 * There is a straight trade here and it is worth seeing the numbers. Weight the
 * anchor at nothing and the solver treats every gram as fungible: an 8 % cut
 * comes out of the banana, all of it, and breakfast is a different meal. Weight
 * it too hard and it refuses to move at all, and misses the targets it was
 * asked to hit.
 *
 * The sweep runs four sizes of change against seven anchor weights and reports
 * both sides: how far off the macros end up, and how far the single worst
 * portion moved. The setting the app ships with should be the one that keeps
 * the biggest move under about a fifth without paying more than a few dozen
 * kcal a day for it.
 *
 * Run: npx tsx bench/anchor-sweep.ts
 */

import { buildWeekPlan, type Profile } from "../lib/nutrition";
import { buildWeekFit } from "../lib/weekfit";
import { solveRows } from "../lib/optimise";
import { expand } from "../lib/batch";
import { REAL_DAY_TYPES, REAL_MEALS, REAL_PROFILE } from "./real-plan";

const MONDAY = "2026-09-07";
const prof = { ...REAL_PROFILE, calorie_override: null } as Profile;
const WEIGHTS = [0.004, 0.1, 0.3, 0.6, 0.9, 1.5, 3.0];

console.log("weight".padStart(7) + "worst%".padStart(9) + "kcal/day".padStart(10) + "maxmove".padStart(9) + "meanmove".padStart(10));

for (const scale of [1.0, 0.96, 0.92, 0.86]) {
  const plan = buildWeekPlan(prof, REAL_DAY_TYPES, { today: MONDAY });
  for (const id of plan.order) {
    const t = plan.byId[id];
    // Protein holds; calories and carbs take the change, fat about half of it.
    plan.byId[id] = {
      ...t,
      kcal: t.kcal * scale,
      carbs: t.carbs * (1 - (1 - scale) * 1.75),
      fat: t.fat * (1 - (1 - scale) * 0.75),
    };
  }

  console.log(`\n--- targets x${scale.toFixed(2)} ---`);
  for (const w of WEIGHTS) {
    const meals = structuredClone(REAL_MEALS);
    const fit = buildWeekFit(meals, plan, []);
    const res = solveRows(fit.items, fit.rows, {
      mode: "balanced",
      shares: fit.shares,
      anchorWeight: w,
    });
    const fitted = expand(fit.meals, fit.slots, res.grams);

    let worst = 0;
    let kcal = 0;
    let days = 0;
    for (const d of res.days) {
      if (d.weight <= 0) continue;
      days += d.weight;
      kcal += Math.abs(d.residual.kcal) * d.weight;
      for (const k of ["kcal", "protein", "carbs", "fat"] as const) {
        const rel = Math.abs(d.residual[k]) / (d.target[k] || 1);
        if (rel > worst) worst = rel;
      }
    }

    const rels: number[] = [];
    for (const m of fitted) {
      const was = REAL_MEALS.find((x) => x.id === m.id);
      if (!was) continue;
      m.ingredients.forEach((it, i) => {
        const from = Number(was.ingredients[i]?.grams ?? 0);
        if (from > 0) rels.push(Math.abs((Number(it.grams) - from) / from));
      });
    }
    const maxMove = Math.max(...rels);
    const meanMove = rels.reduce((a, b) => a + b, 0) / rels.length;

    console.log(
      `${w}`.padStart(7) +
        (worst * 100).toFixed(2).padStart(9) +
        (kcal / (days || 1)).toFixed(0).padStart(10) +
        `${(maxMove * 100).toFixed(0)}%`.padStart(9) +
        `${(meanMove * 100).toFixed(1)}%`.padStart(10)
    );
  }
}
