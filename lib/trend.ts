/**
 * Reading the scale.
 *
 * A single morning weight is mostly water, glycogen and what you had for
 * dinner. Day-to-day it moves ±1 kg for reasons that have nothing to do with
 * fat, which is why weighing yourself and reacting to the number is the
 * classic way to talk yourself out of a plan that's working.
 *
 * So nothing here looks at today's weight. Everything works off an
 * exponentially weighted moving average — the Hacker's Diet trend line — and
 * the slope of that trend, which is the only part of the signal that means
 * anything over a week.
 *
 * The trend also does something more useful than reassurance: intake minus
 * weight change *is* your real energy expenditure. Two or three weeks of both
 * numbers beats any prediction equation, because it's measured on you rather
 * than on a population.
 */

export type WeighIn = {
  day: string;
  weight_kg: number | null;
  waist_cm: number | null;
};

export type IntakeDay = { day: string; kcal: number };

/**
 * Smoothing factor. 0.12 puts roughly half the weight on the last five or six
 * days — responsive enough to see a real change inside a fortnight, slow
 * enough to ignore a salty dinner.
 */
export const ALPHA = 0.12;

/**
 * Energy per kg of body mass change. 7,700 kcal/kg is the standard figure for
 * fat tissue and it is only ever approximately right — early weight change is
 * mostly water and glycogen, and in a recomposition the tissue swapped isn't
 * fat for nothing. It's a good enough constant over a three-week window, and
 * a bad one over three days, which is why nothing here reports before then.
 */
export const KCAL_PER_KG = 7700;

export type TrendPoint = { day: string; weight: number | null; trend: number };

function toDate(day: string): Date {
  return new Date(day + "T12:00:00");
}

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * The trend line, one point per calendar day between the first and last
 * weigh-in. Missing days carry the trend forward rather than interpolating a
 * weight you never stood on the scale for.
 */
export function trendLine(entries: WeighIn[]): TrendPoint[] {
  const weights = entries
    .filter((e) => e.weight_kg != null && Number(e.weight_kg) > 0)
    .map((e) => ({ day: e.day, w: Number(e.weight_kg) }))
    .sort((a, b) => a.day.localeCompare(b.day));

  if (weights.length === 0) return [];

  const byDay = new Map(weights.map((w) => [w.day, w.w]));
  const out: TrendPoint[] = [];
  let trend = weights[0].w;

  const start = toDate(weights[0].day);
  const end = toDate(weights[weights.length - 1].day);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = isoDay(d);
    const w = byDay.get(key) ?? null;
    if (w != null) trend = trend + ALPHA * (w - trend);
    out.push({ day: key, weight: w, trend });
  }
  return out;
}

