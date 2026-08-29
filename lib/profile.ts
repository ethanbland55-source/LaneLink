/**
 * One place that turns whatever the database (or an older version of the app)
 * hands back into a complete Profile. Both pages and the API route used to
 * keep their own copy of this and they had already drifted apart.
 */

import {
  WEEKDAYS,
  goalDef,
  type EnergyModel,
  type Goal,
  type Profile,
  type ProteinBasis,
  type WeekMap,
  type Weekday,
} from "./nutrition";

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

export function normaliseProfile(p: any): Profile {
  const model: EnergyModel = p?.energy_model === "flat" ? "flat" : "sessions";
  const goal: Goal = GOAL_VALUES.includes(p?.goal) ? p.goal : "maintain";
  const def = goalDef(goal);

  // An adjustment outside ±40% is a typo, not a phase. Falling back to the
  // goal's own shape also means a profile written before phases existed comes
  // out behaving exactly as it did.
  const adj = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && Math.abs(n) <= 0.4 ? n : fallback;
  };

  return {
    sex: p?.sex === "female" ? "female" : "male",
    dob: p?.dob ? String(p.dob).slice(0, 10) : null,
    height_cm: num(p?.height_cm, 180),
    weight_kg: num(p?.weight_kg, 75),
    body_fat_pct: optionalNum(p?.body_fat_pct),
    activity: num(p?.activity, 1.725),
    base_activity: Math.min(1.8, Math.max(1.05, num(p?.base_activity, 1.3))),
    energy_model: model,
    goal,
    protein_basis: (p?.protein_basis === "lean" ? "lean" : "bodyweight") as ProteinBasis,
    protein_per_kg: num(p?.protein_per_kg, def.protein.perKg),
    fat_per_kg: num(p?.fat_per_kg, def.fatPerKg),
    phase_name: String(p?.phase_name ?? "").slice(0, 60),
    phase_start: p?.phase_start ? String(p.phase_start).slice(0, 10) : null,
    phase_weeks: Math.min(52, Math.max(0, Math.round(num(p?.phase_weeks, 0)))),
    phase_start_adjust: adj(p?.phase_start_adjust, def.start),
    phase_end_adjust: adj(p?.phase_end_adjust, def.end),
    calibrated_tdee: optionalNum(p?.calibrated_tdee),
    use_calibration: p?.use_calibration === undefined ? false : !!p.use_calibration,
    calorie_override: optionalNum(p?.calorie_override),
    fibre_per_1000: num(p?.fibre_per_1000, 14),
    carb_floor_per_kg: num(p?.carb_floor_per_kg, 1),
    cycling: p?.cycling === undefined ? true : !!p.cycling,
    week: normaliseWeek(p?.week_ids ?? p?.week),
    shop_days: Math.min(21, Math.max(1, Math.round(num(p?.shop_days, 7)))),
    shop_start_dow: Math.min(6, Math.max(0, Math.round(num(p?.shop_start_dow, 6)))),
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
