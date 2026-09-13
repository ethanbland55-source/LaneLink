/**
 * Does a calorie change come off every meal evenly?
 * Run with: npx tsx bench/even-spread.ts
 *
 * The weekly steer moves the target by 1–3%, and the roll re-fits the plan to
 * it. The ask is that the change is shared across the meals "as equally as it
 * can" rather than landing on whichever ingredient is cheapest to move. This
 * runs the real plan through a 3% cut and a 3% rise, with and without the
 * even share, and prints how much each meal moved.
 *
 * Passes when the even fit's meals sit closer together than keep_close alone
 * managed, and the week still lands within 1% of its target.
 */
import { buildWeekPlan, totalFor, type Profile } from "../lib/nutrition";
import { fitWeek, weeklyAverage } from "../lib/weekfit";
import { REAL_DAY_TYPES, REAL_MEALS, REAL_PROFILE } from "./real-plan";

let failures = 0;

function spread(step: number) {
  const p: Profile = { ...REAL_PROFILE, calorie_override: null, recomp_adjust: step };
  const plan = buildWeekPlan(p, REAL_DAY_TYPES);
  // Start from a plan fitted to the unsteered target, so the only thing the
  // re-fit has to answer is the step.
  const start = fitWeek(REAL_MEALS, buildWeekPlan({ ...p, recomp_adjust: 0 }, REAL_DAY_TYPES), {
    mode: "balanced",
    drift: "free",
  }).meals;

  const out: Record<string, number[]> = {};
  const result = (even: boolean) => {
    const fitted = fitWeek(start, plan, { mode: "balanced", drift: "keep_close", even }).meals;
    const moves = start
      .map((m, i) => {
        const a = totalFor(m.ingredients).kcal;
        const b = totalFor(fitted[i].ingredients).kcal;
        return { name: m.name, pct: a > 0 ? ((b - a) / a) * 100 : 0, a };
      })
      .filter((x) => x.a > 30);
    const week = weeklyAverage(fitted, plan);
    return { moves, week };
  };

  console.log(`\n=== target ${step > 0 ? "+" : ""}${(step * 100).toFixed(0)}% ===`);
  for (const even of [false, true]) {
    const r = result(even);
    const pcts = r.moves.map((x) => x.pct);
    const width = Math.max(...pcts) - Math.min(...pcts);
    const miss = ((r.week.planned.kcal - r.week.target.kcal) / r.week.target.kcal) * 100;
    out[even ? "even" : "close"] = [width, miss];
    console.log(
      `  ${even ? "even      " : "keep_close"}  meals moved ${Math.min(...pcts).toFixed(1)}% to ${Math.max(...pcts).toFixed(1)}%  ` +
        `(spread ${width.toFixed(1)} pts)  week ${miss >= 0 ? "+" : ""}${miss.toFixed(1)}% of target`
    );
    console.log(
      "    " + r.moves.map((x) => `${x.name} ${x.pct >= 0 ? "+" : ""}${x.pct.toFixed(1)}%`).join(" · ")
    );
  }
  const [cw] = out.close;
  const [ew, em] = out.even;
  if (!(ew <= cw + 0.5)) {
    failures++;
    console.log(`  FAIL even share is less even than keep_close (${ew.toFixed(1)} vs ${cw.toFixed(1)})`);
  }
  if (Math.abs(em) > 1) {
    failures++;
    console.log(`  FAIL the week misses by ${em.toFixed(1)}%`);
  }
}

spread(-0.03);
spread(0.03);

console.log(failures === 0 ? "\nPASS" : `\nFAIL — ${failures}`);
process.exit(failures === 0 ? 0 : 1);
