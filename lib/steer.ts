/**
 * Steering the plan by what the body actually did.
 *
 * Everything else in this app predicts. A BMR equation predicts what you burn
 * at rest, a MET table predicts what a session costs, and the goal predicts the
 * surplus or deficit that should produce the rate you asked for. Predictions
 * are how you start; they are a poor way to continue, because they were fitted
 * to a population and there is only one of you.
 *
 * This closes the loop. Every day the scale says how much of you there is and
 * twice a week it says what fraction of that is fat, and between them those
 * two answer the only question any goal actually asks: is the weight doing
 * what it should, and is it the right tissue doing it? If both are, nothing
 * moves. If not, the calorie target moves — a little.
 *
 * **Two readings, four ways to be wrong.** Taking toned maintenance as the
 * example — body fat slowly down, weight slowly up:
 *
 *  - weight up *and* body fat up: eating too much. Down.
 *  - weight down *and* body fat down: eating too little for the aim. Up.
 *  - weight down while body fat goes *up*: muscle is leaving. Something is
 *    genuinely wrong — up, and say so loudly, because this one is expensive.
 *  - weight up while body fat comes down faster than aimed: that is muscle.
 *    Nothing to fix.
 *
 * Every goal reads the same grid against its own bands (lib/nutrition.ts,
 * `GOALS`), so a cut and a bulk get the same logic aimed somewhere else.
 *
 * **"A little" is the whole design.**
 *
 *  - **One step per roll.** The plan changes on one day a week, because the
 *    food for that week has already been bought and cooked.
 *  - **Sized by the miss, capped at 3%.** A step is worked out from how far
 *    the weight trend is from the aim, converted to calories and then halved —
 *    the trend lags, and the last step has not fully shown yet. 1–3% of
 *    maintenance is 30–95 kcal on a 3,100 kcal week: noticeable over a month,
 *    invisible on a plate.
 *  - **A hard limit either side.** The steer never accounts for more than 12%
 *    of maintenance. Past that the problem is an input — bodyweight, session
 *    lengths, everyday activity — and a growing correction would bury it.
 *  - **It will not act on noise.** Body fat is only read once there are several
 *    scans across about three weeks. Weight on its own can move the target
 *    before then, but only when it is clearly outside the aim.
 *  - **Two opinions on lean mass.** When the scale's own muscle figure exists,
 *    lean mass has to agree with it before a "muscle is leaving" step is
 *    taken. Two estimates from one reading disagreeing is a reason to wait.
 */

import { aimFor, type Profile } from "./nutrition";
import {
  FAT_RISE_PER_MONTH,
  LEAN_LOSS_PER_MONTH,
  SCAN_MIN_POINTS,
  type Composition,
  type Rate,
} from "./trend";

/** The smallest move worth making, as a fraction of maintenance. */
export const STEER_MIN_STEP = 0.01;

/** The largest single move, as a fraction of maintenance. */
export const STEER_MAX_STEP = 0.03;

/** The most the steer may ever account for, either way. */
export const STEER_LIMIT = 0.12;

/**
 * Energy in a kilo of bodyweight change, for sizing a step.
 *
 * 7,700 kcal is fat tissue. A change that is part muscle, part water and part
 * glycogen is less — gaining in particular is well under it — and a step sized
 * on 7,700 would overshoot every time the weight was rising. 6,500 sits between
 * the two and is only ever used to size a step that is then halved and capped,
 * so its exact value barely reaches the answer.
 */
const KCAL_PER_KG_CHANGE = 6500;

/** Half the gap each week: the trend lags, and the last step hasn't landed. */
const DAMPING = 0.5;

/** How far outside a band a reading has to be before it counts as outside. */
const WEIGHT_MARGIN = 0.04; // % of bodyweight a week
const BF_MARGIN = 0.15; // points a month

/** How far off the aim weight has to be to act before the scans are in. */
const WEIGHT_ALONE_MARGIN = 0.2; // % of bodyweight a week

