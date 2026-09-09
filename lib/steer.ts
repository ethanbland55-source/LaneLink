/**
 * Steering the plan by what the body actually did.
 *
 * Everything else in this app predicts. A BMR equation predicts what you burn
 * at rest, a MET table predicts what a session costs, and a phase curve
 * predicts how far under maintenance you should be in week six. Predictions
 * are how you start; they are a poor way to continue, because they were fitted
 * to a population and there is only one of you.
 *
 * This closes the loop. Twice a week the scale says what fraction of you is
 * fat, every day it says how much of you there is, and between them those two
 * answer the only question a recomposition actually asks: is the fat coming
 * off, and is the muscle staying on? If it is, nothing moves. If it isn't, the
 * calorie target moves — a little.
 *
 * "A little" is the whole design.
 *
 *  - **One step per roll.** The plan changes on one day a week, because the
 *    food for that week has already been bought and cooked. A steer that fired
 *    whenever the numbers looked bad would be rewriting portions on a
 *    Wednesday against containers already in the fridge.
 *  - **A step you cannot feel.** 1.5% of maintenance is about 45 kcal on a
 *    3,000 kcal day — half a slice of bread. A month of consistent evidence
 *    moves it 6%, which is a real change arrived at slowly. A step big enough
 *    to notice would be a step big enough to be wrong about.
 *  - **A hard limit either side.** The steer can never account for more than
 *    8% of maintenance. If the truth is further away than that, the problem is
 *    an input — bodyweight, session lengths, everyday activity — and burying
 *    it under a growing correction would hide it rather than fix it.
 *  - **It will not act on noise.** Bioimpedance reads hydration, so a single
 *    pair of scans says nothing. Nothing happens until there are four scans
 *    across three weeks, and every threshold sits above the scan-to-scan
 *    error.
 *
 * The order the rules are read in is deliberate, and it is not symmetrical.
 * Losing lean mass raises calories on the strength of one signal; losing no
 * fat lowers them only once the evidence is unambiguous. Undershooting costs
 * you a month. Losing muscle in a training block costs you the block.
 */

import type { Profile } from "./nutrition";
import {
  FAT_LOSS_PER_MONTH,
  FAT_RISE_PER_MONTH,
  LEAN_LOSS_PER_MONTH,
  SCAN_MIN_POINTS,
  SCAN_NOISE_PTS,
  type Composition,
  type Rate,
} from "./trend";

/** How far the target moves in one week, as a fraction of maintenance. */
export const STEER_STEP = 0.015;

/** The most the steer may ever account for, either way. */
export const STEER_LIMIT = 0.08;

/** Weight falling faster than this a week is coming off you, not off the fat. */
export const TOO_FAST_PCT_PER_WEEK = -0.7;

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
  tone: "good" | "watch" | "neutral";
  /** False when it is holding still, for any reason. */
  moving: boolean;
  /** True when it stopped because it ran out of room, not out of reason. */
  atLimit: boolean;
};

function round25(kcal: number): number {
  return Math.round(kcal / 25) * 25;
}

/**
 * What this week's roll should do to the calorie target.
 *
 * Pure: it reads the trend and hands back a number. The caller writes it, and
 * only on roll day — see `applyRoll` in lib/weekly.ts.
 */
