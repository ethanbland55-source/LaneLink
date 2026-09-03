/**
 * Does a weigh-in actually reach the shopping list?
 *
 * The chain has a lot of links: a measurement becomes a body fat figure,
 * the figure becomes a weekly snapshot, the snapshot becomes lean mass,
 * lean mass becomes the protein target, and the targets become quantities in
 * the trolley. Any one of them silently dropping the ball would leave the plan
 * looking right and drifting.
 *
 * Run: npx tsx bench/weekly-chain.ts
 */
import { REAL_DAY_TYPES, REAL_MEALS, REAL_PROFILE } from "./real-plan";
import {
  buildWeekPlan,
  estimatedBodyFat,
  leanMass,
  planWeight,
  proteinTarget,
  targetsFor,
  type Profile,
} from "../lib/nutrition";
import { applyRoll, rollState, planDayForShop } from "../lib/weekly";
import { skinfoldBodyFat } from "../lib/bodyfat";
import { buildShoppingList } from "../lib/shopping";
import type { WeighIn } from "../lib/trend";

const AGE = 21;

/** Three weeks of weigh-ins at scattered times, with a caliper reading each Monday. */
function history(startKg: number, weeklyLossKg: number, sfStart: number): any[] {
  const out: any[] = [];
  const times = ["06:45", "07:20", "09:10", "21:30", "07:05", "13:00", "07:40"];
  for (let d = 0; d < 21; d++) {
    const day = new Date(Date.UTC(2026, 7, 17 + d)).toISOString().slice(0, 10);
    const trueKg = startKg - (weeklyLossKg * d) / 7;
    const at = times[d % times.length];
    const hour = Number(at.slice(0, 2)) + Number(at.slice(3)) / 60;
    // What the scale would actually read at that hour, plus a little noise.
    const reading = trueKg + Math.max(0, Math.min(14, hour - 6)) * 0.085 + Math.sin(d * 2.3) * 0.25;

    const e: any = { day, weight_kg: Math.round(reading * 10) / 10, waist_cm: null, at_time: at };

    // Monday: calipers. Skinfolds shrink as the recomp works.
    if (d % 7 === 0) {
      const drop = (d / 7) * 1.2;
      const sites = [sfStart - drop, sfStart + 6 - drop, sfStart + 2 - drop];
      const bf = skinfoldBodyFat({ sex: "male", ageYears: AGE, sites, weightKg: trueKg });
      e.bf_pct = bf?.pct ?? null;
      e.bf_method = "skinfold";
      e.sf_chest = sites[0];
      e.sf_abdomen = sites[1];
      e.sf_thigh = sites[2];
      // The tape is still taken alongside, as the backup.
      e.waist_cm = 81 - drop * 0.35;
      e.neck_cm = 39;
    }
    out.push(e);
  }
  return out;
}

const entries = history(78.8, 0.15, 8);

console.log("=== 1. the measurement becomes a body fat figure ===");
for (const e of entries.filter((x) => x.bf_pct != null)) {
  console.log(
    `  ${e.day}  calipers ${e.sf_chest.toFixed(1)}/${e.sf_abdomen.toFixed(1)}/${e.sf_thigh.toFixed(1)} mm` +
      `  -> ${e.bf_pct}%   (tape also logged: waist ${e.waist_cm.toFixed(1)} cm)`
  );
}

console.log("\n=== 2. roll day turns it into the plan's figures ===");
let p: Profile = { ...REAL_PROFILE, plan_roll_dow: 1 };
const mondays = ["2026-08-24", "2026-08-31", "2026-09-07"];
for (const mon of mondays) {
  const seen = entries.filter((e) => e.day <= mon);
  const st = rollState(p, seen as WeighIn[], mon);
  if (!st.figures) {
    console.log(`  ${mon}  not enough readings yet`);
    continue;
  }
  p = applyRoll(p, st.figures, st.dueOn);
  const bf = estimatedBodyFat(p);
  console.log(
    `  ${mon}  due=${String(st.due).padEnd(5)} plan weight ${planWeight(p)} kg  ` +
      `body fat ${bf?.pct ?? "—"}% (${bf?.label ?? "none"})  lean ${leanMass(p)?.toFixed(1) ?? "—"} kg  ` +
      `-> protein ${Math.round(proteinTarget(p))} g`
  );
}

console.log("\n=== 3. the targets that produces, and the fat share ===");
const plan = buildWeekPlan(p, REAL_DAY_TYPES, { today: "2026-09-07" });
for (const id of plan.order) {
  const t = targetsFor(plan, id);
  if (!Object.values(plan.week).includes(id)) continue;
  const fatPct = (t.fat * 9) / t.kcal;
  console.log(
    `  ${t.name.padEnd(12)} ${String(t.kcal).padStart(4)} kcal  P ${t.protein}  C ${t.carbs}  F ${t.fat}` +
      `   fat ${(fatPct * 100).toFixed(0)}% of kcal, ${(t.fat / planWeight(p)).toFixed(2)} g/kg`
  );
}

console.log("\n=== 4. and the shopping list follows it ===");
for (const [label, prof] of [
  ["before any roll", { ...REAL_PROFILE, plan_roll_dow: 1 }],
  ["after 3 rolls  ", p],
] as [string, Profile][]) {
  const pl = buildWeekPlan(prof, REAL_DAY_TYPES, { today: planDayForShop(1, "2026-09-05") });
  const list = buildShoppingList(REAL_MEALS as any, prof, pl, { days: 7, startDay: "2026-09-05" });
  const chicken = list.lines.find((l) => l.name.toLowerCase().includes("chicken"));
  console.log(
    `  ${label}  plan weight ${planWeight(prof)} kg  ` +
      `week avg ${pl.goalKcal} kcal  total ${list.totalKg.toFixed(2)} kg  ` +
      `chicken ${Math.round(chicken?.needGrams ?? 0)} g`
  );
}