/**
 * How much weighing it takes before the trend is steered on at all.
 *
 * `weightRate` will draw a slope through five readings, which is fine for a
 * chart and nowhere near enough to move a calorie target: five readings, three
 * of them in the evening, came out as "+0.4 kg a week" on real data and would
 * have cut 100 kcal on the strength of it. Ten over a fortnight is the least
 * where the time-of-day correction and the smoothing have something to work
 * with.
 */
export const STEER_MIN_READINGS = 10;
export const STEER_MIN_DAYS = 14;

export type Reading = "low" | "in" | "high" | "unknown";

export type Steer = {
  /** What `recomp_adjust` should become. */
  next: number;
  /** How far it moves this time, as a fraction of maintenance. */
  step: number;
  /** The same as calories, for saying out loud. */
  kcal: number;
  /** Where it stands in total, as calories. */
  totalKcal: number;
  headline: string;
  detail: string;
  tone: "good" | "watch" | "bad" | "neutral";
  /** False when it is holding still, for any reason. */
  moving: boolean;
  /** True when it stopped because it ran out of room, not out of reason. */
  atLimit: boolean;
  /** Where each reading sits against the aim, for the status rows. */
  weight: Reading;
  bf: Reading;
};

function round25(kcal: number): number {
  return Math.round(kcal / 25) * 25;
}

function place(v: number, [lo, hi]: [number, number], margin: number): Reading {
  if (v < lo - margin) return "low";
  if (v > hi + margin) return "high";
  return "in";
}

