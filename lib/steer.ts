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
 * moves. If not, the calorie target moves.
 *
 * **Two readings, four ways to be wrong.** Taking toned maintenance as the
 * example — body fat slowly down, muscle held or built:
 *
 *  - weight up *and* body fat up: eating too much. Down — decisively.
 *  - weight down *and* body fat down faster than aimed: more than the aim
 *    asks for. Up, a little.
 *  - weight down while body fat goes *up*: muscle is leaving. Something is
 *    genuinely wrong — up, straight away, and say so loudly.
 *  - weight up while body fat comes down: that is muscle. Nothing to fix.
 *
 * Every goal reads the same grid against its own bands (lib/nutrition.ts,
 * `GOALS`), so a cut and a bulk get the same logic aimed somewhere else.
 *
 * **Attack, then settle.** Ethan's brief: *"we don't want to do it really
 * slowly to try and find the ideal range — cut it to where we're positive
 * we'll see the recomp, and if we start to lose weight and fat, adjust it a
 * bit higher."* So the two directions are deliberately not symmetric:
 *
 *  - **A surplus is removed in one move.** When weight AND body fat are both
 *    climbing, the surplus that is doing it is measured off the weight trend
 *    and taken out whole — not halved, not spread over two months of 1% a
 *    week — between 3% and 7% of maintenance (`RECOMP_CUT`, never more than
 *    `RECOMP_CUT_MAX_KCAL`). Sized to the surplus rather than fixed, so it
 *    stops the fat going on without tipping into a real deficit: the point is
 *    to keep gaining on muscle, not to cut (Ethan: *"the point isn't to cut
 *    and get it super quick"*). 7% is about 220 kcal a day on a 3,100 kcal
 *    week, well inside the ~500 kcal a day past which resistance training
 *    stops adding lean mass (Murphy & Koehler 2022), and the fuel and
 *    energy-availability floors in `buildWeekPlan` hold every training day
 *    up regardless.
 *  - **Body fat not falling, weight fine, is a nudge.** 2%, and only after two
 *    reviews in a row agree.
 *  - **Up is small steps.** 1.5% at a time, because overshooting upward is
 *    cheap to undo and a cut that eased off too fast would just be a cut
 *    that never happened.
 *  - **Muscle leaving is the exception.** That goes up straight away, by at
 *    least 3% or half the current deficit, whatever the timing.
 *
 * **It will not act on noise.** Every reading comes with a standard error
 * (lib/trend.ts), and a reading only counts as outside its aim when it is
 * outside by more than that: one standard error before cutting, half of one
 * before easing — a missed cut costs a week of slightly too much food, a false
 * one costs a week of training under-fuelled in season.
 *
 * **It waits for the last change to show.** Weight lags intake by weeks, and
 * the first week of any cut is mostly glycogen and the water stored with it
 * (Hall's early-phase energy density is ~4,800 kcal/kg, not 7,700). A steer
 * that read that and eased straight back off, or read the week before the cut
 * and cut again, would oscillate. So after a move nothing moves again for two
 * weeks, three if it would be a second cut. See `COOLDOWN_DAYS`.
 */

import { addDays, aimNow, atTarget, goalStartsLevel, STEER_LIMIT, type Profile } from "./nutrition";
import {
  FAT_RISE_PER_MONTH,
  LEAN_LOSS_PER_MONTH,
  SCAN_MIN_POINTS,
  composition,
  weightRate,
  type Composition,
  type Rate,
  type WeighIn,
} from "./trend";

/** The smallest move worth making, as a fraction of maintenance. */
export const STEER_MIN_STEP = 0.01;

/** The largest routine move, as a fraction of maintenance. */
export const STEER_MAX_STEP = 0.03;

/**
 * The most the steer may ever account for, either way.
 *
 * Defined in `nutrition.ts` and re-exported here, where it reads as belonging.
 * It has to live there because the macro shaping needs it too, and a nutrition
 * module importing from this one would close a cycle.
 */
export { STEER_LIMIT } from "./nutrition";

/**
 * Where a decisive cut lands, as a fraction of maintenance, for goals that
 * start at maintenance (toned maintenance and maintaining).
 *
 * Picked to be sure rather than gentle. At 7% the expected fat loss is about
 * 0.2 kg a week — roughly a point of body fat a month, which a month of scans
 * can actually see. Shallower and the result sits inside the scale's noise for
 * six weeks, which is the slow search for the right range Ethan asked not to
 * do. Deeper and it starts to cost lean mass and training.
 */
export const RECOMP_CUT = -0.07;

/** The cut is never more than this a day, whatever maintenance is. */
export const RECOMP_CUT_MAX_KCAL = 450;

/** One step back up. */
export const EASE_STEP = 0.015;

/** The smallest surplus-removing move, and the nudge when only body fat is off. */
export const DECISIVE_MIN = 0.03;
export const FAT_NUDGE = 0.02;

/**
 * How much weekly weight gain is muscle rather than surplus, in kg — about a
 * quarter of a kilo a month, the most a trained swimmer adds alongside a full
 * pool programme. Weight gained faster than this while body fat rises is the
 * surplus the one move takes out.
 */
const LEAN_ALLOWANCE_KG_WK = 0.06;

/**
 * How sure a reading must be, in standard errors past the edge of its aim,
 * before it counts as outside it. Asymmetric on purpose — see the header.
 */
const Z_CUT = 1.0;
const Z_EASE = 0.5;

/**
 * Days from the roll day a change came in to the roll day the next one may.
 * Two weeks for anything, three for a second cut in a row.
 */
export const COOLDOWN_DAYS = { repeatCut: 21, other: 14 };

/**
 * Energy in a kilo of bodyweight change, for sizing a routine step.
 *
 * 7,700 kcal is fat tissue. A change that is part muscle, part water and part
 * glycogen is less, and a step sized on 7,700 would overshoot. 6,500 sits
 * between the two and is only ever used to size a step that is then halved
 * and capped, so its exact value barely reaches the answer.
 */
const KCAL_PER_KG_CHANGE = 6500;

/** Half the gap each time: the trend lags, and the last step hasn't landed. */
const DAMPING = 0.5;

/** A little extra room past the edge of an aim, on top of the standard error. */
const WEIGHT_MARGIN = 0.02; // % of bodyweight a week
const BF_MARGIN = 0.1; // points a month

/** Before the scans are in, weight alone has to be this much further out. */
const WEIGHT_ALONE_MARGIN = 0.1; // % of bodyweight a week

/**
 * How much weighing it takes before the trend is steered on at all.
 *
 * Five readings, three of them in the evening, once came out as "+0.4 kg a
 * week" on real data. Ten over a fortnight is the least where the time-of-day
 * correction and the fit have something to work with.
 */
export const STEER_MIN_READINGS = 10;
export const STEER_MIN_DAYS = 14;

/** The windows the steer reads. Four weeks of weight, six of scans. */
export const RATE_WINDOW_DAYS = 28;
export const SCAN_WINDOW_DAYS = 42;

/**
 * The two readings, measured the way the steer wants them.
 *
 * One function so the Progress page, the weekly review and the benches all
 * steer on the same numbers. Six weeks of scans rather than the readout's
 * twelve: after a change, a slope that was mostly last month would keep
 * voting for a decision already taken.
 */
export function steerSignals(entries: WeighIn[]): {
  rate: Rate | null;
  comp: Composition | null;
} {
  return {
    rate: weightRate(entries, RATE_WINDOW_DAYS),
    comp: composition(entries, SCAN_WINDOW_DAYS),
  };
}

/**
 * Body fat right now, for deciding whether the target has been reached: the
 * middle of the last three scans, so one dry morning can't declare victory
 * and one wet one can't take it back.
 */
export function bfNowOf(comp: Composition | null): number | null {
  if (!comp || !comp.points.length) return null;
  const last = comp.points.filter((p) => !p.offHydration).slice(-3).map((p) => p.bfPct);
  if (!last.length) return null;
  const s = [...last].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

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
  /** The one-off jump to the recomposition deficit. */
  decisive: boolean;
  /** Held because the last change hasn't had time to show; the day it may move. */
  cooldownUntil: string | null;
  /** At the body fat target — holding and fuelling rather than cutting. */
  atTarget: boolean;
  /** Where each reading sits against the aim, for the status rows. */
  weight: Reading;
  bf: Reading;
};

function round25(kcal: number): number {
  return Math.round(kcal / 25) * 25;
}

/**
 * Where a reading sits against its aim, allowing for how sure it is.
 *
 * "In" means "can't say it's outside", which is not the same as "exactly on
 * the aim" — and is the right thing to act on, because doing nothing is what
 * the steer does with "in".
 */
function place(v: number, se: number, [lo, hi]: [number, number], margin: number): Reading {
  const s = Number.isFinite(se) ? se : Infinity;
  if (v - Z_CUT * s > hi + margin) return "high";
  if (v + Z_EASE * s < lo - margin) return "low";
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
  return `${signed(kg, 2)} kg a week`;
}

function prettyDay(day: string): string {
  return new Date(day + "T12:00:00").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/**
 * What this week's review should do to the calorie target.
 *
 * Pure: it reads the trend and hands back a number. The caller writes it —
 * lib/review.ts, once a week, staged for roll day. `applyOn` is the roll day
 * the decision would come into force; without it nothing waits on the last
 * change, which is what the benches and the Progress page's preview want.
 */
export function steerPlan(
  p: Profile,
  rate: Rate | null,
  comp: Composition | null,
  maintenance: number,
  opts: { applyOn?: string } = {}
): Steer {
  const from = p.recomp_adjust ?? 0;
  const bfNow = bfNowOf(comp);
  const holding = !!p.last_review?.atTarget;
  const arrived = atTarget(p, bfNow, holding);
  const aim = aimNow(p, bfNow, holding);
  const total = aim.adjust + from;
  const settled = !!comp && comp.settled;

  const solid = !!rate && rate.readings >= STEER_MIN_READINGS && rate.days >= STEER_MIN_DAYS;
  const weight: Reading = solid
    ? place(rate!.pctPerWeek, rate!.sePctPerWeek, aim.weight, WEIGHT_MARGIN)
    : "unknown";
  const bf: Reading = settled
    ? place(comp!.bfPtsPerMonth, comp!.bfSePtsPerMonth, aim.bf, BF_MARGIN)
    : "unknown";

  const hold = (
    headline: string,
    detail: string,
    tone: Steer["tone"] = "neutral",
    extra: Partial<Steer> = {}
  ): Steer => ({
    next: from,
    step: 0,
    kcal: 0,
    totalKcal: round25(total * maintenance),
    headline,
    detail,
    tone,
    moving: false,
    atLimit: false,
    decisive: false,
    cooldownUntil: null,
    atTarget: arrived,
    weight,
    bf,
    ...extra,
  });

  if (p.calorie_override != null && p.calorie_override > 0) {
    return hold(
      "Your number, left alone",
      "You've set the calories yourself. Clear it on the Plan page to hand it back."
    );
  }

  if (!rate || !solid) {
    const have = rate?.readings ?? 0;
    return hold(
      "Waiting on the scale",
      `${have} of ${STEER_MIN_READINGS} weigh-ins over a fortnight. Nothing changes until then.`
    );
  }

  const kg = rate.current;
  const mid = (aim.weight[0] + aim.weight[1]) / 2;

  /**
   * A routine step, sized by how far the weight trend is from the middle of
   * the aim: converted to calories, halved, floored so it matters and capped
   * so it is never big enough to feel.
   */
  const sized = (): number => {
    const gapKgWk = ((rate.pctPerWeek - mid) / 100) * kg;
    const kcalDay = (Math.abs(gapKgWk) * KCAL_PER_KG_CHANGE) / 7;
    const frac = maintenance > 0 ? (kcalDay * DAMPING) / maintenance : STEER_MIN_STEP;
    return Math.min(STEER_MAX_STEP, Math.max(STEER_MIN_STEP, frac));
  };

  /** The day the last change allows the next one, or null if it already does. */
  const waitUntil = (dir: 1 | -1): string | null => {
    if (!opts.applyOn || !p.steer_moved_on) return null;
    const need =
      dir < 0 && (p.steer_last_step ?? 0) < 0 ? COOLDOWN_DAYS.repeatCut : COOLDOWN_DAYS.other;
    const ready = addDays(p.steer_moved_on, need);
    return opts.applyOn < ready ? ready : null;
  };

  const move = (
    dir: 1 | -1,
    size: number,
    headline: string,
    detail: string,
    tone: Steer["tone"],
    how: { alarm?: boolean; decisive?: boolean } = {}
  ): Steer => {
    const wait = how.alarm ? null : waitUntil(dir);
    if (wait) {
      return hold(
        headline,
        `${detail} Waiting for the last change (${prettyDay(p.steer_moved_on!)}) to show — next move from ${prettyDay(wait)}.`,
        tone,
        { cooldownUntil: wait }
      );
    }

    const next = Math.max(-STEER_LIMIT, Math.min(STEER_LIMIT, from + dir * size));
    const step = next - from;

    if (Math.abs(step) < 1e-9) {
      const stuck = Math.abs(round25(total * maintenance));
      return hold(
        headline,
        `${detail} Already ${stuck} kcal ${total < 0 ? "under" : "over"} maintenance — the limit. Check your weight and sessions on the Plan page.`,
        tone,
        { atLimit: true }
      );
    }

    return {
      next,
      step,
      kcal: round25(step * maintenance),
      totalKcal: round25((aim.adjust + next) * maintenance),
      headline,
      detail,
      tone,
      moving: true,
      atLimit: false,
      decisive: !!how.decisive,
      cooldownUntil: null,
      atTarget: arrived,
      weight,
      bf,
    };
  };

  /**
   * Too much going in. For a goal that starts at maintenance, the first time
   * this is said the target goes straight to the recomposition deficit; after
   * that — or for a cut or a bulk, which already chose their own starting
   * point — it moves a routine step.
   */
  const cutTo = Math.max(RECOMP_CUT, maintenance > 0 ? -RECOMP_CUT_MAX_KCAL / maintenance : RECOMP_CUT);
  // The decisive cut is for getting to a body; once there, it's routine steps.
  const canDecide = goalStartsLevel(p.goal, p.pace) && !arrived;
  const trim = (headline: string, detail: string): Steer => {
    if (canDecide && total > cutTo + STEER_MIN_STEP) {
      // The whole measured surplus, undamped — the one move is meant to land.
      const gapKgWk = Math.max(0, rate.kgPerWeek - LEAN_ALLOWANCE_KG_WK);
      const surplus = maintenance > 0 ? (gapKgWk * KCAL_PER_KG_CHANGE) / 7 / maintenance : 0;
      const size = Math.min(total - cutTo, Math.max(DECISIVE_MIN, surplus));
      const kcal = Math.abs(round25(size * maintenance));
      return move(
        -1,
        size,
        headline,
        `${detail} The surplus is about ${kcal} kcal a day, so that comes off in one go. Training days keep their carbs.`,
        "watch",
        { decisive: true }
      );
    }
    return move(-1, sized(), headline, detail, "watch");
  };

  const ease = (headline: string, detail: string): Steer =>
    move(1, p.goal === "cut" ? sized() : EASE_STEP, headline, detail, "watch");

  const wWord = `${kgWk(rate.pctPerWeek, kg)} (± ${((rate.sePctPerWeek / 100) * kg).toFixed(2)})`;
  const aimWord = `${kgWk(aim.weight[0], kg).replace(" a week", "")} to ${kgWk(aim.weight[1], kg)}`;

  /* --- Before the scans are in: weight alone, and only when it's clear ---- */
  if (!settled) {
    const short = comp ? Math.max(0, SCAN_MIN_POINTS - comp.scans) : SCAN_MIN_POINTS;
    const waiting = comp
      ? short > 0
        ? `Body fat joins in after ${short} more scan${short === 1 ? "" : "s"}.`
        : "Body fat joins in after a few more days of scans."
      : "Body fat joins in after about two and a half weeks of scans.";

    const se = rate.sePctPerWeek;
    if (rate.pctPerWeek + Z_CUT * se < aim.weight[0] - WEIGHT_ALONE_MARGIN) {
      return ease(
        "Weight is falling — eating a little more",
        `Weight ${wWord}; aim ${aimWord}. ${waiting}`
      );
    }
    if (rate.pctPerWeek - Z_CUT * se > aim.weight[1] + WEIGHT_ALONE_MARGIN) {
      // Not the decisive cut: without body fat there's no telling muscle from
      // fat, so it takes a routine step and waits for the scans to say which.
      return move(
        -1,
        sized(),
        "Weight is climbing fast — trimming a little",
        `Weight ${wWord}; aim ${aimWord}. ${waiting}`,
        "watch"
      );
    }
    return hold(
      weight === "in" ? "Weight is on track" : "Watching the weight",
      `Weight ${wWord}; aim ${aimWord}. ${waiting}`,
      weight === "in" ? "good" : "neutral"
    );
  }

  /* --- Both readings in ----------------------------------------------------- */
  const c = comp!;
  const bfWord = `${signed(c.bfPtsPerMonth)}% a month (± ${c.bfSePtsPerMonth.toFixed(1)})`;
  const bfAim = `${signed(aim.bf[0])} to ${signed(aim.bf[1])}`;

  /**
   * Lean mass leaving, and not because it's turning into fat.
   *
   * At a steady weight lean and fat are one measurement with the sign flipped,
   * so "lean is down" is only evidence of under-eating when fat isn't going up
   * at the same time. And every muscle figure the scale gave has to agree —
   * they are all built from the same impedance reading, so agreeing does not
   * make them independent, but DISAGREEING means the reading was unstable that
   * morning. Absent figures abstain rather than object.
   */
  const fatRising = c.fatKgPerMonth > FAT_RISE_PER_MONTH;
  const muscleAgrees =
    (c.muscleKgPerMonth == null || c.muscleKgPerMonth < 0) &&
    (c.segmentMuscleKgPerMonth == null || c.segmentMuscleKgPerMonth < 0);
  const leanSure = c.leanKgPerMonth + Z_EASE * c.leanSeKgPerMonth < LEAN_LOSS_PER_MONTH;
  const leanLeaving = p.goal !== "cut" && leanSure && !fatRising && muscleAgrees;

  // Losing weight while getting fatter. The one that means something is wrong.
  if (weight === "low" && bf === "high") {
    return move(
      1,
      Math.max(STEER_MAX_STEP, total < 0 ? -total / 2 : 0),
      "Losing weight but body fat is rising",
      `Weight ${wWord}, body fat ${bfWord} — that's muscle going, so calories go up now. Check scans were first thing, before food or drink.`,
      "bad",
      { alarm: true }
    );
  }

  if (leanLeaving && weight !== "high") {
    return move(
      1,
      Math.max(STEER_MIN_STEP * 2, sized()),
      "Muscle is slipping — eating a little more",
      `Lean mass is down ${Math.abs(c.leanKgPerMonth).toFixed(1)} kg a month across ${c.scans} scans.`,
      "watch"
    );
  }

  /*
   * Fat is what separates good gain from bad. The weight band is wide enough
   * to let the scale climb on muscle, so a slow fat gain can sit inside it —
   * which is why "weight and fat both going up" is read as body fat clearly
   * rising while the scale is probably rising at all, not only when the scale
   * is past its band. With the scale past its band the two instruments agree
   * and it acts now; with the scale only drifting up — which muscle does too —
   * body fat has to have said so on last week's review as well.
   */
  const rising = rate.kgPerWeek - Z_EASE * rate.seKgPerWeek > 0.02;
  const fatAgain = p.last_review?.bf?.reading === "high";
  if (bf === "high" && (weight === "high" || (rising && fatAgain))) {
    return trim(
      rate.kgPerWeek > 0.05 ? "Gaining weight and fat" : "Weight and fat aren't coming off",
      `Weight ${wWord}, body fat ${bfWord}.`
    );
  }

  if (weight === "low") {
    return ease(
      p.goal === "cut"
        ? "Coming off too fast — easing off"
        : rate.kgPerWeek < -0.05
          ? "Weight is falling — eating a little more"
          : "Weight is below the aim — eating a little more",
      `Weight ${wWord}; aim ${aimWord}.`
    );
  }

  if (weight === "high") {
    // Weight above the aim but body fat still falling at least as fast as
    // aimed: the extra is lean. Nothing to fix.
    if (bf === "low") {
      return hold(
        "Gaining quickly — and it's lean",
        `Weight ${wWord} with body fat falling ${bfWord} — that's muscle. Leaving it.`,
        "good"
      );
    }
    return move(
      -1,
      sized(),
      p.goal === "cut" ? "Not coming off — trimming" : "Weight climbing faster than aimed — trimming",
      `Weight ${wWord}; aim ${aimWord}. Body fat ${bfWord}.`,
      "watch"
    );
  }

  // Weight on track from here down.
  if (bf === "high") {
    /*
     * Body fat on its own has to say it twice.
     *
     * With the weight inside its aim, this is one instrument's word — and the
     * least steady one: hydration alone moves a scan by half a point. Run
     * against a swimmer who was recomposing exactly as aimed, a single
     * reading was enough to make the full cut in a quarter of simulated
     * seasons (bench/closed-loop.ts, scenario C), because a weekly test run
     * sixteen times finds its 5% eventually. Asked to agree with last week's
     * review first, it almost never does it on noise, and a real problem
     * costs one week.
     */
    if (p.last_review?.bf?.reading !== "high") {
      return hold(
        arrived ? "Body fat may be drifting up" : "Body fat may not be coming down",
        `Body fat reads ${bfWord}. Checking again next week before acting.`,
        "watch"
      );
    }
    if (arrived) {
      // At the target the job is staying there: small corrections either way.
      return move(
        -1,
        STEER_MIN_STEP,
        "Drifting above your target — a small trim",
        `Body fat ${bfWord} at your ${p.bf_target_pct}% target, two weeks running. 1% off to stay in range.`,
        "watch"
      );
    }
    return move(
      -1,
      FAT_NUDGE,
      "Body fat isn't coming down — a small nudge",
      `Weight on track, body fat ${bfWord} two weeks running. A 2% nudge.`,
      "watch"
    );
  }

  /*
   * At the target, with nothing going wrong: take any cut that's still running
   * back out, a step at a time, so the plan settles at maintenance with the
   * training fully fuelled. See ATHLETIC_HOLD in lib/nutrition.ts.
   */
  if (arrived && total < -0.001) {
    return move(
      1,
      Math.min(EASE_STEP, -total),
      "At your body fat target — easing the cut out",
      `Body fat about ${bfNow?.toFixed(1)}%, target ${p.bf_target_pct}%. The cut comes back out ${Math.round(EASE_STEP * 100 * 10) / 10}% at a time.`,
      "good"
    );
  }

  if (arrived) {
    return hold(
      "At your body fat target — holding and fuelling",
      `Body fat about ${bfNow?.toFixed(1)}%, target ${p.bf_target_pct}%. Holding here, fully fuelled.`,
      "good"
    );
  }

  if (bf === "low") {
    return hold(
      "On track — fat coming off quickly",
      `Weight ${wWord}, body fat ${bfWord}. Good while weight holds.`,
      "good"
    );
  }

  return hold(
    "On track",
    `Weight ${wWord}, body fat ${bfWord}. Nothing to change.`,
    "good"
  );
}
