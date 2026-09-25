/**
 * One place that turns whatever the database (or an older version of the app)
 * hands back into a complete Profile. Both pages and the API route used to
 * keep their own copy of this and they had already drifted apart.
 */

import {
  WEEKDAYS,
  goalDef,
  normaliseEvents,
  type EnergyModel,
  type Goal,
  type Pace,
  type Profile,
  type ProteinBasis,
  type Review,
  type WeekMap,
  type Weekday,
} from "./nutrition";
import { STEER_LIMIT } from "./steer";

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function optionalNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The week is a map of weekday to day-type id. Ids that no longer exist are
 * left as 0 and resolved to the first day type when the plan is built, so
 * deleting a day type can never strand the week in a broken state.
 */
export function normaliseWeek(raw: unknown): WeekMap {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out = {} as WeekMap;
  for (const d of WEEKDAYS) {
    const n = Number(src[d]);
    out[d as Weekday] = Number.isFinite(n) && n > 0 ? n : 0;
  }
  return out;
}

const GOAL_VALUES: Goal[] = ["cut", "maintain", "recomp", "bulk"];
const PACE_VALUES: Pace[] = ["gentle", "steady", "faster"];

/**
 * A stored date as "YYYY-MM-DD", whatever shape it arrives in.
 *
 * The API formats these in SQL, but a Date object still reaches here from
 * older callers and from tests — and `String(date).slice(0, 10)` quietly
 * produces "Sun Aug 30", which every later `new Date(...)` turns into NaN.
 * One bad date silently made every calorie target NaN, so this is defensive
 * on purpose.
 */
function isoDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** A stored review, or null if it isn't one — jsonb arrives parsed, text doesn't. */
function reviewOf(v: unknown): Review | null {
  let r: any = v;
  if (typeof v === "string") {
    try {
      r = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return r && typeof r === "object" && typeof r.headline === "string" && r.from && r.to
    ? (r as Review)
    : null;
}

export function normaliseProfile(p: any): Profile {
  const model: EnergyModel = p?.energy_model === "flat" ? "flat" : "sessions";
  const goal: Goal = GOAL_VALUES.includes(p?.goal) ? p.goal : "maintain";
  const def = goalDef(goal);

  return {
    sex: p?.sex === "female" ? "female" : "male",
    dob: isoDate(p?.dob),
    height_cm: num(p?.height_cm, 180),
    weight_kg: num(p?.weight_kg, 75),
    body_fat_pct: optionalNum(p?.body_fat_pct),
    activity: num(p?.activity, 1.725),
    base_activity: Math.min(1.8, Math.max(1.05, num(p?.base_activity, 1.3))),
    energy_model: model,
    goal,
    pace: PACE_VALUES.includes(p?.pace) ? p.pace : "steady",
    protein_basis: (p?.protein_basis === "lean" ? "lean" : "bodyweight") as ProteinBasis,
    protein_per_kg: num(p?.protein_per_kg, def.protein.perKg),
    fat_per_kg: num(p?.fat_per_kg, def.fatPerKg),
    calibrated_tdee: optionalNum(p?.calibrated_tdee),
    use_calibration: p?.use_calibration === undefined ? false : !!p.use_calibration,
    // Clamped here as well as in the steer, because this is the boundary a
    // stored value crosses on its way back in — and an out-of-range one in the
    // database would otherwise quietly become an out-of-range calorie target.
    recomp_adjust: Math.max(-STEER_LIMIT, Math.min(STEER_LIMIT, num(p?.recomp_adjust, 0))),
    // On by default: the steer moving calories without moving fat means every
    // calorie it takes off lands on carbohydrate. See `shapeMacros`.
    adapt_macros: p?.adapt_macros !== false,
    calorie_override: optionalNum(p?.calorie_override),
    // The weekly snapshot. Absent on a new profile, which is why every target
    // falls back to weight_kg until shopping day has come round once.
    plan_weight_kg: optionalNum(p?.plan_weight_kg),
    plan_bf_pct: optionalNum(p?.plan_bf_pct),
    plan_bmr_kcal: optionalNum(p?.plan_bmr_kcal),
    plan_updated_on: isoDate(p?.plan_updated_on),
    auto_roll: p?.auto_roll === undefined ? true : !!p.auto_roll,
    // A body fat on your own scale, so 3–40% is the plausible range; anything
    // outside it is treated as "no target" rather than a target nobody meant.
    bf_target_pct: (() => {
      const v = optionalNum(p?.bf_target_pct);
      return v != null && v >= 3 && v <= 40 ? v : null;
    })(),
    bf_target_by: isoDate(p?.bf_target_by),
    events: normaliseEvents(p?.events),
    deficit_scale: Math.max(0, Math.min(1, num(p?.deficit_scale, 1))),
    pace_adjust: Math.max(-0.08, Math.min(0, num(p?.pace_adjust, 0))),
    next_pace_adjust:
      p?.next_pace_adjust == null ? null : Math.max(-0.08, Math.min(0, num(p.next_pace_adjust, 0))),
    next_deficit_scale:
      p?.next_deficit_scale == null ? null : Math.max(0, Math.min(1, num(p.next_deficit_scale, 1))),
    steer_moved_on: isoDate(p?.steer_moved_on),
    steer_last_step: num(p?.steer_last_step, 0),
    // Next week's decision. Server-written; a client echoing these back in a
    // PUT is ignored. See lib/review.ts.
    next_apply_on: isoDate(p?.next_apply_on),
    next_reviewed_on: isoDate(p?.next_reviewed_on),
    next_plan_weight_kg: optionalNum(p?.next_plan_weight_kg),
    next_plan_bf_pct: optionalNum(p?.next_plan_bf_pct),
    next_plan_bmr_kcal: optionalNum(p?.next_plan_bmr_kcal),
    next_recomp_adjust:
      p?.next_recomp_adjust == null || p.next_recomp_adjust === ""
        ? null
        : Math.max(-STEER_LIMIT, Math.min(STEER_LIMIT, num(p.next_recomp_adjust, 0))),
    next_review: reviewOf(p?.next_review),
    last_review: reviewOf(p?.last_review),
    periodise: p?.periodise === undefined ? true : !!p.periodise,
    cycling: p?.cycling === undefined ? true : !!p.cycling,
    week: normaliseWeek(p?.week_ids ?? p?.week),
    shop_days: Math.min(21, Math.max(1, Math.round(num(p?.shop_days, 7)))),
    shop_start_dow: Math.min(6, Math.max(0, Math.round(num(p?.shop_start_dow, 6)))),
    // Monday by default — you shop Saturday, cook Sunday, and start the new
    // plan Monday morning.
    plan_roll_dow: Math.min(6, Math.max(0, Math.round(num(p?.plan_roll_dow, 1)))),
  };
}

/** How many days you can buy for in one go, as offered in settings. */
export const SHOP_DAY_OPTIONS = [3, 4, 5, 6, 7, 10, 14];

export const DOW_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
