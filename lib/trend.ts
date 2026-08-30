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
 * Two things make that honest rather than merely smooth:
 *
 *  - **Time of day is bias, not noise.** An evening reading is about a kilo
 *    heavier than a morning one, every time. Averaging the two together
 *    doesn't cancel out — it drags the trend around according to when you
 *    happened to stand on the scale. So every reading carries a tag, and
 *    readings are corrected to morning-equivalent using an offset learned from
 *    your own data before anything else touches them. Weighing at a consistent
 *    time is still better; not being able to is no longer a problem.
 *  - **One bad reading can't move much.** A mistyped 87 for 78 would otherwise
 *    poison the trend for a fortnight, so a single reading's pull is capped.
 *
 * The trend also does something more useful than reassurance: intake minus
 * weight change *is* your real energy expenditure. Two or three weeks of both
 * numbers beats any prediction equation, because it's measured on you rather
 * than on a population.
 */

export type Tag = "morning" | "evening" | "other";

export const TAGS: { value: Tag; label: string; hint: string }[] = [
  { value: "morning", label: "Morning", hint: "after the loo, before food" },
  { value: "other", label: "Daytime", hint: "anything in between" },
  { value: "evening", label: "Evening", hint: "end of the day" },
];

export type WeighIn = {
  day: string;
  weight_kg: number | null;
  waist_cm: number | null;
  tag?: Tag | null;
  /** Clock time you stood on the scale, "HH:MM". Null on older readings. */
  at_time?: string | null;
};

export type IntakeDay = { day: string; kcal: number };

/**
 * Smoothing factor. 0.12 puts roughly half the weight on the last five or six
 * days — responsive enough to see a real change inside a fortnight, slow
 * enough to ignore a salty dinner.
 */
export const ALPHA = 0.12;

/** How far one reading may drag the trend, in kg. Guards against a typo. */
export const MAX_PULL = 1.5;

/**
 * Energy per kg of body mass change. 7,700 kcal/kg is the standard figure for
 * fat tissue and it is only ever approximately right — early weight change is
 * mostly water and glycogen, and in a recomposition the tissue swapped isn't
 * fat for nothing. It's a good enough constant over a three-week window, and
 * a bad one over three days, which is why nothing here reports before then.
 */
export const KCAL_PER_KG = 7700;

/**
 * How the day makes you heavier.
 *
 * You are lightest first thing and gain through the day as food and fluid
 * arrive faster than they leave — around a kilo by the evening, essentially
 * none of it fat. Three buckets (morning / daytime / evening) capture that
 * roughly; an actual clock time captures it properly, because 09:00 and 11:30
 * are both "morning" and are not the same reading.
 *
 * So the correction is a **rate per hour since waking**, flattening off once
 * the day's food is mostly in. A reading with a time uses its real hour; one
 * with only a tag uses the hour that tag stands for, so nothing logged before
 * this existed is thrown away.
 */
export const WAKE_HOUR = 6;

/** Population starting point, kg gained per hour awake, until yours is known. */
export const DEFAULT_RISE_PER_HOUR = 0.085;

/** Past this the day's intake is in and the curve flattens. */
export const RISE_PLATEAU_HOURS = 14;

/** The same for the tape — a waist reads fuller after a day of eating. */
export const DEFAULT_WAIST_RISE_PER_HOUR = 0.09;

/** The hour a tag stands for, when there's no clock time to use instead. */
export const TAG_HOUR: Record<Tag, number> = { morning: 7, other: 14, evening: 21 };

/** Hours awake at a given clock hour, clamped to the part of the curve that rises. */
export function hoursAwake(hour: number): number {
  return Math.max(0, Math.min(RISE_PLATEAU_HOURS, hour - WAKE_HOUR));
}

/** "07:45" -> 7.75. Anything unparseable comes back null. */
export function parseClock(at: string | null | undefined): number | null {
  if (!at) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(at.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!(h >= 0 && h < 24 && min >= 0 && min < 60)) return null;
  return h + min / 60;
}

/** The hour to correct this reading from — its own, or the one its tag implies. */
export function hourOf(e: WeighIn): number {
  return parseClock(e.at_time) ?? TAG_HOUR[tagOf(e)];
}

