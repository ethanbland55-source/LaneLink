/**
 * Body fat without a DEXA scan.
 *
 * Lean-mass protein targets need a body fat percentage, and most people don't
 * have one. There are two ways to get a usable figure at home, and they suit
 * different people, so the app offers both rather than picking for you:
 *
 *  - **A tape measure** (US Navy circumference method). Neck once, waist
 *    whenever you measure it anyway. No equipment, works for everyone, ±3–4
 *    points against DEXA.
 *  - **Calipers** (Jackson–Pollock 3-site + Siri). More accurate — ±3 points,
 *    and better still on lean people, where the tape method struggles because
 *    a small waist change moves the answer a lot. Needs calipers and a bit of
 *    practice pinching the same spot each time.
 *
 * Either way the error is largely a *fixed offset* for a given person and body
 * shape. That makes the absolute number worth treating as approximate and the
 * change over time worth trusting — which is the right way round here, since
 * the number feeds a protein target (tolerant of a few points) and the job of
 * watching lean mass hold while the waist comes in (a difference, where the
 * offset cancels).
 *
 * Both estimates are also **attribution-blind**: they see a smaller waist or a
 * thinner pinch and call all of it fat. Over a few weeks that is usually right.
 * Over a few days it is mostly water.
 */

export type Sex = "male" | "female";

/** How a body fat figure was arrived at. */
export type BfMethod = "tape" | "skinfold" | "manual";

export type BfEstimate = {
  pct: number;
  leanKg: number;
  fatKg: number;
  /** ± this many percentage points, roughly. Zero when you measured it. */
  error: number;
  method: BfMethod;
  label: string;
};

/** Where to put the tape or the calipers. Short on purpose. */
export const MEASURE_SITES: Record<
  string,
  { label: string; where: string; unit: "cm" | "mm"; sex?: Sex }
> = {
  neck_cm: { label: "Neck", where: "just below the larynx, tape sloping slightly down at the front", unit: "cm" },
  waist_cm: { label: "Waist", where: "at the navel, relaxed, on the out-breath", unit: "cm" },
  hip_cm: { label: "Hips", where: "widest point of the buttocks", unit: "cm", sex: "female" },
  sf_chest: { label: "Chest", where: "diagonal, halfway between armpit and nipple", unit: "mm", sex: "male" },
  sf_abdomen: { label: "Abdomen", where: "vertical, 2 cm to the right of the navel", unit: "mm", sex: "male" },
  sf_thigh: { label: "Thigh", where: "vertical, halfway between hip and kneecap, front", unit: "mm" },
  sf_tricep: { label: "Tricep", where: "vertical, halfway between shoulder and elbow, back of the arm", unit: "mm", sex: "female" },
  sf_suprailiac: { label: "Hip bone", where: "diagonal, just above the front of the hip bone", unit: "mm", sex: "female" },
};

/** Which sites each method needs, for this person. */
export function sitesFor(method: BfMethod, sex: Sex): string[] {
  if (method === "tape") return sex === "female" ? ["neck_cm", "waist_cm", "hip_cm"] : ["neck_cm", "waist_cm"];
  if (method === "skinfold")
    return sex === "female"
      ? ["sf_tricep", "sf_suprailiac", "sf_thigh"]
      : ["sf_chest", "sf_abdomen", "sf_thigh"];
  return [];
}

export const BF_METHODS: { value: BfMethod; label: string; blurb: string }[] = [
  { value: "tape", label: "Tape measure", blurb: "Neck and waist. No kit needed." },
  { value: "skinfold", label: "Calipers", blurb: "Three pinches. More accurate if you have them." },
  { value: "manual", label: "Type it in", blurb: "You've had a DEXA or InBody scan." },
];

function finish(pct: number, weightKg: number, method: BfMethod, error: number, label: string): BfEstimate | null {
  // Outside this range the equations have left the data they were fitted on.
  if (!Number.isFinite(pct) || pct < 3 || pct > 60) return null;
  const rounded = Math.round(pct * 10) / 10;
  return {
    pct: rounded,
    leanKg: Math.round(weightKg * (1 - rounded / 100) * 10) / 10,
    fatKg: Math.round(weightKg * (rounded / 100) * 10) / 10,
    error,
    method,
    label,
  };
}

/**
 * US Navy circumference method, metric.
 *
 * Men need neck and waist; women also need hips.
 */
export function navyBodyFat(input: {
  sex: Sex;
  heightCm: number;
  neckCm: number;
  waistCm: number;
  hipCm?: number | null;
  weightKg: number;
}): BfEstimate | null {
  const { sex, heightCm, neckCm, waistCm, weightKg } = input;
  const hipCm = input.hipCm ?? 0;

  if (!(heightCm > 100 && neckCm > 20 && waistCm > 40 && weightKg > 20)) return null;

  let pct: number;
  if (sex === "female") {
    if (!(hipCm > 50)) return null;
    const inner = waistCm + hipCm - neckCm;
    if (inner <= 1) return null;
    pct = 495 / (1.29579 - 0.35004 * Math.log10(inner) + 0.221 * Math.log10(heightCm)) - 450;
  } else {
    const inner = waistCm - neckCm;
    if (inner <= 1) return null;
    pct = 495 / (1.0324 - 0.19077 * Math.log10(inner) + 0.15456 * Math.log10(heightCm)) - 450;
  }

  return finish(pct, weightKg, "tape", 3.5, "Navy tape");
}

/**
 * Jackson–Pollock three-site skinfold, converted with the Siri equation.
 *
 * Body density comes from the sum of three pinches and your age — the sites
 * differ by sex because that is where the fat that tracks total fat actually
 * sits. Siri then turns density into a percentage.
 *
 * Pinch the same spot on the same side each time and take the reading a couple
 * of seconds after the calipers settle. Consistency matters more than being
 * exactly on the anatomical landmark: a repeatable 2 mm error cancels out of
 * every difference, and a wandering one does not.
 */
export function skinfoldBodyFat(input: {
  sex: Sex;
  ageYears: number;
  /** Male: chest, abdomen, thigh. Female: tricep, suprailiac, thigh. In mm. */
  sites: number[];
  weightKg: number;
}): BfEstimate | null {
  const { sex, ageYears, sites, weightKg } = input;
  if (sites.length !== 3 || sites.some((v) => !(v > 0 && v < 80))) return null;
  if (!(ageYears > 0 && ageYears < 120 && weightKg > 20)) return null;

  const sum = sites.reduce((a, b) => a + b, 0);
  const density =
    sex === "female"
      ? 1.0994921 - 0.0009929 * sum + 0.0000023 * sum * sum - 0.0001392 * ageYears
      : 1.10938 - 0.0008267 * sum + 0.0000016 * sum * sum - 0.0002574 * ageYears;

  if (!(density > 0.9 && density < 1.15)) return null;
  const pct = 495 / density - 450; // Siri

  return finish(pct, weightKg, "skinfold", 3.0, "Calipers, 3-site");
}

/**
 * A plausible body fat percentage when there is nothing to go on.
 *
 * Only ever used to convert a lean-mass protein target into a bodyweight one
 * so the number doesn't jump when the estimate isn't available. Deliberately
 * conservative — assuming someone is leaner than they are would inflate the
 * protein target, so these sit slightly on the high side.
 */
export function assumedBodyFat(sex: Sex): number {
  return sex === "female" ? 26 : 18;
}