export function steerRecomp(
  p: Profile,
  rate: Rate | null,
  comp: Composition | null,
  maintenance: number
): Steer {
  const from = p.recomp_adjust ?? 0;

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
  });

  // Only a recomposition is steered. A deliberate cut or bulk has a target
  // rate of its own and does not want a second opinion arriving on Mondays.
  if (p.goal !== "recomp") {
    return hold(
      "Not steering",
      "Only toned maintenance is steered — the other goals have a rate of their own."
    );
  }

  if (p.calorie_override != null && p.calorie_override > 0) {
    return hold(
      "Your number, left alone",
      "You have set the calories by hand, so nothing here overrides them. Clear the override on the Plan page to hand it back."
    );
  }

  if (!rate) {
    return hold("Waiting on the scale", "A fortnight of weigh-ins before there is a trend to read.");
  }

  if (!comp || !comp.settled) {
    const short = comp ? Math.max(0, SCAN_MIN_POINTS - comp.scans) : SCAN_MIN_POINTS;
    return hold(
      "Waiting on the scans",
      short > 0
        ? `${short} more scan${short === 1 ? "" : "s"} and it starts steering. Body fat across a fortnight is mostly how hydrated you were.`
        : "Three weeks between the first scan and the last before the slope means anything."
    );
  }

  const lean = comp.leanKgPerMonth;
  const fat = comp.fatKgPerMonth;
  const bf = comp.bfPtsPerMonth;

  /** Move the target one step in `dir`, clipped to the limit. */
  const move = (dir: 1 | -1, headline: string, detail: string, tone: Steer["tone"]): Steer => {
    const next = Math.max(-STEER_LIMIT, Math.min(STEER_LIMIT, from + dir * STEER_STEP));
    const step = next - from;

    if (Math.abs(step) < 1e-9) {
      const stuck = Math.abs(round25(from * maintenance));
      return {
        ...hold(
          headline,
          `${detail} It is already ${stuck} kcal ${from < 0 ? "under" : "over"} and that is as far as it goes on its own. If it still is not landing, the number to question is your weight, your session lengths or your everyday activity — not this.`,
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
    };
  };

  /**
   * Fat going on, which changes what a falling lean figure means.
   *
   * At a steady bodyweight lean and fat are one measurement with the sign
   * flipped, so "lean mass is down" reads identically whether you are
   * under-eating or simply getting fatter at the same weight — and those two
   * want opposite steps. Every rule that raises calories is therefore gated on
   * fat not rising.
   */
  const fatRising = fat > FAT_RISE_PER_MONTH;

  // 1. Lean mass leaving, and not because it is turning into fat. The
  //    expensive failure, and the only one that gets a step on one signal.
  if (lean < LEAN_LOSS_PER_MONTH && !fatRising) {
    return move(
      1,
      "Eating a little more",
      `Lean mass is down ${Math.abs(lean).toFixed(1)} kg a month across ${comp.scans} scans. That is the one thing this block cannot afford to lose, so the target goes up.`,
      "watch"
    );
  }

  // 2. Coming off too fast overall — the same problem, arriving by the scale.
  if (rate.pctPerWeek < TOO_FAST_PCT_PER_WEEK && !fatRising) {
    return move(
      1,
      "Easing off",
      `Weight is falling ${Math.abs(rate.kgPerWeek).toFixed(2)} kg a week. Past about 0.7% of bodyweight, what you lose stops being mostly fat.`,
      "watch"
    );
  }

  // 3. Working. The point of the whole thing is that this changes nothing.
  if (fat <= FAT_LOSS_PER_MONTH && lean >= LEAN_LOSS_PER_MONTH) {
    return hold(
      "Leaving it exactly where it is",
      `Fat down ${Math.abs(fat).toFixed(1)} kg a month with lean mass holding. Nothing to fix, so nothing moves.`,
      "good"
    );
  }

  // 4. Trading the wrong way: fat on, lean off, at whatever the scale says.
  //     Worth its own words, because the arithmetic looks like rule 1 and the
  //     answer is the opposite of rule 1.
  if (fatRising && lean < 0) {
    return move(
      -1,
      "Trading the wrong way",
      `Fat is up ${fat.toFixed(1)} kg a month and lean mass is down ${Math.abs(lean).toFixed(1)} kg — at a weight that has barely moved, that is the swap running backwards. The target comes down. Worth checking protein is landing and the gym sessions are still hard.`,
      "watch"
    );
  }

  // 5. Nothing happening: maintenance is higher than the plan believes.
  if (bf > -SCAN_NOISE_PTS / 2) {
    const what =
      bf > SCAN_NOISE_PTS / 2
        ? `up ${bf.toFixed(1)} points a month`
        : `flat across ${comp.days} days`;
    return move(
      -1,
      "Trimming the target",
      `Body fat is ${what}, so maintenance is a little higher than the plan thinks and the target comes down by one notch.`,
      "watch"
    );
  }

  // 6. Moving the right way, just gently. Leave it alone.
  return hold(
    "Holding",
    `Fat is coming off at ${Math.abs(fat).toFixed(1)} kg a month — slower than the plan expects, but the right direction, and a nudge either way would be guessing.`,
    "neutral"
  );
}