export type Offsets = {
  /** kg gained per hour awake, measured on you where possible. */
  risePerHour: number;
  waistRisePerHour: number;
  /** What that comes to at each tag's hour — for display, and for old readings. */
  weight: Record<Tag, number>;
  waist: Record<Tag, number>;
  /** True when the rate was measured on you rather than assumed. */
  learned: Tag[];
  measured: boolean;
  /** How many readings had a real clock time to learn from. */
  timed: number;
  counts: Record<Tag, number>;
};

/** What a reading taken this many hours after waking reads heavy by. */
export function riseAt(hours: number, perHour: number): number {
  return Math.max(0, Math.min(RISE_PLATEAU_HOURS, hours)) * perHour;
}

function toDate(day: string): Date {
  return new Date(day + "T12:00:00");
}

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function tagOf(e: WeighIn): Tag {
  return e.tag === "evening" || e.tag === "other" ? e.tag : "morning";
}

/** EWMA with the per-reading influence cap, over pre-sorted values. */
function smooth(values: { day: string; v: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!values.length) return out;
  let trend = values[0].v;
  for (const p of values) {
    const pull = Math.max(-MAX_PULL, Math.min(MAX_PULL, p.v - trend));
    trend = trend + ALPHA * pull;
    out.set(p.day, trend);
  }
  return out;
}

/**
 * How fast the day makes *you* heavier — measured rather than assumed.
 *
 * Two obvious approaches both fail. Measuring later readings against a trend
 * built from morning ones biases *low*, because a "morning" reading is already
 * an hour or two into the rise, so the baseline it sets is too heavy. Choosing
 * the rate that makes the corrected readings sit tightest around their own
 * trend is circular — the trend chases the correction, and it biases *high*.
 *
 * What works is pairs. Take two readings a few days apart: your real weight
 * has barely moved between them, so almost all of the difference between them
 * is the difference in what time of day they were taken. Divide one by the
 * other and you have the rate, with the trend cancelled out rather than
 * estimated. The median across every such pair is the robust version, so one
 * odd reading can't set it.
 *
 * It needs readings genuinely spread across the day. Weigh at 07:00 every
 * morning and there is nothing here to learn, so the population figure stands
 * — which is close enough that the trend is usable from the first week either
 * way.
 */
export function learnOffsets(entries: WeighIn[]): Offsets {
  const counts: Record<Tag, number> = { morning: 0, evening: 0, other: 0 };
  let timed = 0;
  for (const e of entries) {
    if (e.weight_kg == null) continue;
    counts[tagOf(e)]++;
    if (parseClock(e.at_time) != null) timed++;
  }

  let risePerHour = DEFAULT_RISE_PER_HOUR;
  let measured = false;
  const learned: Tag[] = [];

  const points = entries
    .filter((e) => e.weight_kg != null && Number(e.weight_kg) > 0)
    .map((e) => ({
      t: toDate(e.day).getTime() / 86_400_000,
      w: Number(e.weight_kg),
      h: hoursAwake(hourOf(e)),
    }))
    .sort((a, b) => a.t - b.t);

  /** Days apart two readings may be and still be treated as the same weight. */
  const NEAR_DAYS = 4;
  /** Hours apart they must be for the division to mean anything. */
  const MIN_HOUR_GAP = 2;

  const rates: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dt = points[j].t - points[i].t;
      if (dt > NEAR_DAYS) break; // sorted, so nothing later is closer
      const dh = points[j].h - points[i].h;
      if (Math.abs(dh) < MIN_HOUR_GAP) continue;
      rates.push((points[j].w - points[i].w) / dh);
    }
  }

  if (rates.length >= 8) {
    rates.sort((a, b) => a - b);
    const median = rates[Math.floor(rates.length / 2)];
    // Outside this band it isn't a diurnal swing, it's bad data.
    if (median >= 0 && median <= 0.25) {
      risePerHour = Math.round(median * 1000) / 1000;
      measured = true;
      for (const t of ["evening", "other"] as Tag[]) if (counts[t] > 0) learned.push(t);
    }
  }

  // The waist follows the same food and fluid, so scale the population ratio
  // between them rather than pretending to have measured it separately.
  const waistRisePerHour =
    (risePerHour / DEFAULT_RISE_PER_HOUR) * DEFAULT_WAIST_RISE_PER_HOUR;

  const at = (t: Tag) => riseAt(hoursAwake(TAG_HOUR[t]), risePerHour);
  const atWaist = (t: Tag) => riseAt(hoursAwake(TAG_HOUR[t]), waistRisePerHour);

  return {
    risePerHour,
    waistRisePerHour,
    weight: { morning: at("morning"), other: at("other"), evening: at("evening") },
    waist: { morning: atWaist("morning"), other: atWaist("other"), evening: atWaist("evening") },
    learned,
    measured,
    timed,
    counts,
  };
}

