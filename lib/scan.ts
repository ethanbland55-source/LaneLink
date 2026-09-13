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
 * The per-limb breakdown is left off entirely: the segments are the least
 * repeatable thing a bathroom scale produces.
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

export type ScanExtras = Partial<Record<ExtraKey, number | null>>;

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

/** Body mass index, from what the app already knows. */
export function bmi(weightKg: number, heightCm: number): number | null {
  if (!(weightKg > 20) || !(heightCm > 100)) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}
