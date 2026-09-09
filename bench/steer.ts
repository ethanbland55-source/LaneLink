/**
 * The weekly steer, against cases where the right answer is known.
 * Run with: npx tsx bench/steer.ts
 *
 * Every case is a synthetic five weeks of weigh-ins and scans built to say one
 * thing unambiguously, so a wrong step here is a bug rather than a judgement
 * call. The point of the last two is that they *don't* move: noise and a
 * gentle-but-correct trend both have to leave the target alone, or the plan
 * would be chasing hydration around the calendar.
 */
import { normaliseProfile } from "../lib/profile";
import { buildWeekPlan, type Profile } from "../lib/nutrition";
import { STEER_LIMIT, STEER_STEP, steerRecomp } from "../lib/steer";
import { composition, weightRate, type WeighIn } from "../lib/trend";
import { REAL_DAY_TYPES, REAL_PROFILE } from "./real-plan";

const iso = (d: number) => new Date(Date.UTC(2026, 6, 1 + d)).toISOString().slice(0, 10);

/**
 * `days` of weigh-ins at 07:00 with a scan on Mondays and Saturdays.
 * Weight and body fat both move linearly; the noise is deterministic so a run
 * that changes is a change in the code, not in the dice.
 */
function series(opts: {
  startKg: number;
  kgPerWeek: number;
  startBf: number;
  bfPtsPerWeek: number;
  days?: number;
}): WeighIn[] {
  const out: WeighIn[] = [];
  const days = opts.days ?? 35;
  for (let d = 0; d < days; d++) {
    const day = iso(d);
    const kg = opts.startKg + (opts.kgPerWeek * d) / 7 + Math.sin(d * 2.3) * 0.22;
    const e: WeighIn = {
      day,
      weight_kg: Math.round(kg * 10) / 10,
      at_time: "07:00",
    };
    const dow = new Date(day + "T12:00:00").getDay();
    if (dow === 1 || dow === 6) {
      const bf = opts.startBf + (opts.bfPtsPerWeek * d) / 7 + Math.sin(d * 1.7) * 0.18;
      e.bf_pct = Math.round(bf * 10) / 10;
    }
    out.push(e);
  }
  return out;
}

const base: Profile = normaliseProfile({
  ...REAL_PROFILE,
  goal: "recomp",
  calorie_override: null,
  recomp_adjust: 0,
});
const maintenance = buildWeekPlan(base, REAL_DAY_TYPES).maintenance;

let failures = 0;

function check(
  name: string,
  entries: WeighIn[],
  expect: "up" | "down" | "hold",
  p: Profile = base
) {
  const comp = composition(entries);
  const rate = weightRate(entries);
  const s = steerRecomp(p, rate, comp, maintenance);
  const got = !s.moving ? "hold" : s.step > 0 ? "up" : "down";
  const ok = got === expect;
  if (!ok) failures++;

  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}`);
  console.log(
    `        bf ${comp ? comp.bfPtsPerMonth.toFixed(2) : "—"} pts/mo · ` +
      `lean ${comp ? comp.leanKgPerMonth.toFixed(2) : "—"} kg/mo · ` +
      `fat ${comp ? comp.fatKgPerMonth.toFixed(2) : "—"} kg/mo · ` +
      `weight ${rate ? rate.pctPerWeek.toFixed(2) : "—"}%/wk`
  );
  console.log(
    `        -> ${got}${s.moving ? ` ${s.kcal > 0 ? "+" : ""}${s.kcal} kcal` : ""} · ${s.headline}`
  );
  if (!ok) console.log(`        expected ${expect}`);
  console.log(`        ${s.detail}`);
  console.log();
  return s;
}

console.log(`=== maintenance ${maintenance} kcal, one step is ${Math.round(STEER_STEP * maintenance)} kcal ===\n`);

// Working: fat off, lean holding, weight barely moving.
check(
  "recomp working — fat down, lean holding",
  series({ startKg: 78.5, kgPerWeek: -0.05, startBf: 13.4, bfPtsPerWeek: -0.25 }),
  "hold"
);

// Weight flat and body fat flat: maintenance is higher than the plan thinks.
check(
  "nothing moving — weight flat, body fat flat",
  series({ startKg: 78.5, kgPerWeek: 0, startBf: 13.4, bfPtsPerWeek: 0 }),
  "down"
);

// Body fat climbing at a steady weight: the target is too high.
check(
  "body fat creeping up at a steady weight",
  series({ startKg: 78.5, kgPerWeek: 0.02, startBf: 13.0, bfPtsPerWeek: 0.2 }),
  "down"
);

// Losing weight, and it is coming out of lean mass.
check(
  "lean mass leaving — the expensive failure",
  series({ startKg: 79, kgPerWeek: -0.35, startBf: 13.4, bfPtsPerWeek: 0.05 }),
  "up"
);

// Coming off far too fast, even though the fat is going.
check(
  "dropping too fast overall",
  series({ startKg: 80, kgPerWeek: -0.8, startBf: 14, bfPtsPerWeek: -0.5 }),
  "up"
);

// Two scans in ten days is not evidence of anything.
check(
  "too little data to act on",
  series({ startKg: 78.5, kgPerWeek: 0, startBf: 13.4, bfPtsPerWeek: 0, days: 12 }),
  "hold"
);

console.log("=== it stops at the limit rather than running away ===\n");
const flat = series({ startKg: 78.5, kgPerWeek: 0, startBf: 13.4, bfPtsPerWeek: 0 });
let p: Profile = base;
for (let week = 1; week <= 8; week++) {
  const s = steerRecomp(p, weightRate(flat), composition(flat), maintenance);
  p = { ...p, recomp_adjust: s.next };
  const target = Math.round(buildWeekPlan(p, REAL_DAY_TYPES).goalKcal);
  console.log(
    `  week ${week}: ${s.moving ? `${s.kcal} kcal` : "held"}  ` +
      `total ${(p.recomp_adjust * 100).toFixed(1)}%  target ${target} kcal` +
      (s.atLimit ? "  (at the limit)" : "")
  );
}
if (Math.abs(p.recomp_adjust) > STEER_LIMIT + 1e-9) {
  failures++;
  console.log(`  FAIL ran past the ${(STEER_LIMIT * 100).toFixed(0)}% limit`);
}

console.log("\n=== a goal that isn't a recomposition is left alone ===\n");
const cutting = check(
  "cutting",
  flat,
  "hold",
  normaliseProfile({ ...REAL_PROFILE, goal: "cut", calorie_override: null })
);
if (cutting.moving) failures++;

console.log(failures === 0 ? "\nPASS" : `\nFAIL — ${failures} case${failures === 1 ? "" : "s"}`);
process.exit(failures === 0 ? 0 : 1);
