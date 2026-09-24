/**
 * The whole loop, against a body whose answer is known.
 * Run with: npx tsx bench/closed-loop.ts
 *
 * The steer is a controller, and a controller is only proven by closing the
 * loop: it decides, the body responds, the scale and the scan report the
 * response with their own noise, and it decides again. Unit cases (bench/
 * steer.ts) check that each reading gets the right answer; this checks that
 * a season of them converges instead of oscillating, and that it doesn't
 * chase noise when nothing is wrong.
 *
 * The simulated swimmer is Ethan's real plan and profile. What the app does
 * not know is his true maintenance, which each scenario sets.
 *
 * The body:
 *  - energy balance each day = intake − true expenditure (which moves ~30 kcal
 *    per kg of bodyweight);
 *  - lean mass grows at most ~0.25 kg a month (trained, alongside a full pool
 *    programme), slows past a 300 kcal deficit and reverses past 500 (Murphy &
 *    Koehler 2022) — whatever energy isn't lean goes to or comes from fat at
 *    7,700 kcal/kg;
 *  - glycogen and its water follow carbohydrate intake over a few days, so the
 *    first week of any cut shows a drop that is not fat (Hall).
 *
 * The instruments:
 *  - a weigh-in six days in seven, a quarter of them in the evening, with the
 *    day's food and water on top and 0.3 kg of scatter;
 *  - a scan Monday and Friday morning, ±0.5 points, with a fixed offset (BIA
 *    reads every body wrong by its own amount, which cancels out of a slope).
 */
import { normaliseProfile } from "../lib/profile";
import { WEEKDAYS, buildWeekPlan, type Profile } from "../lib/nutrition";
import { steerPlan, steerSignals, RECOMP_CUT } from "../lib/steer";
import { rollFigures } from "../lib/weekly";
import type { WeighIn } from "../lib/trend";
import { REAL_DAY_TYPES, REAL_PROFILE } from "./real-plan";

/** Deterministic noise, so a changed result is a changed controller. */
function rng(seed: number) {
  let s = seed >>> 0;
  const u = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const n = () => {
    const a = Math.max(1e-9, u());
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u());
  };
  return { u, n };
}

const iso = (d: number) => new Date(Date.UTC(2026, 8, 7 + d)).toISOString().slice(0, 10); // d=0 is a Monday

type Scenario = {
  name: string;
  /** True maintenance at the starting weight, kcal a day. */
  trueTdee: number;
  /** A weekly meal out, kcal over the meal it replaced. */
  cheat: number;
  weeks: number;
  /** Body fat target, in points relative to the first scan's reading. */
  targetFromStart?: number;
  /** Where the steer starts, e.g. a cut already running. */
  startAdjust?: number;
};

type Result = {
  moves: { week: number; kcal: number; decisive: boolean; headline: string }[];
  fatKg: number[];
  leanKg: number[];
  weightKg: number[];
  totals: number[];
  finalBalance: number;
};

