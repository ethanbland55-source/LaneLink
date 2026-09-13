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
import { steerPlan } from "../lib/steer";
import { buildShoppingList } from "../lib/shopping";
import { composition, weightRate, type WeighIn } from "../lib/trend";

/**
 * Five weeks of weigh-ins at scattered times, with a scan every Monday and
 * every Saturday — the two days the plan already turns on.
 *
 * The scans carry their own noise on purpose. Bioimpedance reads hydration, so
 * the whole point of the machinery downstream is that it does not react to one
 * of them, and a fixture with a perfectly clean slope would prove nothing.
 */
function history(startKg: number, weeklyLossKg: number, bfStart: number, bfPerWeek: number): any[] {
  const out: any[] = [];
  const times = ["06:45", "07:20", "09:10", "21:30", "07:05", "13:00", "07:40"];
  for (let d = 0; d < 35; d++) {
    const date = new Date(Date.UTC(2026, 7, 3 + d));
    const day = date.toISOString().slice(0, 10);
    const trueKg = startKg - (weeklyLossKg * d) / 7;
    const at = times[d % times.length];
    const hour = Number(at.slice(0, 2)) + Number(at.slice(3)) / 60;
    // What the scale would actually read at that hour, plus a little noise.
    const reading = trueKg + Math.max(0, Math.min(14, hour - 6)) * 0.085 + Math.sin(d * 2.3) * 0.25;

    const e: any = { day, weight_kg: Math.round(reading * 10) / 10, at_time: at };

    const dow = date.getUTCDay();
    if (dow === 1 || dow === 6) {
      const trueBf = bfStart + (bfPerWeek * d) / 7;
      e.bf_pct = Math.round((trueBf + Math.sin(d * 1.9) * 0.35) * 10) / 10;
      e.bf_method = "scan";
    }
    out.push(e);
  }
  return out;
}

const entries = history(78.8, 0.15, 13.4, -0.22);

console.log("=== 1. the scans, and what they say you are made of ===");
{
  const comp = composition(entries as WeighIn[]);
  for (const pt of comp?.points ?? []) {
    console.log(
      `  ${pt.day}  ${pt.bfPct}%  of ${pt.weightKg} kg trend  ->  ${pt.leanKg} kg lean, ${pt.fatKg} kg fat`
    );
  }
  console.log(
    `  ${comp?.scans} scans over ${comp?.days} days: body fat ${comp?.bfPtsPerMonth.toFixed(2)} pts/month, ` +
      `lean ${comp?.leanKgPerMonth.toFixed(2)} kg/month, fat ${comp?.fatKgPerMonth.toFixed(2)} kg/month ` +
      `(settled: ${comp?.settled})`
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
  const maintenance = buildWeekPlan(p, REAL_DAY_TYPES, { today: mon }).maintenance;
  const steer = steerPlan(p, weightRate(seen as WeighIn[]), composition(seen as WeighIn[]), maintenance);
  p = applyRoll(p, st.figures, st.dueOn, steer);
  const bf = estimatedBodyFat(p);
  console.log(
    `  ${mon}  due=${String(st.due).padEnd(5)} plan weight ${planWeight(p)} kg  ` +
      `body fat ${bf?.pct ?? "—"}% (${bf?.label ?? "none"})  lean ${leanMass(p)?.toFixed(1) ?? "—"} kg  ` +
      `-> protein ${Math.round(proteinTarget(p))} g`
  );
  console.log(
    `             steer: ${steer.headline}` +
      (steer.moving ? ` (${steer.kcal > 0 ? "+" : ""}${steer.kcal} kcal, now ${steer.totalKcal})` : "")
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