/** "+0.3", "−0.2", "0.0" — a real minus sign, and no sign on zero. */
function signed(n: number, dp = 1): string {
  const r = Number(n.toFixed(dp));
  if (r === 0) return (0).toFixed(dp);
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(dp)}`;
}

/** Friendly form of a weekly weight rate, in kg. */
function kgWk(pct: number, weightKg: number): string {
  const kg = (pct / 100) * weightKg;
  return `${kg >= 0 ? "+" : "−"}${Math.abs(kg).toFixed(2)} kg a week`;
}

/**
 * What this week's roll should do to the calorie target.
 *
 * Pure: it reads the trend and hands back a number. The caller writes it, and
 * only on roll day — see `applyRoll` in lib/weekly.ts.
 */
export function steerPlan(
  p: Profile,
  rate: Rate | null,
  comp: Composition | null,
  maintenance: number
): Steer {
  const from = p.recomp_adjust ?? 0;
  const aim = aimFor(p.goal, p.pace);
  const settled = !!comp && comp.settled;

  const solid = !!rate && rate.readings >= STEER_MIN_READINGS && rate.days >= STEER_MIN_DAYS;
  const weight: Reading = solid ? place(rate!.pctPerWeek, aim.weight, WEIGHT_MARGIN) : "unknown";
  const bf: Reading = settled ? place(comp!.bfPtsPerMonth, aim.bf, BF_MARGIN) : "unknown";

  const hold = (headline: string, detail: string, tone: Steer["tone"] = "neutral"): Steer => ({
    next: from,
    step: 0,
    kcal: 0,
    totalKcal: round25(from * maintenance),
    headline,
    detail,
    tone,
    moving: false,
    atLimit: false,
    weight,
    bf,
  });

  if (p.calorie_override != null && p.calorie_override > 0) {
    return hold(
      "Your number, left alone",
      "You've set the calories yourself, so nothing here changes them. Clear the override on the Plan page to hand it back."
    );
  }

  if (!rate || !solid) {
    const have = rate?.readings ?? 0;
    return hold(
      "Waiting on the scale",
      `${have > 0 ? `${have} weigh-in${have === 1 ? "" : "s"} in the last three weeks. ` : ""}About ${STEER_MIN_READINGS} across a fortnight — most days, any time — and there's a trend steady enough to steer by. Nothing changes until then.`
    );
  }

  const kg = rate.current;
  const mid = (aim.weight[0] + aim.weight[1]) / 2;

  /**
   * One step, sized by how far the weight trend is from the middle of the aim.
   * `dir` decides the direction; the size is the same arithmetic either way,
   * floored so a step is always big enough to matter and capped so it is never
   * big enough to feel.
   */
  const sized = (): number => {
    const gapKgWk = ((rate.pctPerWeek - mid) / 100) * kg;
    const kcalDay = (Math.abs(gapKgWk) * KCAL_PER_KG_CHANGE) / 7;
    const frac = maintenance > 0 ? (kcalDay * DAMPING) / maintenance : STEER_MIN_STEP;
    return Math.min(STEER_MAX_STEP, Math.max(STEER_MIN_STEP, frac));
  };

  const move = (
    dir: 1 | -1,
    size: number,
    headline: string,
    detail: string,
    tone: Steer["tone"]
  ): Steer => {
    const next = Math.max(-STEER_LIMIT, Math.min(STEER_LIMIT, from + dir * size));
    const step = next - from;

    if (Math.abs(step) < 1e-9) {
      const stuck = Math.abs(round25(from * maintenance));
      return {
        ...hold(
          headline,
          `${detail} It's already ${stuck} kcal ${from < 0 ? "under" : "over"} where it started, and that's as far as it goes on its own. If it still isn't landing, check your weight, session lengths and everyday activity on the Plan page.`,
          tone
        ),
        atLimit: true,
      };
    }

    return {
      next,
      step,
      kcal: round25(step * maintenance),
      totalKcal: round25(next * maintenance),
      headline,
      detail,
      tone,
      moving: true,
      atLimit: false,
      weight,
      bf,
    };
  };

  const wWord = kgWk(rate.pctPerWeek, kg);
  const aimWord = `${kgWk(aim.weight[0], kg).replace(" a week", "")} to ${kgWk(aim.weight[1], kg)}`;

  /* --- Before the scans are in: weight alone, and only when it's clear ---- */
  if (!settled) {
    const short = comp ? Math.max(0, SCAN_MIN_POINTS - comp.scans) : SCAN_MIN_POINTS;
    const waiting = comp
      ? short > 0
        ? `${short} more scan${short === 1 ? "" : "s"} and body fat joins in.`
        : "A few more days between the first scan and the last and body fat joins in."
      : "Scan on your two scan days and body fat joins in after about three weeks.";

    if (rate.pctPerWeek < aim.weight[0] - WEIGHT_ALONE_MARGIN) {
      return move(
        1,
        sized(),
        "Weight is falling — eating a little more",
        `The trend is ${wWord} against an aim of ${aimWord}. That's clear enough to act on before the scans are in. ${waiting}`,
        "watch"
      );
    }
    if (rate.pctPerWeek > aim.weight[1] + WEIGHT_ALONE_MARGIN) {
      return move(
        -1,
        sized(),
        "Weight is climbing fast — trimming a little",
        `The trend is ${wWord} against an aim of ${aimWord}. Faster than muscle can be built, so some of it is fat. ${waiting}`,
        "watch"
      );
    }
    return hold(
      weight === "in" ? "Weight is on track" : "Watching the weight",
      `The trend is ${wWord}; the aim is ${aimWord}. ${waiting}`,
      weight === "in" ? "good" : "neutral"
    );
  }

  /* --- Both readings in ----------------------------------------------------- */
  const c = comp!;
  const bfWord = `${signed(c.bfPtsPerMonth)}% a month`;
  const bfAim = `${signed(aim.bf[0])} to ${signed(aim.bf[1])}`;

  /**
   * Lean mass leaving, and not because it's turning into fat.
   *
   * At a steady weight lean and fat are one measurement with the sign flipped,
   * so "lean is down" is only evidence of under-eating when fat isn't going up
   * at the same time. And when the scale has its own muscle figure, it has to
   * agree — the app's lean mass and the scale's are two readings of one current
   * through you, and when they point different ways neither is trustworthy.
   */
  const fatRising = c.fatKgPerMonth > FAT_RISE_PER_MONTH;
  const muscleAgrees = c.muscleKgPerMonth == null || c.muscleKgPerMonth < 0;
  const leanLeaving =
    p.goal !== "cut" && c.leanKgPerMonth < LEAN_LOSS_PER_MONTH && !fatRising && muscleAgrees;

  // Losing weight while getting fatter. The one that means something is wrong.
  if (weight === "low" && bf === "high") {
    return move(
      1,
      Math.max(sized(), STEER_MIN_STEP * 2),
      "Losing weight but body fat is rising",
      `Weight ${wWord}, body fat ${bfWord}. That combination means muscle is going, not fat — the calories go up. Check the obvious first: is protein landing every day, are the gym sessions still hard, and were the last scans taken first thing, before food and drink? A dry morning reads fatter than you are.`,
      "bad"
    );
  }

  if (leanLeaving && weight !== "high") {
    return move(
      1,
      sized(),
      "Muscle is slipping — eating a little more",
      `Lean mass is down ${Math.abs(c.leanKgPerMonth).toFixed(1)} kg a month across ${c.scans} scans${c.muscleKgPerMonth != null ? ", and the scale's muscle figure agrees" : ""}. That's the one thing this can't afford to lose.`,
      "watch"
    );
  }

  if (weight === "high" && bf === "high") {
    const gaining = rate.kgPerWeek > 0.05;
    return move(
      -1,
      sized(),
      gaining ? "Gaining weight and fat — trimming" : "Not coming off — trimming",
      `Weight ${wWord} and body fat ${bfWord}, against aims of ${aimWord} and ${bfAim}% a month. ${
        gaining ? "Too much going in" : "Neither is moving the way it should"
      }; it comes down a notch.`,
      "watch"
    );
  }

  if (weight === "low") {
    return move(
      1,
      sized(),
      p.goal === "cut"
        ? "Coming off too fast — easing off"
        : rate.kgPerWeek < -0.05
          ? "Weight is falling — eating a little more"
          : "Weight isn't climbing — eating a little more",
      `Weight ${wWord} against an aim of ${aimWord}${bf === "low" ? `, with body fat also dropping faster than aimed (${bfWord})` : ""}. ${
        p.goal === "cut"
          ? "Past the aim, what comes off stops being mostly fat."
          : "The aim is for the scale to hold or climb, so the calories go up."
      }`,
      "watch"
    );
  }

  if (weight === "high") {
    // Weight above the aim but body fat still falling at least as fast as
    // aimed: the extra is lean. Nothing to fix.
    if (bf === "low") {
      return hold(
        "Gaining quickly — and it's lean",
        `Weight ${wWord}, faster than the aim of ${aimWord}, but body fat is falling ${bfWord}. That's muscle arriving, not fat. Leaving it alone.`,
        "good"
      );
    }
    return move(
      -1,
      sized(),
      p.goal === "cut" ? "Not coming off — trimming" : "Weight climbing faster than aimed — trimming",
      `Weight ${wWord} against an aim of ${aimWord}. Body fat ${bfWord}.`,
      "watch"
    );
  }

  // Weight on track from here down.
  if (bf === "high") {
    return move(
      -1,
      STEER_MIN_STEP,
      "Body fat isn't coming down — trimming",
      `Weight is on track (${wWord}), but body fat is ${bfWord} against an aim of ${bfAim}% a month. One small notch down.`,
      "watch"
    );
  }

  if (bf === "low") {
    return hold(
      "On track — fat coming off quickly",
      `Weight ${wWord}, right where it should be, and body fat ${bfWord} — faster than the aim of ${bfAim}% a month. While the weight holds, that's good news. If the weight starts falling, it'll ease off.`,
      "good"
    );
  }

  return hold(
    "On track",
    `Weight ${wWord} and body fat ${bfWord} — both inside the aim. Nothing to fix, so nothing moves.`,
    "good"
  );
}
