/**
 * The weekly steer, against cases where the right answer is known.
 * Run with: npx tsx bench/steer.ts
 *
 * Every case is a synthetic five weeks of weigh-ins and scans built to say one
 * thing unambiguously, so a wrong step here is a bug rather than a judgement
 * call. The grid is the one the steer is written around — weight against body
 * fat, each above, inside or below what the goal is aiming for — run for the
 * goal that needs it most (toned maintenance) and then for the others.
 */
import { normaliseProfile } from "../lib/profile";
import { buildWeekPlan, type Goal, type Pace, type Profile } from "../lib/nutrition";
import { RECOMP_CUT, STEER_LIMIT, STEER_MAX_STEP, steerPlan, steerSignals } from "../lib/steer";
import { type WeighIn } from "../lib/trend";
import { REAL_DAY_TYPES, REAL_PROFILE } from "./real-plan";

const iso = (d: number) => new Date(Date.UTC(2026, 6, 1 + d)).toISOString().slice(0, 10);

/**
 * `days` of weigh-ins at 07:00 with a scan on Mondays and Saturdays. Weight
 * and body fat both move linearly; the noise is deterministic so a run that
 * changes is a change in the code, not in the dice.
 */
function series(opts: {
  startKg?: number;
  kgPerWeek: number;
  startBf?: number;
  bfPtsPerWeek: number;
  days?: number;
  muscleKgPerWeek?: number;
}): WeighIn[] {
  const out: WeighIn[] = [];
  const days = opts.days ?? 35;
  const startKg = opts.startKg ?? 78;
  const startBf = opts.startBf ?? 13;
  for (let d = 0; d < days; d++) {
    const day = iso(d);
    const kg = startKg + (opts.kgPerWeek * d) / 7 + Math.sin(d * 2.3) * 0.22;
    const e: WeighIn = { day, weight_kg: Math.round(kg * 10) / 10, at_time: "07:00" };
    const dow = new Date(day + "T12:00:00").getDay();
    if (dow === 1 || dow === 6) {
      const bf = startBf + (opts.bfPtsPerWeek * d) / 7 + Math.sin(d * 1.7) * 0.18;
      e.bf_pct = Math.round(bf * 10) / 10;
      e.water_pct = Math.round((100 - bf) * 0.73 * 10) / 10;
      if (opts.muscleKgPerWeek != null) {
        e.muscle_kg = Math.round((63 + (opts.muscleKgPerWeek * d) / 7) * 10) / 10;
      }
    }
    out.push(e);
  }
  return out;
}

function profileFor(goal: Goal, pace: Pace = "steady", extra: Partial<Profile> = {}): Profile {
  return normaliseProfile({
    ...REAL_PROFILE,
    goal,
    pace,
    calorie_override: null,
    recomp_adjust: 0,
    ...extra,
  });
}

const base = profileFor("recomp");
const maintenance = buildWeekPlan(base, REAL_DAY_TYPES).maintenance;

let failures = 0;