function simulate(sc: Scenario, seed: number): Result {
  const r = rng(seed);
  let p: Profile = normaliseProfile({
    ...REAL_PROFILE,
    recomp_adjust: sc.startAdjust ?? 0,
    // The scan reads 1.5 points high (see below), so a target is set in the
    // scale's own terms, the way it would be in the app.
    bf_target_pct: sc.targetFromStart != null ? 13 + 1.5 + sc.targetFromStart : null,
    steer_moved_on: null,
    steer_last_step: 0,
    plan_weight_kg: 77,
    plan_bf_pct: 13,
  });

  let fat = 77 * 0.13;
  let lean = 77 - fat - 0; // lean includes everything that isn't fat or glycogen-water
  let glyco = 0; // kg of glycogen + water above baseline
  const entries: WeighIn[] = [];
  const out: Result = { moves: [], fatKg: [], leanKg: [], weightKg: [], totals: [], finalBalance: 0 };
  let pendingAdjust: number | null = null;
  let pendingReading: string | null = null;
  let pendingAtTarget = false;
  let pendingOn = -1;
  const baseCarbs = avgTargets(p).carbs;
  let balance = 0;

  for (let d = 0; d < sc.weeks * 7; d++) {
    const dow = d % 7; // 0 Mon … 4 Fri … 6 Sun
    if (d === pendingOn && pendingAdjust != null) {
      if (Math.abs(pendingAdjust - p.recomp_adjust) > 0.0005) {
        p = {
          ...p,
          steer_moved_on: iso(d),
          steer_last_step: pendingAdjust - p.recomp_adjust,
          recomp_adjust: pendingAdjust,
        };
      }
      // The review that decided this week is the one the next review reads
      // as "last week's" — see the body-fat confirmation in lib/steer.ts.
      p = { ...p, last_review: { bf: { reading: pendingReading }, atTarget: pendingAtTarget } as any };
      pendingAdjust = null;
    }

    // Intake: the plan's own average, eaten faithfully, ±100 kcal of real life,
    // plus the meal out on Saturdays.
    const t = avgTargets(p);
    const intake = t.kcal + r.n() * 100 + (dow === 5 ? sc.cheat : 0);
    const weight = fat + lean + glyco;
    const tdee = sc.trueTdee + 30 * (weight - 77);
    const e = intake - tdee;
    balance = 0.9 * balance + 0.1 * e;

    // Lean first, from what the day leaves; the rest is fat.
    const leanMax = 0.25 / 30;
    const leanRate =
      e > -300 ? leanMax : e > -500 ? leanMax * (1 - (-300 - e) / 200) : -0.15 / 30;
    lean += leanRate;
    fat += (e - leanRate * 1800) / 7700;

    // Glycogen and water follow carbohydrate over a few days.
    const glycoTarget = (-0.4 * (baseCarbs - t.carbs)) / 60;
    glyco += (glycoTarget - glyco) / 3;

    // The scale.
    if (r.u() < 6 / 7) {
      const evening = r.u() < 0.25;
      const hour = evening ? 20 + r.u() * 2 : 7 + r.u() * 1.5;
      const rise = Math.min(14, hour - 6) * 0.12 + (evening ? r.n() * 0.4 : 0);
      const reading = fat + lean + glyco + rise + r.n() * 0.3;
      const hh = Math.floor(hour);
      const mm = Math.floor((hour - hh) * 60);
      const e2: WeighIn = {
        day: iso(d),
        weight_kg: Math.round(reading * 10) / 10,
        at_time: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
      };
      if (!evening && (dow === 0 || dow === 4)) {
        const bf = (fat / (fat + lean + glyco)) * 100 + 1.5 + r.n() * 0.5;
        e2.bf_pct = Math.round(bf * 10) / 10;
        e2.bf_method = "scan";
      }
      entries.push(e2);
    }

    // Friday: the review.
    if (dow === 4) {
      const monday = iso(d + 3);
      const seen = entries.filter((x) => x.day <= iso(d));
      const fig = rollFigures(seen, iso(d));
      const { rate, comp } = steerSignals(seen);
      const plan = buildWeekPlan(p, REAL_DAY_TYPES);
      const s = steerPlan(p, rate, comp, plan.maintenance, { applyOn: monday });
      if (s.moving) {
        out.moves.push({ week: Math.floor(d / 7) + 1, kcal: s.kcal, decisive: s.decisive, headline: s.headline });
      }
      pendingAdjust = s.next;
      pendingReading = s.bf;
      pendingAtTarget = s.atTarget;
      pendingOn = d + 3;
      if (fig) p = { ...p, plan_weight_kg: fig.weightKg, plan_bf_pct: fig.bodyFatPct ?? p.plan_bf_pct };
      out.totals.push(p.recomp_adjust);
      out.fatKg.push(fat);
      out.leanKg.push(lean);
      out.weightKg.push(fat + lean + glyco);
    }
  }
  out.finalBalance = balance;
  return out;
}