/** Least-squares slope, in units per day, over the last `days` points. */
function slopePerDay(points: { t: number; v: number }[]): number {
  const n = points.length;
  if (n < 2) return 0;
  const meanT = points.reduce((a, p) => a + p.t, 0) / n;
  const meanV = points.reduce((a, p) => a + p.v, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.t - meanT) * (p.v - meanV);
    den += (p.t - meanT) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export type Rate = {
  /** Change in the trend, kg per week. Negative is losing. */
  kgPerWeek: number;
  /** The same as a percentage of current bodyweight. */
  pctPerWeek: number;
  /** How many days of trend the slope was measured over. */
  days: number;
  current: number;
};

export function weightRate(entries: WeighIn[], windowDays = 21): Rate | null {
  const line = trendLine(entries);
  if (line.length < 8) return null;
  const window = line.slice(-windowDays);
  const slope = slopePerDay(window.map((p, i) => ({ t: i, v: p.trend })));
  const current = window[window.length - 1].trend;
  return {
    kgPerWeek: slope * 7,
    pctPerWeek: current > 0 ? ((slope * 7) / current) * 100 : 0,
    days: window.length,
    current,
  };
}

/** Same idea for the tape measure, which is the one that matters in a recomp. */
export function waistRate(entries: WeighIn[], windowDays = 42): {
  cmPerWeek: number;
  current: number;
  first: number;
  days: number;
} | null {
  const pts = entries
    .filter((e) => e.waist_cm != null && Number(e.waist_cm) > 0)
    .map((e) => ({ day: e.day, v: Number(e.waist_cm) }))
    .sort((a, b) => a.day.localeCompare(b.day));
  if (pts.length < 3) return null;

  const last = pts[pts.length - 1];
  const cutoff = isoDay(new Date(toDate(last.day).getTime() - windowDays * 86_400_000));
  const window = pts.filter((p) => p.day >= cutoff);
  if (window.length < 3) return null;

  const t0 = toDate(window[0].day).getTime();
  const slope = slopePerDay(
    window.map((p) => ({ t: (toDate(p.day).getTime() - t0) / 86_400_000, v: p.v }))
  );
  const spanDays = (toDate(last.day).getTime() - t0) / 86_400_000;
  return {
    cmPerWeek: slope * 7,
    current: last.v,
    first: window[0].v,
    days: Math.max(1, Math.round(spanDays)),
  };
}

export type Calibration = {
  /** What your intake and weight change say your expenditure actually is. */
  tdee: number;
  /** Mean daily intake over the window. */
  intake: number;
  kgPerWeek: number;
  days: number;
  /** Days that had both a full food log and enough surrounding weigh-ins. */
  intakeDays: number;
  weighDays: number;
  confidence: "low" | "fair" | "good";
  /** How far off the formula estimate was, as a ratio. */
  factor: number;
};

/**
 * Back out real expenditure: what you ate, minus what your weight did.
 *
 * Deliberately conservative about when it will speak. Under a fortnight of
 * data, or fewer than ten logged days, the answer is dominated by noise and
 * you'd be chasing it. Even at "good", it's presented as a suggestion you can
 * accept rather than something that silently rewrites your targets.
 */
export function calibrate(
  entries: WeighIn[],
  intake: IntakeDay[],
  modelledTdee: number,
  windowDays = 28
): Calibration | null {
  const line = trendLine(entries);
  if (line.length < 14) return null;

  const window = line.slice(-windowDays);
  const from = window[0].day;
  const to = window[window.length - 1].day;

  const logged = intake.filter((d) => d.day >= from && d.day <= to && d.kcal > 800);
  if (logged.length < 10) return null;

  const weighDays = window.filter((p) => p.weight != null).length;
  if (weighDays < 10) return null;

  const slope = slopePerDay(window.map((p, i) => ({ t: i, v: p.trend })));
  const meanIntake = logged.reduce((a, d) => a + d.kcal, 0) / logged.length;
  const tdee = meanIntake - slope * KCAL_PER_KG;

  const coverage = logged.length / window.length;
  const confidence: Calibration["confidence"] =
    window.length >= 21 && coverage >= 0.8 && weighDays >= 15
      ? "good"
      : window.length >= 17 && coverage >= 0.6
        ? "fair"
        : "low";

  return {
    tdee: Math.round(tdee),
    intake: Math.round(meanIntake),
    kgPerWeek: slope * 7,
    days: window.length,
    intakeDays: logged.length,
    weighDays,
    confidence,
    factor: modelledTdee > 0 ? tdee / modelledTdee : 1,
  };
}

export type Verdict = {
  headline: string;
  detail: string;
  tone: "good" | "watch" | "neutral";
};

/**
 * What the two numbers say together.
 *
 * In a recomposition the scale is supposed to sit still. Weight flat with the
 * waist coming in is the whole objective, and it's also the case people most
 * often abandon, because the scale isn't rewarding them for it. Weight falling
 * fast is the failure mode worth flagging: past about 0.7% of bodyweight a
 * week you are giving back lean mass, and in a training block that shows up as
 * performance before it shows up anywhere else.
 */
export function recompVerdict(rate: Rate | null, waist: ReturnType<typeof waistRate>): Verdict {
  if (!rate) {
    return {
      headline: "Not enough data yet",
      detail:
        "Weigh in most mornings for a couple of weeks — the trend needs about that long before it means anything.",
      tone: "neutral",
    };
  }

  const pct = rate.pctPerWeek;
  const waistDown = waist != null && waist.cmPerWeek < -0.05;
  const waistUp = waist != null && waist.cmPerWeek > 0.05;
  const kg = Math.abs(rate.kgPerWeek).toFixed(2);

  if (pct < -0.7) {
    return {
      headline: `Losing ${kg} kg a week — too fast for this`,
      detail:
        "Past about 0.7% of bodyweight a week you start giving back lean mass, and in a training block you'll feel it in the pool before you see it anywhere else. Add a few hundred calories.",
      tone: "watch",
    };
  }

  if (Math.abs(pct) <= 0.25) {
    if (waistDown) {
      return {
        headline: "Recomposition, working",
        detail: `Weight is flat and the waist is down ${Math.abs(waist!.cmPerWeek * 4).toFixed(1)} cm a month. That's the whole objective — same weight, less of it fat. Don't let the scale talk you out of it.`,
        tone: "good",
      };
    }
    if (waistUp) {
      return {
        headline: "Weight steady, waist creeping up",
        detail:
          "Holding weight while the tape goes the wrong way usually means the deficit isn't there. Let the phase drift a little further, or check the logging is honest.",
        tone: "watch",
      };
    }
    return {
      headline: "Holding steady",
      detail:
        "Weight is flat, which is what maintenance should look like. Add a waist measurement once a week — in a recomp it's the measurement that moves first.",
      tone: "neutral",
    };
  }

  if (pct < 0) {
    return {
      headline: `Losing ${kg} kg a week`,
      detail: waistDown
        ? "A gentle drop with the waist coming in — good pace to hold."
        : "A gentle drop. Keep protein up and keep the sessions hard and most of that will be fat.",
      tone: "good",
    };
  }

  return {
    headline: `Gaining ${kg} kg a week`,
    detail: waistUp
      ? "Going up, and the waist with it. If this is meant to be maintenance, the target is too high — the calibration on this page will tell you by how much."
      : "Going up. Fine in a build, worth a look if you meant to hold.",
    tone: pct > 0.5 ? "watch" : "neutral",
  };
}
