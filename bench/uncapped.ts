/**
 * What removing the 3100 kcal cap does, and how to survive it.
 *
 * The override was doing more than pinning a number. It was holding the whole
 * plan still: with a fixed weekly average the targets never moved, so a re-fit
 * never had anything to re-fit. Clearing it lets the toned-maintenance drift
 * work as designed — and the first thing that drift does is ask for fewer
 * calories than the plan currently delivers.
 *
 * The question this bench answers is not "can the solver hit the new targets".
 * It obviously can. It is "what does it do to the plan on the way", because the
 * free fit's answer was to cut the rice cakes from 70 g to 43 g and leave most
 * of breakfast alone — the same calories, a completely different breakfast.
 *
 * Run: npx tsx bench/uncapped.ts
 */

import { buildWeekPlan, targetsFor, type Profile } from "../lib/nutrition";
import { fitWeek } from "../lib/weekfit";
import type { Drift } from "../lib/optimise";
import { REAL_DAY_TYPES, REAL_MEALS, REAL_PROFILE } from "./real-plan";

const MONDAY = "2026-09-07";

function withOverride(kcal: number | null): Profile {
  return { ...REAL_PROFILE, calorie_override: kcal } as Profile;
}

function run(profile: Profile, drift: Drift) {
  const plan = buildWeekPlan(profile, REAL_DAY_TYPES, { today: MONDAY });
  const res = fitWeek(structuredClone(REAL_MEALS), plan, { mode: "balanced", drift });
  return { plan, res };
}

/** Every portion, before and after, as a relative move. */
function moves(after: ReturnType<typeof run>["res"]) {
  const out: { name: string; from: number; to: number; rel: number }[] = [];
  for (const m of after.meals) {
    const was = REAL_MEALS.find((x) => x.id === m.id);
    if (!was) continue;
    m.ingredients.forEach((it, i) => {
      const from = Number(was.ingredients[i]?.grams ?? 0);
      const to = Number(it.grams);
      if (from <= 0) return;
      out.push({ name: `${m.name} · ${it.name}`, from, to, rel: (to - from) / from });
    });
  }
  return out.sort((a, b) => Math.abs(b.rel) - Math.abs(a.rel));
}

function accuracy(res: ReturnType<typeof run>["res"]) {
  const live = res.days.filter((d) => d.weight > 0);
  let worst = 0;
  let kcal = 0;
  let missed = 0;
  for (const d of live) {
    for (const k of ["kcal", "protein", "carbs", "fat"] as const) {
      const rel = Math.abs(d.residual[k]) / (d.target[k] || 1);
      if (rel > worst) worst = rel;
      if (!d.hit[k]) missed++;
    }
    kcal += Math.abs(d.residual.kcal) * d.weight;
  }
  const days = live.reduce((a, d) => a + d.weight, 0) || 1;
  return { worst, kcalPerDay: kcal / days, missed };
}

/* ---- 1. what the targets themselves do -------------------------------- */

console.log("=== Weekly targets, with the cap and without ===\n");
for (const [label, prof] of [
  ["cap 3100", withOverride(3100)],
  ["no cap  ", withOverride(null)],
] as const) {
  const plan = buildWeekPlan(prof, REAL_DAY_TYPES, { today: MONDAY });
  const line = plan.order
    .map((id) => {
      const t = targetsFor(plan, id);
      return `${t.name} ${Math.round(t.kcal)}`;
    })
    .join("  ");
  console.log(`${label}  ${line}`);
}

/* ---- 2. what the fit does to the plan ---------------------------------- */

console.log("\n=== Re-fitting to the uncapped targets ===\n");

const results: Record<string, ReturnType<typeof run>> = {
  free: run(withOverride(null), "free"),
  keep_close: run(withOverride(null), "keep_close"),
};

for (const [label, r] of Object.entries(results)) {
  const mv = moves(r.res);
  const acc = accuracy(r.res);
  const biggest = mv[0];
  const mean = mv.reduce((a, m) => a + Math.abs(m.rel), 0) / mv.length;
  console.log(
    `${label.padEnd(11)} worst macro ${(acc.worst * 100).toFixed(2)}%  ` +
      `kcal/day ${acc.kcalPerDay.toFixed(0)}  misses ${acc.missed}  ` +
      `| biggest move ${biggest.name} ${biggest.from}→${biggest.to.toFixed(0)} g ` +
      `(${(biggest.rel * 100).toFixed(0)}%)  mean move ${(mean * 100).toFixed(1)}%`
  );
}

