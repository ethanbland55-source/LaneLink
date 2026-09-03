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
  {
    value: "tape",
    label: "Tape measure",
    blurb: "Neck and waist. No kit needed, but it over-reads when you're lean and can't tell a smaller waist from a bigger back — a fallback, not something to track.",
  },
  {
    value: "skinfold",
    label: "Calipers",
    blurb: "Three pinches. Better for an athlete, and the sum in mm is the bit worth watching.",
  },
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

  /**
   * Four points of error, not three and a half — and it is the wrong shape of
   * error for a lean swimmer.
   *
   * The best modern validation against DXA (1,407 army recruits) put the
   * standard error at 3.42 %BF but found something worse than the size of it:
   * the equation over-reads at the lean end, and its agreement got *worse*
   * over eight weeks of training. It has no term that can tell a lost
   * centimetre of waist from a gained centimetre of shoulder, so an athlete
   * who is building a back and losing belly fat can watch the number go the
   * wrong way while everything is going right.
   *
   *   Foulis, Friedl, Spiering, et al., Front Physiol 2023;14:1183836.
   *
   * So it stays as a fallback, and the app should not treat it as a progress
   * metric. Calipers, and better still the raw sum of pinches, are what to
   * watch. See `sumOfSites`.
   */
  return finish(pct, weightKg, "tape", 4.0, "Navy tape (rough)");
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

  /**
   * For men, Evans rather than Jackson–Pollock.
   *
   * Jackson–Pollock predicts body *density* on a general-population sample and
   * then Siri converts that to a percentage — and Siri assumes fat-free tissue
   * has a density of 1.100 g/cm³, which a young, well-trained, high-bone-mineral
   * athlete does not. That assumption biases the answer systematically, so it
   * does not wash out over repeated measures.
   *
   * Evans skips the density step. It was built on 132 collegiate athletes
   * against a four-component model — deuterium dilution plus DXA plus
   * underwater weighing — which is the right criterion precisely because it
   * removes the fixed-density assumption. In an independent head-to-head in 91
   * young athletes it was the best performer for males, beating both
   * Jackson–Pollock and the Lohman equation that is often the default.
   *
   *   Evans, Rowe, Misic, Prior & Arngrímsson, MSSE 2005;37(11):2006.
   *   Jones et al., Front Sports Act Living 2023;5:1240252.
   *
   * The published equation carries a dichotomous race coefficient. It is
   * omitted here deliberately: it is a 2005 modelling convention standing in
   * for population differences in fat-free mass density, it is not something
   * this app is going to ask anyone, and shipping it would mean shipping a
   * worse idea than the accuracy is worth. Dropping it costs about 2 %BF of
   * offset for one group, which is inside the equation's own error band and
   * cancels out of every change over time — which is what actually gets used.
   *
   * Women keep Jackson–Pollock: Evans's female sites do not match the three
   * this app collects, and a mismatched equation is worse than a dated one.
   */
  let pct: number;
  let error: number;
  let label: string;

  if (sex === "male") {
    // Evans 3-site: abdomen, thigh, triceps. This app collects chest, abdomen,
    // thigh — chest stands in for triceps, which is a real approximation and
    // is why the error band below is not smaller.
    pct = 8.997 + 0.24658 * sum - 6.343;
    error = 3.7;
    label = "Calipers, 3-site (Evans)";
  } else {
    const density = 1.0994921 - 0.0009929 * sum + 0.0000023 * sum * sum - 0.0001392 * ageYears;
    if (!(density > 0.9 && density < 1.15)) return null;
    pct = 495 / density - 450; // Siri
    error = 3.5;
    label = "Calipers, 3-site";
  }

  if (!(pct > 2 && pct < 60)) return null;
  return finish(pct, weightKg, "skinfold", error, label);
}

/* ------------------------------------------------------------------ */
/* The number worth actually tracking                                  */
/* ------------------------------------------------------------------ */

/**
 * The sum of the pinches, in millimetres, with no percentage anywhere near it.
 *
 * This is the metric to watch, and the reason is worth stating plainly. There
 * are over a hundred published equations for turning skinfolds into a body fat
 * percentage, and on identical raw measurements they disagree wildly — one
 * worked example put the same athlete anywhere between 4% and 8%. Skinfolds
 * are already an indirect measure; running them through a population
 * regression to reach a criterion that was itself an estimate makes the answer
 * doubly indirect. And the equations were validated for telling you where
 * someone *is*, not for tracking where an individual is *going*, which is the
 * only thing this app needs.
 *
 * The millimetres, meanwhile, are a real measurement of the actual tissue.
 * They move when fat moves. They are also the measure least disturbed by the
 * things a swimmer cannot control — a DXA scan shifts by up to 2.6% fat mass
 * after a single meal and 2.5% lean mass after carb loading, which makes it
 * useless the week of a meet.
 *
 *   Kasper, Langan-Evans, Hudson, et al., "Come Back Skinfolds, All Is
 *   Forgiven", Nutrients 2021;13(4):1075.
 *   Ackland et al., IOC position statement, Sports Med 2012;42(3):227.
 */
export type SumOfSites = {
  sum: number;
  sites: number;
  /** Change since the comparison reading, in mm. Null when there isn't one. */
  change: number | null;
  /** True when the change is smaller than measurement error can distinguish. */
  withinNoise: boolean;
  note: string;
};

/**
 * Measurement noise, as a fraction of the sum.
 *
 * ISAK's accreditation tolerance for repeat skinfolds by the same tester is
 * 7.5% at Level 1 and 5% above it. Someone pinching themselves at home is not
 * accredited, so 7.5% is the generous reading and this uses it: on a sum of
 * 55 mm that is about 4 mm, and a change smaller than that is not a change.
 *
 * The same-tester part is not a detail. Between two different people the
 * tolerance is far wider and comparison is simply not valid, which for this
 * app means: always you, always the same calipers, always the same sites.
 */
export const SKINFOLD_NOISE = 0.075;

export function sumOfSites(now: number[], before?: number[]): SumOfSites | null {
  const usable = now.filter((v) => Number.isFinite(v) && v > 0);
  if (usable.length < 2) return null;
  const sum = Math.round(usable.reduce((a, b) => a + b, 0) * 10) / 10;

  const prior = (before ?? []).filter((v) => Number.isFinite(v) && v > 0);
  if (prior.length !== usable.length) {
    return {
      sum,
      sites: usable.length,
      change: null,
      withinNoise: false,
      note: `${sum} mm across ${usable.length} sites. This is the number to watch — it measures the tissue rather than estimating a percentage from it.`,
    };
  }

  const was = prior.reduce((a, b) => a + b, 0);
  const change = Math.round((sum - was) * 10) / 10;
  const noise = Math.max(2, was * SKINFOLD_NOISE);
  const withinNoise = Math.abs(change) < noise;

  return {
    sum,
    sites: usable.length,
    change,
    withinNoise,
    note: withinNoise
      ? `${change >= 0 ? "+" : ""}${change} mm, which is inside what a repeat pinch can tell apart (±${Math.round(noise)} mm). Not yet a trend.`
      : `${change >= 0 ? "+" : ""}${change} mm since last time — past measurement noise, so this one is real.`,
  };
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
