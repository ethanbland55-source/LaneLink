/**
 * One place that turns whatever the database (or an older version of the app)
 * hands back into a complete Profile. Both pages and the API route used to
 * keep their own copy of this and they had already drifted apart.
 */

import {
  DEFAULT_DAY_ADJUST,
  DEFAULT_WEEK,
  WEEKDAYS,
  type DayAdjust,
  type DayType,
  type Profile,
  type Weekday,
} from "./nutrition";

const DAY_TYPE_VALUES: DayType[] = ["rest", "easy", "session", "double"];

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function optionalNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function normaliseWeek(raw: unknown): Record<Weekday, DayType> {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_WEEK };
  for (const d of WEEKDAYS) {
    const v = src[d];
    if (typeof v === "string" && (DAY_TYPE_VALUES as string[]).includes(v)) {
      out[d] = v as DayType;
    }
  }
  return out;
}

export function normaliseDayAdjust(raw: unknown): DayAdjust {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_DAY_ADJUST };
  for (const k of DAY_TYPE_VALUES) {
    const n = Number(src[k]);
    // Anything beyond ±40% is a typo, not a training day.
    if (Number.isFinite(n) && Math.abs(n) <= 0.4) out[k] = n;
  }
  return out;
}

export function normaliseProfile(p: any): Profile {
  return {
    sex: p?.sex === "female" ? "female" : "male",
    dob: p?.dob ? String(p.dob).slice(0, 10) : null,
    height_cm: num(p?.height_cm, 180),
    weight_kg: num(p?.weight_kg, 75),
    body_fat_pct: optionalNum(p?.body_fat_pct),
    activity: num(p?.activity, 1.725),
    goal: p?.goal === "cut" || p?.goal === "bulk" ? p.goal : p?.goal === "maintain" ? "maintain" : "cut",
    protein_per_kg: num(p?.protein_per_kg, 2),
    fat_per_kg: num(p?.fat_per_kg, 0.7),
    calorie_override: optionalNum(p?.calorie_override),
    fibre_per_1000: num(p?.fibre_per_1000, 14),
    carb_floor_per_kg: num(p?.carb_floor_per_kg, 1),
    cycling: !!p?.cycling,
    day_adjust: normaliseDayAdjust(p?.day_adjust),
    week: normaliseWeek(p?.week),
    shop_days: Math.min(21, Math.max(1, Math.round(num(p?.shop_days, 7)))),
    shop_start_dow: Math.min(6, Math.max(0, Math.round(num(p?.shop_start_dow, 6)))),
  };
}

/** How many days you can buy for in one go, as offered in settings. */
export const SHOP_DAY_OPTIONS = [3, 4, 5, 6, 7, 10, 14];

export const DOW_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