console.log("\n--- every portion, free vs keep_close ---\n");
const free = new Map(moves(results.free.res).map((m) => [m.name, m]));
const close = moves(results.keep_close.res);
console.log("portion".padEnd(30) + "now".padStart(7) + "free".padStart(9) + "close".padStart(9));
for (const m of close.sort((a, b) => a.name.localeCompare(b.name))) {
  const f = free.get(m.name);
  console.log(
    m.name.padEnd(30) +
      `${m.from}`.padStart(7) +
      `${f ? f.to.toFixed(0) : "-"}`.padStart(9) +
      `${m.to.toFixed(0)}`.padStart(9)
  );
}

/* ---- 3. the two portions he named -------------------------------------- */

console.log("\n=== The ones that matter ===\n");
for (const name of ["Breakfast · Rice Cakes", "Post Swim · Greek Yohurt"]) {
  const f = free.get(name);
  const c = close.find((m) => m.name === name);
  if (!f || !c) continue;
  console.log(
    `${name.padEnd(26)} now ${f.from} g   free ${f.to.toFixed(0)} g ` +
      `(${(f.rel * 100).toFixed(0)}%)   keep_close ${c.to.toFixed(0)} g (${(c.rel * 100).toFixed(0)}%)`
  );
}

/* ---- 4. does keeping close cost accuracy? ------------------------------ */

const a = accuracy(results.free.res);
const b = accuracy(results.keep_close.res);
console.log(
  `\nAccuracy paid for staying close: worst macro ${(a.worst * 100).toFixed(2)}% → ` +
    `${(b.worst * 100).toFixed(2)}%, ${a.kcalPerDay.toFixed(0)} → ${b.kcalPerDay.toFixed(0)} kcal/day.`
);

/* ---- 5. a genuinely large cut ------------------------------------------ */

/**
 * The uncapped targets turn out to be *slightly higher* than the 3100 cap, so
 * the fit above barely moves — which means it does not test the thing that
 * matters. Whatever moved on the live database moved further than that, so
 * force the targets down hard and watch where the cut lands. This is the case
 * that separates the two drift settings.
 */
console.log("\n=== A forced 8% cut, to see where a real change lands ===\n");

const cut = buildWeekPlan(withOverride(null), REAL_DAY_TYPES, { today: MONDAY });
for (const id of cut.order) {
  const t = cut.byId[id];
  if (!t) continue;
  // Calories and carbs take the cut; protein holds, as toned maintenance says.
  cut.byId[id] = { ...t, kcal: t.kcal * 0.92, carbs: t.carbs * 0.86, fat: t.fat * 0.94 };
}

for (const drift of ["free", "keep_close"] as Drift[]) {
  const r = fitWeek(structuredClone(REAL_MEALS), cut, { mode: "balanced", drift });
  const mv = moves(r);
  const acc = accuracy(r);
  const mean = mv.reduce((a, m) => a + Math.abs(m.rel), 0) / mv.length;
  console.log(
    `${drift.padEnd(11)} worst macro ${(acc.worst * 100).toFixed(2)}%  ` +
      `kcal/day ${acc.kcalPerDay.toFixed(0)}  mean move ${(mean * 100).toFixed(1)}%  ` +
      `biggest ${mv[0].name} ${mv[0].from}→${mv[0].to.toFixed(0)} g (${(mv[0].rel * 100).toFixed(0)}%)`
  );
  console.log(
    "            " +
      mv
        .slice(0, 6)
        .map((m) => `${m.name.split(" · ")[1]} ${(m.rel * 100).toFixed(0)}%`)
        .join(", ")
  );
}

const maxMove = Math.max(...close.map((m) => Math.abs(m.rel)));
const ok = b.worst <= 0.05 && maxMove <= 0.25;
console.log(
  ok
    ? `\nPASS — every macro within 5% and no portion moved more than ${(maxMove * 100).toFixed(0)}%.`
    : `\nFAIL — worst macro ${(b.worst * 100).toFixed(1)}%, biggest move ${(maxMove * 100).toFixed(0)}%.`
);
process.exit(ok ? 0 : 1);