function check(
  name: string,
  entries: WeighIn[],
  expect: "up" | "down" | "hold",
  p: Profile = base,
  tone?: "good" | "watch" | "bad" | "neutral",
  applyOn?: string
) {
  const { rate, comp } = steerSignals(entries);
  const s = steerPlan(p, rate, comp, maintenance, { applyOn });
  const got = !s.moving ? "hold" : s.step > 0 ? "up" : "down";
  const ok = got === expect && (!tone || s.tone === tone);
  if (!ok) failures++;

  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}`);
  console.log(
    `        weight ${rate ? rate.kgPerWeek.toFixed(2) : "—"} kg/wk (${s.weight}) · ` +
      `bf ${comp ? comp.bfPtsPerMonth.toFixed(2) : "—"} pts/mo (${s.bf}) · ` +
      `lean ${comp ? comp.leanKgPerMonth.toFixed(2) : "—"} kg/mo`
  );
  console.log(
    `        -> ${got}${s.moving ? ` ${s.kcal > 0 ? "+" : ""}${s.kcal} kcal` : ""} · ${s.tone} · ${s.headline}`
  );
  if (!ok) console.log(`        expected ${expect}${tone ? ` (${tone})` : ""}`);
  console.log(`        ${s.detail}`);
  console.log();
  return s;
}

console.log(`=== maintenance ${maintenance} kcal ===\n`);
console.log("--- toned maintenance: weight slowly up, body fat slowly down ---\n");

check(
  "working — weight creeping up, body fat coming down",
  series({ kgPerWeek: 0.1, bfPtsPerWeek: -0.12 }),
  "hold",
  base,
  "good"
);

check(
  "gaining weight AND fat — too much going in",
  series({ kgPerWeek: 0.35, bfPtsPerWeek: 0.12 }),
  "down"
);

check(
  "losing weight AND fat — not the aim, eat more",
  series({ kgPerWeek: -0.3, bfPtsPerWeek: -0.25 }),
  "up"
);

check(
  "losing weight while body fat RISES — something is wrong",
  series({ kgPerWeek: -0.3, bfPtsPerWeek: 0.15 }),
  "up",
  base,
  "bad"
);

check(
  "weight up fast but body fat falling fast — it's lean, leave it",
  series({ kgPerWeek: 0.3, bfPtsPerWeek: -0.35 }),
  "hold",
  base,
  "good"
);

/** As if last week's review had read body fat high too. */
const confirmed = (p: Profile): Profile => ({ ...p, last_review: { bf: { reading: "high" } } as any });

check(
  "weight on track, body fat drifting up inside the noise — can't tell, hold",
  series({ kgPerWeek: 0.05, bfPtsPerWeek: 0.05 }),
  "hold"
);

check(
  "weight on track, body fat clearly rising — first time, check again next week",
  series({ kgPerWeek: 0.05, bfPtsPerWeek: 0.15 }),
  "hold",
  base,
  "watch"
);

const firm = check(
  "weight level, body fat clearly rising, two reviews running — a small nudge, not a cut",
  series({ kgPerWeek: 0.0, bfPtsPerWeek: 0.15 }),
  "down",
  confirmed(base)
);
if (firm.decisive || Math.abs(firm.step + 0.02) > 1e-9) {
  failures++;
  console.log(`  FAIL body fat alone should nudge 2%, got ${(firm.step * 100).toFixed(1)}%\n`);
}

check(
  "weight flat, body fat coming down — that's the recomposition, leave it",
  series({ kgPerWeek: -0.02, bfPtsPerWeek: -0.12 }),
  "hold",
  base,
  "good"
);

check(
  "steady weight, fat up, scale's muscle down — the swap running backwards",
  series({ kgPerWeek: 0.05, bfPtsPerWeek: 0.15, muscleKgPerWeek: -0.15 }),
  "down",
  confirmed(base)
);

const sure = check(
  "gaining weight AND fat fast — the whole surplus comes off in one move",
  series({ kgPerWeek: 0.35, bfPtsPerWeek: 0.12 }),
  "down"
);
if (!sure.decisive || Math.abs(sure.next - RECOMP_CUT) > 1e-9) {
  failures++;
  console.log(`  FAIL expected one move to ${(RECOMP_CUT * 100).toFixed(0)}%, got ${(sure.next * 100).toFixed(1)}%\n`);
}

const mild = check(
  "gaining weight and fat slowly, fat high two reviews running — one move, sized to the smaller surplus",
  series({ kgPerWeek: 0.22, bfPtsPerWeek: 0.12 }),
  "down",
  confirmed(base)
);
if (!mild.decisive || mild.next <= RECOMP_CUT + 1e-9) {
  failures++;
  console.log(`  FAIL expected a decisive move smaller than the full cut, got ${(mild.next * 100).toFixed(1)}%\n`);
}

console.log("--- at the body fat target ---\n");

const target = (p: Profile, pct: number, holding = true): Profile =>
  ({ ...p, bf_target_pct: pct, last_review: { bf: { reading: "in" }, atTarget: holding } as any }) as Profile;

check(
  "reached the target with a cut still running — ease it out",
  series({ kgPerWeek: -0.1, bfPtsPerWeek: -0.1, startBf: 12 }),
  "up",
  target({ ...base, recomp_adjust: RECOMP_CUT }, 12.5),
  "good"
);

check(
  "at the target and steady — hold and fuel",
  series({ kgPerWeek: 0.05, bfPtsPerWeek: 0, startBf: 12 }),
  "hold",
  target(base, 12.5),
  "good"
);

check(
  "at the target, gaining weight and fat — a routine trim, not the big move",
  series({ kgPerWeek: 0.35, bfPtsPerWeek: 0.12, startBf: 12 }),
  "down",
  target(base, 12.5)
);

console.log("--- waiting for the last change to show ---\n");

check(
  "cut two weeks ago, still reading high — wait, don't cut again",
  series({ kgPerWeek: 0.35, bfPtsPerWeek: 0.12 }),
  "hold",
  { ...base, recomp_adjust: RECOMP_CUT, steer_moved_on: "2026-08-03", steer_last_step: RECOMP_CUT } as Profile,
  "watch",
  "2026-08-17"
);

check(
  "cut three weeks ago, still reading high — another routine step",
  series({ kgPerWeek: 0.35, bfPtsPerWeek: 0.12 }),
  "down",
  { ...base, recomp_adjust: RECOMP_CUT, steer_moved_on: "2026-08-03", steer_last_step: RECOMP_CUT } as Profile,
  undefined,
  "2026-08-24"
);

check(
  "cut last week, weight and body fat now dropping — muscle alarm ignores the wait",
  series({ kgPerWeek: -0.35, bfPtsPerWeek: 0.15 }),
  "up",
  { ...base, recomp_adjust: RECOMP_CUT, steer_moved_on: "2026-08-03", steer_last_step: RECOMP_CUT } as Profile,
  "bad",
  "2026-08-10"
);

console.log("--- before the scans have settled ---\n");

check(
  "two weeks in, weight falling clearly — act on weight alone",
  series({ kgPerWeek: -0.35, bfPtsPerWeek: 0, days: 14 }),
  "up"
);

check(
  "two weeks in, weight on track — wait for the scans",
  series({ kgPerWeek: 0.1, bfPtsPerWeek: 0, days: 14 }),
  "hold"
);

check(
  "two weeks in, weight a little off — not clear enough to act",
  series({ kgPerWeek: 0.0, bfPtsPerWeek: 0, days: 14 }),
  "hold"
);

// The real thing, the week this shipped: five weigh-ins, three of them in the
// evening. It draws a slope; it must not steer on one.
check(
  "five weigh-ins, mostly evenings — far too little to act on",
  [
    { day: "2026-08-30", weight_kg: 77.8, at_time: "21:28" },
    { day: "2026-09-01", weight_kg: 79.3, at_time: "21:11" },
    { day: "2026-09-03", weight_kg: 79.4, at_time: "19:56" },
    { day: "2026-09-05", weight_kg: 78.3, at_time: "08:20" },
    { day: "2026-09-09", weight_kg: 77.9, at_time: "07:42" },
  ],
  "hold"
);

console.log("--- the other goals ---\n");

const cut = profileFor("cut");
check("cut — on pace", series({ kgPerWeek: -0.45, bfPtsPerWeek: -0.25 }), "hold", cut, "good");
check("cut — far too fast", series({ kgPerWeek: -0.95, bfPtsPerWeek: -0.4 }), "up", cut);
check("cut — stalled", series({ kgPerWeek: -0.05, bfPtsPerWeek: 0 }), "down", cut);

const bulk = profileFor("bulk");
check("bulk — on pace", series({ kgPerWeek: 0.23, bfPtsPerWeek: 0.03 }), "hold", bulk, "good");
check("bulk — too fast and fattening", series({ kgPerWeek: 0.6, bfPtsPerWeek: 0.3 }), "down", bulk);

const hold = profileFor("maintain");
check("maintain — holding", series({ kgPerWeek: 0.02, bfPtsPerWeek: 0 }), "hold", hold, "good");
check("maintain — drifting up", series({ kgPerWeek: 0.3, bfPtsPerWeek: 0.1 }), "down", hold);

check(
  "an override is left alone",
  series({ kgPerWeek: 0.35, bfPtsPerWeek: 0.12 }),
  "hold",
  profileFor("recomp", "steady", { calorie_override: 3000 })
);

console.log("=== step sizes stay small, and it stops at the limit ===\n");
const heavy = series({ kgPerWeek: 0.5, bfPtsPerWeek: 0.2 });
let p: Profile = base;
for (let week = 1; week <= 8; week++) {
  const sig = steerSignals(heavy);
  const s = steerPlan(p, sig.rate, sig.comp, maintenance);
  // The one decisive move is allowed to be bigger; every other step is not.
  if (Math.abs(s.step) > (s.decisive ? Math.abs(RECOMP_CUT) : STEER_MAX_STEP) + 1e-9) {
    failures++;
    console.log(`  FAIL step of ${(s.step * 100).toFixed(1)}% is over the cap`);
  }
  p = { ...p, recomp_adjust: s.next };
  const target = Math.round(buildWeekPlan(p, REAL_DAY_TYPES).goalKcal);
  console.log(
    `  week ${week}: ${s.moving ? `${s.kcal} kcal` : "held"}  ` +
      `steer ${(p.recomp_adjust * 100).toFixed(1)}%  target ${target} kcal` +
      (s.atLimit ? "  (at the limit)" : "")
  );
}
if (Math.abs(p.recomp_adjust) > STEER_LIMIT + 1e-9) {
  failures++;
  console.log(`  FAIL ran past the ${(STEER_LIMIT * 100).toFixed(0)}% limit`);
}

console.log(failures === 0 ? "\nPASS" : `\nFAIL — ${failures} case${failures === 1 ? "" : "s"}`);
process.exit(failures === 0 ? 0 : 1);
