/**
 * What the scale reports, beyond the one number every target is built from.
 *
 * An eight-electrode scale with a handle — the Lepulse with its large display,
 * and anything else on the Fitdays family of firmware — reports about twenty
 * figures. Most of them are the same impedance reading passed through a
 * different formula, and it is worth being honest about which is which:
 *
 *  - **Body fat %** is the measurement. Everything the app steers on starts
 *    here, and it is the only one a scan cannot be saved without.
 *  - **Muscle mass** is the scale's own estimate of lean tissue. The app works
 *    lean mass out for itself from body fat and the *trend* weight, so this is
 *    a second opinion — and a useful one, because when the two disagree about
 *    direction the app waits rather than acting on either.
 *  - **Body water** tells you how hydrated you were, which is the main reason a
 *    single scan is unreliable. A scan taken noticeably drier than usual is
 *    flagged and left out of the slopes.
 *  - **Visceral fat, subcutaneous fat, skeletal muscle, protein, bone, BMR,
 *    body age** are shown and trended so you can see them move. None of them
 *    is precise enough to steer a calorie target by, and none is used to.
 *
 * BMI and fat-free mass are left off the form because the app can work them
 * out itself, and a number typed by hand is a number that can be typed wrong.
 *
 * ---------------------------------------------------------------------------
 * THE PER-LIMB BREAKDOWN, AND WHAT IT IS AND IS NOT FOR
 * ---------------------------------------------------------------------------
 * This section used to say the segments were left off entirely, on the grounds
 * that they are the least repeatable thing a bathroom scale produces. The first
 * half of that is still true and is why they are handled the way they are; the
 * second half — leaving them out — was overruled, and rightly: *"those scales
 * have per body part fat, fat to muscle ratio … I want you to add that in, in
 * the design, because I think that's very key as well, to see where our muscles
 * are distributed."*
 *
 * So they are in, with the honesty kept rather than dropped:
 *
 *  - **They are shown and trended, and they do not move the calorie target.**
 *    An eight-electrode scale infers each limb from one impedance path, and the
 *    same limb can read a few hundred grams apart between two scans taken
 *    minutes apart. That is fine for "where is my muscle" and useless for
 *    "should I eat less today".
 *  - **The one exception is the total**, and it is not a new opinion: the five
 *    segments added up are another estimate of the same muscle mass the scale
 *    already reports whole, so it is used exactly as `muscle_kg` is — as a
 *    second opinion that has to agree before the app acts on lean mass leaving.
 *    Two ways of measuring the same thing agreeing is worth something; either
 *    of them alone is not.
 *  - **Left against right is the reason to look.** A difference between two
 *    arms is far more trustworthy than either arm's absolute figure, because
 *    whatever the scale gets wrong it gets wrong on both sides.
 */

export type ScanKey =
  | "bf_pct"
  | "muscle_kg"
  | "water_pct"
  | "bone_kg"
  | "visceral_fat"
  | "subq_fat_pct"
  | "skeletal_pct"
  | "protein_pct"
  | "bmr_kcal"
  | "body_age";

export type ScanMetric = {
  key: ScanKey;
  /** As the scale's display words it, near enough to find it on there. */
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  decimals: number;
  /** Which way is good news, for colouring a change. Null when neither is. */
  better: "down" | "up" | null;
};

/**
 * In the order the scale's report runs, body fat first because it is the one
 * that matters and the one a scan cannot be saved without.
 */
export const SCAN_METRICS: ScanMetric[] = [
  { key: "bf_pct", label: "Body fat", unit: "%", min: 3, max: 60, step: 0.1, decimals: 1, better: "down" },
  { key: "muscle_kg", label: "Muscle mass", unit: "kg", min: 10, max: 150, step: 0.1, decimals: 1, better: "up" },
  { key: "water_pct", label: "Body water", unit: "%", min: 20, max: 80, step: 0.1, decimals: 1, better: null },
  { key: "visceral_fat", label: "Visceral fat", unit: "", min: 1, max: 60, step: 0.5, decimals: 1, better: "down" },
  { key: "subq_fat_pct", label: "Subcutaneous fat", unit: "%", min: 1, max: 60, step: 0.1, decimals: 1, better: "down" },
  { key: "skeletal_pct", label: "Skeletal muscle", unit: "%", min: 10, max: 80, step: 0.1, decimals: 1, better: "up" },
  { key: "protein_pct", label: "Protein", unit: "%", min: 5, max: 40, step: 0.1, decimals: 1, better: "up" },
  { key: "bone_kg", label: "Bone mass", unit: "kg", min: 0.5, max: 10, step: 0.1, decimals: 1, better: null },
  { key: "bmr_kcal", label: "BMR", unit: "kcal", min: 600, max: 4500, step: 1, decimals: 0, better: null },
  { key: "body_age", label: "Body age", unit: "yrs", min: 5, max: 120, step: 1, decimals: 0, better: "down" },
];

export type ExtraKey = Exclude<ScanKey, "bf_pct">;

/** Everything except body fat — the optional part of the form. */
export const EXTRA_METRICS = SCAN_METRICS.filter((m) => m.key !== "bf_pct") as (ScanMetric & {
  key: ExtraKey;
})[];

