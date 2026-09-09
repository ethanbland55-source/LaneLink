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
};

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

/** Fewer scans than this, or a shorter span, and no slope gets reported. */
export const SCAN_MIN_POINTS = 4;
export const SCAN_MIN_DAYS = 21;

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
  /** True when there are enough scans over enough time to read the slopes. */
  settled: boolean;
};

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
    .map((e) => ({ day: e.day, bfPct: Number(e.bf_pct) }))
    .sort((a, b) => a.day.localeCompare(b.day));
  if (!scans.length) return null;

  const last = scans[scans.length - 1].day;
  const cutoff = isoDay(new Date(toDate(last).getTime() - windowDays * 86_400_000));

  const points: ScanPoint[] = [];
  for (const s of scans) {
    if (s.day < cutoff) continue;
    const kg = trendByDay.get(s.day) ?? weightByDay.get(s.day);
    if (kg == null || !(kg > 20)) continue;
    points.push({
      day: s.day,
      bfPct: Math.round(s.bfPct * 10) / 10,
      weightKg: Math.round(kg * 10) / 10,
      leanKg: Math.round(kg * (1 - s.bfPct / 100) * 10) / 10,
      fatKg: Math.round(kg * (s.bfPct / 100) * 10) / 10,
    });
  }
  if (!points.length) return null;

  const first = points[0];
  const current = points[points.length - 1];
  const t0 = toDate(first.day).getTime();
  const at = (p: ScanPoint) => (toDate(p.day).getTime() - t0) / 86_400_000;
  const days = Math.round(at(current));

  const perDay = (pick: (p: ScanPoint) => number) =>
    slopePerDay(points.map((p) => ({ t: at(p), v: pick(p) })));

  return {
    points,
    scans: points.length,
    days,
    first,
    current,
    bfPtsPerMonth: perDay((p) => p.bfPct) * 28,
    leanKgPerMonth: perDay((p) => p.leanKg) * 28,
    fatKgPerMonth: perDay((p) => p.fatKg) * 28,
    settled: points.length >= SCAN_MIN_POINTS && days >= SCAN_MIN_DAYS,
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

export type Verdict = {
  headline: string;
  detail: string;
  tone: "good" | "watch" | "neutral";
};

/**
 * What the scale and the scans say together.
 *
 * Weight alone is ambiguous here, and ambiguous in the worst possible way:
 * holding steady is both what a working recomposition looks like and what
 * doing nothing looks like. That is the case people abandon, because the
 * number they check every morning never rewards them for it.
 *
 * With two scans a week the ambiguity goes. Fat mass down and lean mass level
 * or up, at a bodyweight that barely moves, is the objective — and it is now a
 * thing the app can see rather than something you have to take on faith.
 *
 * The failure modes are read in order of what they cost. Losing lean mass
 * comes first, because it is the expensive one and the only one you cannot get
 * back quickly; in a training block it shows up in a session before it shows
 * up anywhere else. Losing nothing at all comes second, because it is only a
 * wasted month.
 */
export function recompVerdict(rate: Rate | null, comp: Composition | null): Verdict {
  if (!rate) {
    return {
      headline: "Not enough data yet",
      detail:
        "Weigh in on most days for a couple of weeks and the trend appears. It doesn't have to be the same time each day — say when you weighed and the reading is corrected before it counts.",
      tone: "neutral",
    };
  }

  const pct = rate.pctPerWeek;
  const kg = Math.abs(rate.kgPerWeek).toFixed(2);

  // Under three weeks of scans there is nothing here that isn't hydration.
  if (!comp || !comp.settled) {
    const need = comp
      ? `${Math.max(0, SCAN_MIN_POINTS - comp.scans)} more scan${
          SCAN_MIN_POINTS - comp.scans === 1 ? "" : "s"
        }`
      : "a few scans";
    const waiting = `Weight is the ambiguous half of this — flat is what working looks like and also what nothing looks like. ${
      comp ? `Give it ${need}` : "Scan on Monday and Saturday"
    } and this can tell you which.`;

    if (Math.abs(pct) <= 0.25) {
      return { headline: "Holding steady", detail: waiting, tone: "neutral" };
    }
    if (pct < -0.7) {
      return {
        headline: `Losing ${kg} kg a week — too fast for this`,
        detail:
          "Past about 0.7% of bodyweight a week you start giving back lean mass. Add a few hundred calories.",
        tone: "watch",
      };
    }
    return {
      headline: pct < 0 ? `Losing ${kg} kg a week` : `Gaining ${kg} kg a week`,
      detail: waiting,
      tone: "neutral",
    };
  }

  const fat = comp.fatKgPerMonth;
  const lean = comp.leanKgPerMonth;
  const bf = comp.bfPtsPerMonth;
  const bfWord = `${bf >= 0 ? "+" : ""}${bf.toFixed(1)} points a month, ${comp.current.bfPct}% now`;

  if (lean < LEAN_LOSS_PER_MONTH) {
    return {
      headline: `Lean mass is going the wrong way`,
      detail: `Down ${Math.abs(lean).toFixed(1)} kg a month across ${comp.scans} scans. That is the expensive kind of loss and the one you feel in the pool first. Eat more — the plan will nudge itself up on Monday.`,
      tone: "watch",
    };
  }

  if (pct < -0.7) {
    return {
      headline: `Losing ${kg} kg a week — too fast for this`,
      detail: `Fat is coming off (${bfWord}), but past about 0.7% of bodyweight a week the rest of it starts coming off too. The plan will ease up on Monday.`,
      tone: "watch",
    };
  }

  if (fat <= FAT_LOSS_PER_MONTH && lean >= 0) {
    return {
      headline: "Recomposition, working",
      detail: `Fat down ${Math.abs(fat).toFixed(1)} kg a month, lean up ${lean.toFixed(1)} kg, at a weight that has barely moved. That is the whole objective — ${bfWord}. Don't let the scale talk you out of it.`,
      tone: "good",
    };
  }

  if (fat <= FAT_LOSS_PER_MONTH) {
    return {
      headline: "Fat coming off, lean holding",
      detail: `Down ${Math.abs(fat).toFixed(1)} kg of fat a month with lean mass level — ${bfWord}. Exactly the trade you want. Keep protein where it is.`,
      tone: "good",
    };
  }

  if (Math.abs(bf) <= SCAN_NOISE_PTS / 2) {
    return {
      headline: "Nothing is moving",
      detail: `Body fat has sat at ${comp.current.bfPct}% for ${comp.days} days and weight is ${
        Math.abs(pct) <= 0.25 ? "flat" : `${pct < 0 ? "down" : "up"} ${kg} kg a week`
      }. Maintenance is probably a little higher than the plan thinks. Monday will take it down a notch.`,
      tone: "watch",
    };
  }

  if (bf > 0) {
    return {
      headline: "Body fat is creeping up",
      detail: `${bfWord}. If this is meant to be toned maintenance, the target is too high — Monday's rebuild will bring it down gradually rather than all at once.`,
      tone: "watch",
    };
  }

  return {
    headline: "Moving the right way, slowly",
    detail: `${bfWord}, lean ${lean >= 0 ? "up" : "down"} ${Math.abs(lean).toFixed(1)} kg. Too gentle to celebrate and too gentle to worry about — give it another fortnight of scans.`,
    tone: "neutral",
  };
}
