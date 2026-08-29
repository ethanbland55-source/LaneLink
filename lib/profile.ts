/**
 * One place that turns whatever the database (or an older version of the app)
 * hands back into a complete Profile. Both pages and the API route used to
 * keep their own copy of this and they had already drifted apart.
 */

import { WEEKDAYS, type EnergyModel, type Profile, type WeekMap, type Weekday } from "./nutrition";

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

export function normaliseProfile(p: any): Profile {
  const model: EnergyModel = p?.energy_model === "flat" ? "flat" : "sessions";
  return {
    sex: p?.sex === "female" ? "female" : "male",
    dob: p?.dob ? String(p.dob).slice(0, 10) : null,
    height_cm: num(p?.height_cm, 180),
    weight_kg: num(p?.weight_kg, 75),
    body_fat_pct: optionalNum(p?.body_fat_pct),
    activity: num(p?.activity, 1.725),
    base_activity: Math.min(1.8, Math.max(1.05, num(p?.base_activity, 1.3))),
    energy_model: model,
    goal:
      p?.goal === "bulk" ? "bulk" : p?.goal === "maintain" ? "maintain" : "cut",
    protein_per_kg: num(p?.protein_per_kg, 2),
    fat_per_kg: num(p?.fat_per_kg, 0.7),
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