function avgTargets(p: Profile) {
  const plan = buildWeekPlan(p, REAL_DAY_TYPES);
  const ds = WEEKDAYS.map((w) => plan.byId[plan.week[w]]);
  const a = (k: "kcal" | "carbs") => ds.reduce((s, t) => s + t[k], 0) / 7;
  return { kcal: a("kcal"), carbs: a("carbs") };
}

let failures = 0;
function expect(ok: boolean, what: string) {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
}

const SEEDS = 40;

function run(sc: Scenario) {
  const all = Array.from({ length: SEEDS }, (_, i) => simulate(sc, 1000 + i * 7919));
  const one = all[0];
  console.log(`\n${sc.name}  (true maintenance ${sc.trueTdee}, meal out +${sc.cheat} a week, ${sc.weeks} weeks, ${SEEDS} runs)`);
  console.log("  week  steer   weight   fat    lean");
  one.totals.forEach((tot, i) => {
    console.log(
      `  ${String(i + 1).padStart(4)}  ${(tot * 100).toFixed(1).padStart(5)}%  ${one.weightKg[i].toFixed(1)}  ${one.fatKg[i].toFixed(2)}  ${one.leanKg[i].toFixed(2)}`
    );
  });
  for (const m of one.moves) {
    console.log(`  wk ${m.week}: ${m.kcal > 0 ? "+" : ""}${m.kcal} kcal${m.decisive ? " (decisive)" : ""} — ${m.headline}`);
  }
  return all;
}

const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const flipsOf = (r: Result) => {
  let f = 0;
  for (let i = 1; i < r.moves.length; i++) if (Math.sign(r.moves[i].kcal) !== Math.sign(r.moves[i - 1].kcal)) f++;
  return f;
};

// A: eating too much — the model overestimates maintenance by ~120 kcal and a
// weekly meal out adds ~130 a day on top. About 250 kcal a day over; fat goes
// on at roughly a kilo a month.
const A = run({ name: "A. Gaining fat", trueTdee: 3000, cheat: 900, weeks: 16 });
{
  const cutWeek = A.map((r) => r.moves.find((m) => m.kcal < 0)?.week ?? 99);
  const decisive = A.filter((r) => r.moves.some((m) => m.decisive)).length;
  const before = A.map((r) => r.fatKg[5] - r.fatKg[0]);
  const after = A.map((r) => r.fatKg[15] - r.fatKg[10]);
  const cuts = A.map((r) => r.moves.filter((m) => m.kcal < 0).length);
  console.log(`  first cut, median week: ${med(cutWeek)}; decisive in ${decisive}/${SEEDS}`);
  console.log(`  fat over five weeks, before: ${med(before).toFixed(2)} kg; after the cut (wk 11–16): ${med(after).toFixed(2)} kg`);
  expect(med(cutWeek) <= 6, "cuts within six weeks (body fat needs ~2.5 weeks of scans first)");
  expect(decisive >= SEEDS * 0.8, "the cut is the decisive one in most runs");
  expect(med(after) < med(before) / 3, "fat gain all but stops once it has cut");
  expect(med(cuts) <= 3, "doesn't keep cutting");
  expect(med(A.map(flipsOf)) <= 2, "no oscillation");
}

// B: exactly at maintenance. Weight creeps up on muscle and body fat drifts
// down a couple of tenths a month — slow, but that is what was asked for. No
// big moves.
const B = run({ name: "B. At maintenance, slow drift down", trueTdee: 3121, cheat: 0, weeks: 16 });
{
  const cuts = B.map((r) => r.moves.filter((m) => m.kcal < 0).length);
  const decisive = B.filter((r) => r.moves.some((m) => m.decisive)).length;
  console.log(`  cuts per run, median: ${med(cuts)}; decisive cuts: ${decisive}/${SEEDS}`);
  expect(med(cuts) <= 1, "at most a nudge");
  expect(decisive <= SEEDS * 0.2, "no big cut when nothing is going on");
  expect(med(B.map(flipsOf)) <= 2, "no oscillation");
}

