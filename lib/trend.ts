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

import { EXTRA_KEYS, type ScanExtras } from "./scan";

export type Tag = "morning" | "evening" | "other";

export const TAGS: { value: Tag; label: string; hint: string }[] = [
  { value: "morning", label: "Morning", hint: "after the loo, before food" },
  { value: "other", label: "Daytime", hint: "anything in between" },
  { value: "evening", label: "Evening", hint: "end of the day" },
];

export type WeighIn = {
  day: string;
  weight_kg: number | null;
  tag?: Tag | null;
  /** Clock time you stood on the scale, "HH:MM". Null on older readings. */
  at_time?: string | null;
  /** Body fat from the scan, on the days there was one. */
  bf_pct?: number | null;
  /**
   * How that figure was arrived at. "scan" from here on; older readings can
   * still say "tape" or "skinfold", and those are deliberately not treated as
   * scans — see `isScan`.
   */
  bf_method?: string | null;
} & ScanExtras;

/**
 * Whether a stored body fat figure is one this app is willing to trend.
 *
 * The tape and caliper estimates are gone, but readings taken with them are
 * still in the database, and they cannot be mixed with scans. It is not a
 * question of which is more accurate: each method has its own fixed offset for
 * a given body, so a series that switches method has a step in it that looks
 * exactly like a month of progress and isn't. Two tape readings and two scans
 * would also clear the four-scan gate and let the steer act on a change that
 * was purely a change of instrument.
 *
 * So old estimates stay in their rows and out of the maths. Anything not
 * explicitly one of the retired methods counts — a figure typed in from a DEXA
 * report has no method recorded and is a perfectly good point.
 */
