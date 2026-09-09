/**
 * Body composition, from the scale that measures it.
 *
 * This used to offer three ways to get a body fat figure — a tape measure, a
 * set of calipers, or typing one in — and hedged between them because none was
 * much good. All three are gone. There is one source now: an eight-electrode
 * bioimpedance scale with a handle, read at the same two moments each week.
 *
 * That is the right call for what this app is being asked to do, and the
 * reason is not that BIA is accurate in absolute terms. It isn't especially:
 * against a four-compartment model a segmental BIA device sits within a few
 * points, and its error is largely a fixed offset for a given body and a given
 * device. The reason is that the job here is **detecting a change**, and on
 * that job it beats the alternatives outright:
 *
 *  - **The tape was actively misleading.** The Navy equation has no term that
 *    can tell a lost centimetre of waist from a gained centimetre of back, and
 *    the best validation against DXA (1,407 recruits) found its agreement got
 *    *worse* over eight weeks of training — precisely the window this app
 *    cares about. Foulis et al., Front Physiol 2023;14:1183836.
 *  - **Calipers needed a skill nobody has at home.** ISAK's tolerance for a
 *    repeat measurement by the *same accredited* tester is 7.5%; between two
 *    people comparison is not valid at all. Self-pinching produces a number
 *    whose noise swamps a month of real change.
 *  - **Eight electrodes beat four.** A foot-to-foot scale guesses the upper
 *    body from the lower. Adding a handle puts current through the arms and
 *    trunk as well, which is what turns "a scale that says a number" into
 *    something whose repeat error is small relative to the change.
 *
 * The two things that make it work are consistency and patience, and both are
 * enforced elsewhere in the app rather than assumed: the same conditions every
 * time (Monday and Saturday, first thing, after the loo, before food), and
 * never acting on a single reading. See `compositionRate` in lib/trend.ts,
 * which will not report until there are several scans across three weeks.
 *
 * BIA reads hydration, so a heavy leg session or a salty dinner moves it in
 * the direction of "more lean, less fat" without a gram of either changing.
 * Over a fortnight that averages out. Over one Saturday it does not.
 */

export type Sex = "male" | "female";

/** How a body fat figure was arrived at. There is one way now. */
export type BfMethod = "scan";

export type BfEstimate = {
  pct: number;
  leanKg: number;
  fatKg: number;
  /** ± this many percentage points against a lab method. */
  error: number;
  method: BfMethod;
  label: string;
};

/**
 * What a segmental BIA scan is worth in absolute terms, in percentage points.
 *
 * Used only to caption the figure honestly. Nothing in the app treats the
 * absolute number as precise — the protein target tolerates a few points, and
 * everything else reads the *difference* between scans, where a fixed offset
 * cancels out entirely.
 */
export const SCAN_ERROR = 3;

/** Below or above this, the reading is a mistyped number rather than a body. */
export const BF_MIN = 3;
export const BF_MAX = 60;

export function plausibleBf(pct: unknown): number | null {
  const n = Number(pct);
  if (!Number.isFinite(n) || n < BF_MIN || n > BF_MAX) return null;
  return Math.round(n * 10) / 10;
}

/** Split a bodyweight into lean and fat at a measured percentage. */
export function fromScan(pct: number, weightKg: number): BfEstimate | null {
  const clean = plausibleBf(pct);
  if (clean == null || !(weightKg > 20)) return null;
  return {
    pct: clean,
    leanKg: Math.round(weightKg * (1 - clean / 100) * 10) / 10,
    fatKg: Math.round(weightKg * (clean / 100) * 10) / 10,
    error: SCAN_ERROR,
    method: "scan",
    label: "Scan",
  };
}

/**
 * A plausible body fat percentage when there is nothing to go on.
 *
 * Only ever used to convert a lean-mass protein target into a bodyweight one
 * so the number doesn't jump when there hasn't been a scan yet. Deliberately
 * conservative — assuming someone is leaner than they are would inflate the
 * protein target, so these sit slightly on the high side.
 */
export function assumedBodyFat(sex: Sex): number {
  return sex === "female" ? 26 : 18;
}
