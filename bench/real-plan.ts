/**
 * Ethan's actual plan, pulled from the live database on 30 Aug 2026,
 * kept in step with it since. Last refreshed 4 Sep 2026.
 *
 * Kept as a fixture so changes to the solver can be judged against the plan
 * they are actually for, rather than only against randomised ones. The shape
 * of it is the point: three meals every day, two more on any day with a swim,
 * one more on any day with a gym session — and only three kinds of day, which
 * is all he actually has.
 *
 * The portions are next week's: the set staged for roll day, which is the one
 * the benches should be judging.
 */

import type { DayType, Profile } from "../lib/nutrition";
import type { PlanMeal } from "../lib/batch";

export const REAL_DAY_TYPES: DayType[] = [
  { id: 1, name: "Rest", sort_order: 0, sessions: [], fixed_kcal: null, percent: null },
  {
    id: 3,
    name: "Swim only",
    sort_order: 2,
    sessions: [{ activity: "swim", level: "moderate", met: 8.3, minutes: 90 }],
    fixed_kcal: null,
    percent: null,
  },
  {
    id: 4,
    name: "Swim + gym",
    sort_order: 3,
    sessions: [
      { activity: "swim", level: "moderate", met: 8.3, minutes: 90 },
      { activity: "gym", level: "moderate", met: 5, minutes: 45 },
    ],
    fixed_kcal: null,
    percent: null,
  },
];

export const REAL_PROFILE: Profile = {
  sex: "male",
  dob: "2005-04-26",
  height_cm: 182.88,
  weight_kg: 78.35,
  body_fat_pct: null,
  bf_source: "tape",
  neck_cm: 36.5,
  hip_cm: null,
  waist_cm: 78.746,
  activity: 1.725,
  base_activity: 1.25,
  energy_model: "sessions",
  goal: "recomp",
  protein_basis: "lean",
  protein_per_kg: 2.45,
  fat_per_kg: 0.91,
  phase_name: "Lean gain to December",
  phase_start: "2026-09-04",
  phase_weeks: 15,
  phase_start_adjust: -0.01,
  phase_end_adjust: 0.08,
  calibrated_tdee: null,
  use_calibration: false,
  calorie_override: null,
  carb_floor_per_kg: 1,
  cycling: true,
  plan_weight_kg: 77,
  plan_bf_pct: 12.8,
  plan_updated_on: "2026-08-31",
  auto_roll: true,
  periodise: true,
  week: { mon: 4, tue: 3, wed: 3, thu: 4, fri: 3, sat: 4, sun: 1 },
  shop_days: 7,
  shop_start_dow: 6,
  plan_roll_dow: 1,
};

const ing = (
  name: string,
  grams: number,
  kcal_100: number,
  protein_100: number,
  carbs_100: number,
  fat_100: number,
  min_grams: number | null = null,
  max_grams: number | null = null,
  locked = false,
  prepped = false
) => ({
  name,
  grams,
  kcal_100,
  protein_100,
  carbs_100,
  fat_100,
  min_grams,
  max_grams,
  locked,
  prepped,
});

export const REAL_MEALS: PlanMeal[] = [
  {
    id: 1,
    name: "Breakfast",
    times_per_day: 1,
    day_type_ids: null,
    batch: false,
    ingredients: [
      ing("Rice Cakes", 63, 394, 8.5, 82.3, 2.8, 60, 68),
      ing("Banana", 105, 89, 1.1, 22.8, 0.3, 105, 105),
      ing("Honey", 46, 325, 0, 81.2, 0, 30, 46),
      ing("Milk", 250, 50, 3.6, 4.8, 1.8, 250, 350),
      ing("Protein Powder", 26, 394, 72, 11.5, 6.1, 24, 26),
    ],
  },
  {
    // Weighed, cooked and stirred together on prep night, then split six ways.
    // The sweetcorn and the mayonnaise go in on the day, so they still move.
    id: 2,
    name: "Lunch",
    times_per_day: 1,
    day_type_ids: null,
    batch: false,
    ingredients: [
      ing("Pasta", 190, 157, 5.8, 32, 0.5, 190, 225, false, true),
      ing("Tuna", 112, 109, 24.9, 0, 1, 112, 224, false, true),
      ing("Mayonnaise", 45, 696, 1.1, 1.7, 76, 30, 46),
      ing("Sweetcorn", 72, 77, 2.6, 11.5, 1.7, 72, 80),
    ],
  },
  {
    id: 3,
    name: "Pre Swim",
    times_per_day: 1,
    day_type_ids: [3, 4],
    share_pct: 30,
    batch: false,
    ingredients: [ing("Dates", 74, 265, 2.4, 58.7, 0.6, 45, 75)],
  },
  {
    id: 4,
    name: "Post Swim",
    times_per_day: 1,
    day_type_ids: [3, 4],
    share_pct: 70,
    batch: false,
    ingredients: [
      ing("Greek Yohurt", 390, 60, 6.1, 7.7, 0.4, 390, 430),
      ing("Protein Grenola", 95, 461, 17.9, 55, 17.3, 95, 115),
      ing("Honey", 18, 325, 0, 81.2, 0, 17, 26),
    ],
  },
  {
    id: 5,
    name: "Post Gym",
    times_per_day: 1,
    day_type_ids: [4],
    batch: false,
    ingredients: [
      ing("Bagel", 43, 263, 9.2, 50.9, 1.8, 43, 43),
      ing("Peanut Butter", 20, 652, 25.4, 17.3, 52.1, 20, 28),
    ],
  },
  {
    id: 6,
    name: "Dinner",
    times_per_day: 1,
    day_type_ids: null,
    batch: false,
    ingredients: [
      ing("Chicken Breast", 190, 106, 24, 0, 1.1, 190, 265, false, true),
      ing("White Rice", 120, 369, 8.1, 83.7, 0.5, 110, 180, false, true),
      ing("Sweetcorn", 72, 77, 2.6, 11.5, 1.7, 72, 80),
    ],
  },
];