export function isScan(e: WeighIn): boolean {
  if (e.bf_pct == null || !(Number(e.bf_pct) > 0)) return false;
  return e.bf_method !== "tape" && e.bf_method !== "skinfold";
}

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
  /** What that comes to at each tag's hour — for display, and for old readings. */
  weight: Record<Tag, number>;
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

  const at = (t: Tag) => riseAt(hoursAwake(TAG_HOUR[t]), risePerHour);

  return {
    risePerHour,
    weight: { morning: at("morning"), other: at("other"), evening: at("evening") },
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

/* ------------------------------------------------------------------ */
/* What the scale is actually made of                                  */
/* ------------------------------------------------------------------ */

/**
 * Two scans a week, and the two numbers that matter under the one on the dial.
 *
 * Bodyweight on its own cannot tell you whether a recomposition is working —
 * that is the entire problem it has. Weight holding still is the *goal*, and
 * it is also what failure looks like. The pair that separates them is fat mass
 * and lean mass moving in opposite directions.
 *
 * The lean figure here is deliberately not the scale's raw one. A scan carries
 * two sources of movement: a real change in tissue, and how hydrated you
 * happened to be that morning — and bioimpedance reads hydration directly, so
 * a heavy leg session on Friday makes Saturday look leaner than Monday did for
 * no reason at all. So the percentage comes from the scan and the bodyweight
 * it is applied to comes from the smoothed trend, which has already had the
 * daily water swing taken out of it. Same measurement, less noise in it.
 */
export type ScanPoint = {
  day: string;
  bfPct: number;
  /** Trend bodyweight on the day of the scan, not the raw reading. */
  weightKg: number;
  leanKg: number;
  fatKg: number;
  /** Everything else the scale reported that morning, as typed. */
  extras: ScanExtras;
  /**
   * Taken noticeably wetter or drier than your usual, so left out of the
   * slopes. Shown, never deleted — it still happened.
   */
  offHydration: boolean;
};

/**
 * How far two scans have to differ before the difference is real.
 *
 * Segmental bioimpedance repeats itself to well under a percentage point in
 * standardised conditions, and to rather more than that in a bathroom. This
 * sits at the pessimistic end on purpose: it is only ever used to stop the app
 * announcing a trend that a glass of water could have produced.
 */
export const SCAN_NOISE_PTS = 0.8;

/**
 * Fewer scans than this, or a shorter span, and no slope gets reported.
 *
 * 19 days rather than a round three weeks so that scanning Monday and Saturday
 * settles on the third Saturday — in time for the Monday roll after it, rather
 * than a week later because the last scan landed a couple of days short.
 */
export const SCAN_MIN_POINTS = 4;
export const SCAN_MIN_DAYS = 19;

/**
 * How far body water may sit from your usual, as a share of lean mass, before
 * a scan is treated as taken in the wrong conditions.
 *
 * Lean tissue is about 73% water and stays remarkably close to that in any one
 * person — which is exactly why a drier morning reads as "more fat": the scale
 * sees less water, assumes less lean. So the check is on water per kilo of
 * lean mass, not on the water percentage itself. On a scale that simply
 * derives water from body fat this ratio never moves and the check never
 * fires, which is the right result — it cannot see what the scale did not
 * measure.
 */
export const HYDRATION_TOLERANCE = 0.025;

export type Composition = {
  points: ScanPoint[];
  scans: number;
  /** Days from the first scan in the window to the last. */
  days: number;
  first: ScanPoint;
  current: ScanPoint;
  /** Slopes over 28 days. Negative body fat and positive lean is the goal. */
  bfPtsPerMonth: number;
  leanKgPerMonth: number;
  fatKgPerMonth: number;
  /**
   * The scale's own muscle figure, as a slope. Null until there are enough
   * scans that carried one. Used as a second opinion on the lean slope.
   */
  muscleKgPerMonth: number | null;
  /** Scans left out of the slopes for being off-hydration. */
  excluded: number;
  /** True when there are enough scans over enough time to read the slopes. */
  settled: boolean;
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Every scan in the window, with lean and fat mass worked out against the
 * trend weight of the day it was taken.
 */
export function composition(entriesRaw: WeighIn[], windowDays = 84): Composition | null {
  const line = trendLine(entriesRaw);
  const trendByDay = new Map(line.map((p) => [p.day, p.trend]));
  const corrected = normalise(entriesRaw);
  const weightByDay = new Map(
    corrected.filter((e) => e.weight_kg != null).map((e) => [e.day, Number(e.weight_kg)])
  );

  const scans = entriesRaw
    .filter(isScan)
    .map((e) => {
      const extras: ScanExtras = {};
      for (const k of EXTRA_KEYS) {
        const v = (e as any)[k];
        if (v != null && Number.isFinite(Number(v))) extras[k] = Number(v);
      }
      return { day: e.day, bfPct: Number(e.bf_pct), extras };
    })
    .sort((a, b) => a.day.localeCompare(b.day));
  if (!scans.length) return null;

  const last = scans[scans.length - 1].day;
  const cutoff = isoDay(new Date(toDate(last).getTime() - windowDays * 86_400_000));

  /**
   * The trend on a day with no weigh-in of its own.
   *
   * A scan morning is usually a weigh-in morning too, but not always — and a
   * scan with no weight on its day used to be dropped without a word. The trend
   * barely moves in a day, so the nearest one before it (or, for a scan older
   * than any weigh-in, the first one after) is the right figure to use.
   */
  const nearestTrend = (day: string): number | undefined => {
    let before: number | undefined;
    for (const p of line) {
      if (p.day <= day) before = p.trend;
      else return before ?? p.trend;
    }
    return before;
  };

  const points: ScanPoint[] = [];
  for (const s of scans) {
    if (s.day < cutoff) continue;
    const kg = trendByDay.get(s.day) ?? weightByDay.get(s.day) ?? nearestTrend(s.day);
    if (kg == null || !(kg > 20)) continue;
    points.push({
      day: s.day,
      bfPct: Math.round(s.bfPct * 10) / 10,
      weightKg: Math.round(kg * 10) / 10,
      leanKg: Math.round(kg * (1 - s.bfPct / 100) * 10) / 10,
      fatKg: Math.round(kg * (s.bfPct / 100) * 10) / 10,
      extras: s.extras,
      offHydration: false,
    });
  }
  if (!points.length) return null;

  // Hydration: water per unit of lean, against this person's own usual. Needs
  // a few scans carrying a water figure before "usual" means anything.
  const ratio = (p: ScanPoint) => {
    const w = p.extras.water_pct;
    return w != null && p.bfPct < 100 ? w / (100 - p.bfPct) : null;
  };
  const ratios = points.map(ratio).filter((r): r is number => r != null);
  if (ratios.length >= 4) {
    const usual = median(ratios);
    for (const p of points) {
      const r = ratio(p);
      p.offHydration = r != null && Math.abs(r - usual) > HYDRATION_TOLERANCE;
    }
  }

  // Off-hydration scans only come out if enough are left to fit a line to —
  // otherwise dropping them would just leave nothing, which is worse.
  const kept = points.filter((p) => !p.offHydration);
  const fitOn = kept.length >= SCAN_MIN_POINTS ? kept : points;

  const first = points[0];
  const current = points[points.length - 1];
  const t0 = toDate(fitOn[0].day).getTime();
  const at = (p: ScanPoint) => (toDate(p.day).getTime() - t0) / 86_400_000;
  const days = Math.round(at(fitOn[fitOn.length - 1]));

  const perDay = (pick: (p: ScanPoint) => number) =>
    slopePerDay(fitOn.map((p) => ({ t: at(p), v: pick(p) })));

  const withMuscle = fitOn.filter((p) => p.extras.muscle_kg != null);
  const muscleSpan =
    withMuscle.length >= 2 ? at(withMuscle[withMuscle.length - 1]) - at(withMuscle[0]) : 0;

  return {
    points,
    scans: fitOn.length,
    days,
    first,
    current,
    bfPtsPerMonth: perDay((p) => p.bfPct) * 28,
    leanKgPerMonth: perDay((p) => p.leanKg) * 28,
    fatKgPerMonth: perDay((p) => p.fatKg) * 28,
    muscleKgPerMonth:
      withMuscle.length >= SCAN_MIN_POINTS && muscleSpan >= SCAN_MIN_DAYS
        ? slopePerDay(withMuscle.map((p) => ({ t: at(p), v: p.extras.muscle_kg as number }))) * 28
        : null,
    excluded: points.length - fitOn.length,
    settled: fitOn.length >= SCAN_MIN_POINTS && days >= SCAN_MIN_DAYS,
  };
}

/**
 * How far one of the scale's figures has moved across the window, first scan
 * that carried it to the latest. For the readout, not for steering.
 */
export function extraChange(
  comp: Composition,
  key: keyof ScanExtras
): { from: number; to: number; change: number; since: string } | null {
  const has = comp.points.filter((p) => p.extras[key] != null);
  if (has.length < 2) return null;
  const a = has[0];
  const b = has[has.length - 1];
  return {
    from: a.extras[key] as number,
    to: b.extras[key] as number,
    change: (b.extras[key] as number) - (a.extras[key] as number),
    since: a.day,
  };
}

/**
 * How much lean mass may drift down a month before it counts as being lost.
 *
 * Scan-to-scan noise puts a floor under this: at 67 kg of lean mass, a single
 * point of body fat is about 0.7 kg, so a threshold much tighter than this
 * would fire on hydration alone.
 */
export const LEAN_LOSS_PER_MONTH = -0.25;

/** Fat mass coming off at least this fast a month is the thing working. */
export const FAT_LOSS_PER_MONTH = -0.3;

/**
 * Fat mass going *on* faster than this a month is going on.
 *
 * It exists because of a trap in reading the two numbers separately. At a
 * bodyweight that is not moving, lean and fat are the same measurement with
 * the sign flipped — every kilo of fat gained is a kilo of lean "lost" whether
 * or not any muscle went anywhere. So "lean mass is falling" cannot be allowed
 * to mean "you are under-eating" on its own: it means that only when fat is
 * falling too, and means the exact opposite when fat is climbing.
 */
export const FAT_RISE_PER_MONTH = 0.1;


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