// C: already recomposing — a small real deficit the model doesn't know about,
// body fat coming down about half a point a month, weight roughly level. This
// is the false-alarm test: it should leave it alone.
const C = run({ name: "C. On the recomposition aim", trueTdee: 3210, cheat: 0, weeks: 16 });
{
  const decisive = C.filter((r) => r.moves.some((m) => m.decisive)).length;
  const totalMoves = C.reduce((a, r) => a + r.moves.length, 0);
  console.log(`  decisive cuts: ${decisive}/${SEEDS}; moves per run: ${(totalMoves / SEEDS).toFixed(2)}`);
  expect(decisive <= SEEDS * 0.2, "rarely cuts on noise when it's working");
  expect(totalMoves / SEEDS <= 1.5, "barely moves");
}

// D: under-eating — maintenance underestimated by 300. Weight and fat both fall.
const D = run({ name: "D. Losing too much", trueTdee: 3420, cheat: 0, weeks: 16 });
{
  const up = D.filter((r) => r.moves.some((m) => m.kcal > 0)).length;
  const down = D.filter((r) => r.moves.some((m) => m.kcal < 0)).length;
  console.log(`  runs that eased up: ${up}/${SEEDS}; runs that cut: ${down}/${SEEDS}; median final steer ${(med(D.map((r) => r.totals[r.totals.length - 1])) * 100).toFixed(1)}%`);
  expect(up >= SEEDS * 0.8, "eases up");
  expect(down <= SEEDS * 0.15, "doesn't cut someone who is losing");
}

// E: far over — 380 kcal a day, more than the steer is allowed to take off
// once the energy floor holds up the training days. It should go most of the
// way to its limit rather than stop at one step.
const E = run({ name: "E. Far over (past the limit)", trueTdee: 2950, cheat: 1500, weeks: 16 });
{
  const deepest = med(E.map((r) => Math.min(...r.totals)));
  console.log(`  median deepest steer: ${(deepest * 100).toFixed(1)}%`);
  expect(deepest <= -0.09, "goes most of the way to its limit");
}

// F: a cut already running, fat coming off, and a target one point down.
// Once there it should take the cut back out and settle at maintenance —
// "then the plan can do whatever it has to do after that".
const F = run({
  name: "F. Reaching the body fat target",
  trueTdee: 3121,
  cheat: 0,
  weeks: 20,
  targetFromStart: -1.0,
  startAdjust: -0.07,
});
{
  const at = (m: { headline: string }) => m.headline.startsWith("At your body fat target");
  const eased = F.filter((r) => r.moves.some(at)).length;
  const finalTot = med(F.map((r) => r.totals[r.totals.length - 1]));
  // After the target, small corrections either way are the design ("each week
  // if it needs to go up and down ever so slightly"); a big cut is not.
  const bigAfter = F.filter((r) => {
    const i = r.moves.findIndex(at);
    return i >= 0 && r.moves.slice(i + 1).some((m) => m.decisive || m.kcal < -100);
  }).length;
  console.log(
    `  eased out at the target: ${eased}/${SEEDS}; median final steer ${(finalTot * 100).toFixed(1)}%; big cuts after: ${bigAfter}/${SEEDS}`
  );
  expect(eased >= SEEDS * 0.8, "notices the target and eases the cut out");
  expect(finalTot > -0.03, "ends near maintenance, fuelled");
  expect(bigAfter <= SEEDS * 0.1, "only small corrections once there");
}

console.log(`\nDecisive cut is ${(RECOMP_CUT * 100).toFixed(0)}% of maintenance.`);
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