/** Every reading corrected to what it would have read first thing. */
export function normalise(entries: WeighIn[], offsets?: Offsets): WeighIn[] {
  const o = offsets ?? learnOffsets(entries);
  return entries.map((e) => {
    const h = hoursAwake(hourOf(e));
    return {
      ...e,
      weight_kg: e.weight_kg == null ? null : Number(e.weight_kg) - riseAt(h, o.risePerHour),
      waist_cm: e.waist_cm == null ? null : Number(e.waist_cm) - riseAt(h, o.waistRisePerHour),
    };
  });
}

export type TrendPoint = { day: string; weight: number | null; trend: number };

/**
 * The trend line, one point per calendar day between the first and last
 * weigh-in. Missing days carry the trend forward rather than inventing a
 * weight you never stood on the scale for.
 */
export function trendLine(entriesRaw: WeighIn[], offsets?: Offsets): TrendPoint[] {
  const entries = normalise(entriesRaw, offsets);
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
    if (w != null) {
      const pull = Math.max(-MAX_PULL, Math.min(MAX_PULL, w - trend));
      trend = trend + ALPHA * pull;
    }
    out.push({ day: key, weight: w, trend });
  }
  return out;
}

/** Least-squares slope, in units per day. */
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
  /** How many of those days you actually weighed in on. */
  readings: number;
  current: number;
};

export function weightRate(entries: WeighIn[], windowDays = 21): Rate | null {
  const line = trendLine(entries);
  if (line.length < 8) return null;
  const window = line.slice(-windowDays);
  const readings = window.filter((p) => p.weight != null).length;
  // A trend carried forward across a fortnight of missed days has no slope
  // worth reading, however smooth it looks.
  if (readings < 5) return null;

  const slope = slopePerDay(window.map((p, i) => ({ t: i, v: p.trend })));
  const current = window[window.length - 1].trend;
  return {
    kgPerWeek: slope * 7,
    pctPerWeek: current > 0 ? ((slope * 7) / current) * 100 : 0,
    days: window.length,
    readings,
    current,
  };
}

/**
 * Same idea for the tape measure.
 *
 * Built to work off a handful of points spread over a month or two rather than
 * a daily habit — measuring a waist every morning is a habit almost nobody
 * keeps, and weekly is entirely enough to see the thing move.
 */
export function waistRate(
  entriesRaw: WeighIn[],
  windowDays = 56
): { cmPerWeek: number; current: number; first: number; days: number; points: number } | null {
  const entries = normalise(entriesRaw);
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
  // Three measurements taken in one week say nothing about a trend.
  if (spanDays < 10) return null;

  return {
    cmPerWeek: slope * 7,
    current: last.v,
    first: window[0].v,
    days: Math.max(1, Math.round(spanDays)),
    points: window.length,
  };
}

export type Calibration = {
  /** What your intake and weight change say your expenditure actually is. */
  tdee: number;
  /** Mean daily intake over the window. */
  intake: number;
  kgPerWeek: number;
  days: number;
  /** Days that had a full food log, and days you weighed in. */
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
        "Weigh in on most days for a couple of weeks and the trend appears. It doesn't have to be the same time each day — tag when you weighed and the reading is corrected before it counts.",
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
          "Holding weight while the tape goes the wrong way usually means the deficit isn't there. Let the block drift a little further, or check the logging is honest.",
        tone: "watch",
      };
    }
    return {
      headline: "Holding steady",
      detail:
        "Weight is flat, which is what maintenance should look like. One waist measurement a week is enough to tell you whether composition is moving — in a recomp it's the number that shifts first.",
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
