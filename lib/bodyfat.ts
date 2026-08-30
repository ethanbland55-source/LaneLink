/**
 * Body fat without a DEXA scan.
 *
 * Lean-mass protein targets need a body fat percentage, and most people don't
 * have one. The US Navy circumference method gets you there with a tape
 * measure: neck once, waist whenever you measure it anyway.
 *
 * It is accurate to roughly ±3–4 percentage points against DEXA, which sounds
 * bad and mostly isn't, because the error is largely a fixed offset for a given
 * person and body shape. That makes the *absolute* number worth treating as
 * approximate and the *change over time* worth trusting — which is the right
 * way round for this app, since the number is used for a protein target
 * (tolerant of a few points) and to watch lean mass hold while the waist comes
 * in (a difference, where the offset cancels).
 */

export type Sex = "male" | "female";

export type BfEstimate = {
  pct: number;
  leanKg: number;
  fatKg: number;
  /** ± this many percentage points, roughly. Zero when you measured it. */
  error: number;
  method: "Navy tape" | "measured";
};

/**
 * US Navy circumference method, metric.
 *
 * Men need neck and waist; women also need hips. Waist is measured at the
 * navel, neck just below the larynx, both relaxed and level.
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
    pct =
      495 /
        (1.29579 - 0.35004 * Math.log10(inner) + 0.221 * Math.log10(heightCm)) -
      450;
  } else {
    const inner = waistCm - neckCm;
    if (inner <= 1) return null;
    pct =
      495 /
        (1.0324 - 0.19077 * Math.log10(inner) + 0.15456 * Math.log10(heightCm)) -
      450;
  }

  // Outside this range the equation has left the data it was fitted on.
  if (!Number.isFinite(pct) || pct < 3 || pct > 60) return null;

  const rounded = Math.round(pct * 10) / 10;
  return {
    pct: rounded,
    leanKg: Math.round(weightKg * (1 - rounded / 100) * 10) / 10,
    fatKg: Math.round(weightKg * (rounded / 100) * 10) / 10,
    error: 3.5,
    method: "Navy tape",
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