export const EXTRA_KEYS = EXTRA_METRICS.map((m) => m.key);

// --- the five segments -------------------------------------------------------

/** Left arm, right arm, trunk, left leg, right leg — the scale's own five. */
export type SegmentId = "la" | "ra" | "tr" | "ll" | "rl";

export type Segment = {
  id: SegmentId;
  label: string;
  /** The side, for the left-against-right comparison. Trunk has none. */
  side: "left" | "right" | null;
  /** Its opposite number, where it has one. */
  mirror?: SegmentId;
};

/**
 * In the order a body reads top to bottom, arms before legs, so the readout can
 * be laid out as a body rather than as a list.
 */
export const SEGMENTS: Segment[] = [
  { id: "la", label: "Left arm", side: "left", mirror: "ra" },
  { id: "ra", label: "Right arm", side: "right", mirror: "la" },
  { id: "tr", label: "Trunk", side: null },
  { id: "ll", label: "Left leg", side: "left", mirror: "rl" },
  { id: "rl", label: "Right leg", side: "right", mirror: "ll" },
];

/**
 * Both figures the scale gives for a segment, in kilograms.
 *
 * Kilograms rather than the percentages the app also shows, for one reason:
 * two numbers in the same unit can be added up, compared side to side and
 * turned into the fat-to-muscle ratio Ethan asked for. A percentage cannot,
 * because each segment's percentage is of a different denominator — its own
 * mass, which the scale does not report.
 */
export type SegmentField = "muscle_kg" | "fat_kg";

export const SEGMENT_FIELDS: { field: SegmentField; label: string; better: "up" | "down" }[] = [
  { field: "muscle_kg", label: "Muscle", better: "up" },
  { field: "fat_kg", label: "Fat", better: "down" },
];

/**
 * The database column, and the key on the wire. `seg_la_muscle_kg`.
 *
 * Spelled as a template literal type rather than `string`, so `ScanSegments`
 * below is a record of ten known keys instead of an open index. That matters:
 * an open `Record<string, number | null>` intersected into `WeighIn` makes
 * every other field on it — `day`, `tag`, `at_time` — have to be a number too,
 * and the whole trend module stops compiling.
 */
export type SegmentKey = `seg_${SegmentId}_${SegmentField}`;

export function segmentKey(id: SegmentId, field: SegmentField): SegmentKey {
  return `seg_${id}_${field}`;
}

export const SEGMENT_KEYS: SegmentKey[] = SEGMENTS.flatMap((s) =>
  SEGMENT_FIELDS.map((f) => segmentKey(s.id, f.field)),
);

/**
 * A limb holds a few kilos of muscle and a fraction of a kilo of fat; a trunk
 * holds most of both. One range covers all of it, wide enough for anybody and
 * narrow enough to catch a figure typed into the wrong box.
 */
export const SEGMENT_RANGE = { min: 0, max: 60, step: 0.1, decimals: 2 };

export type ScanSegments = Partial<Record<SegmentKey, number | null>>;

export type ScanExtras = Partial<Record<ExtraKey, number | null>> & ScanSegments;

export function metric(key: ScanKey): ScanMetric {
  return SCAN_METRICS.find((m) => m.key === key) as ScanMetric;
}

/** A typed figure inside the range that metric can plausibly take, else null. */
export function plausible(key: ScanKey, v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  const m = metric(key);
  if (!Number.isFinite(n) || n < m.min || n > m.max) return null;
  const k = 10 ** m.decimals;
  return Math.round(n * k) / k;
}

/** The same, for a segment figure. */
export function plausibleSegment(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  const { min, max, decimals } = SEGMENT_RANGE;
  if (!Number.isFinite(n) || n < min || n > max) return null;
  const k = 10 ** decimals;
  return Math.round(n * k) / k;
}

/**
 * The five segments' muscle added up, or null unless all five are there.
 *
 * All five or nothing, deliberately. A partial sum is a smaller number than a
 * whole one and nothing downstream could tell the difference — it would read as
 * muscle having vanished. See the header: this total is only ever used as a
 * second opinion on the scale's own `muscle_kg`, never on its own.
 */
export function segmentMuscleTotal(row: ScanSegments | null | undefined): number | null {
  if (!row) return null;
  let total = 0;
  for (const s of SEGMENTS) {
    const v = row[segmentKey(s.id, "muscle_kg")];
    if (v == null || !(Number(v) > 0)) return null;
    total += Number(v);
  }
  return Math.round(total * 100) / 100;
}

/** Fat against muscle for one segment, or null when either is missing. */
export function segmentRatio(row: ScanSegments | null | undefined, id: SegmentId): number | null {
  const muscle = row?.[segmentKey(id, "muscle_kg")];
  const fat = row?.[segmentKey(id, "fat_kg")];
  if (muscle == null || fat == null || !(Number(muscle) > 0)) return null;
  return Math.round((Number(fat) / Number(muscle)) * 1000) / 1000;
}

/** Body mass index, from what the app already knows. */
export function bmi(weightKg: number, heightCm: number): number | null {
  if (!(weightKg > 20) || !(heightCm > 100)) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}
