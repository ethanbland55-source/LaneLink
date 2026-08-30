/**
 * Ethan's actual plan, pulled from the live database on 30 Aug 2026.
 *
 * Kept as a fixture so changes to the solver can be judged against the plan
 * they are actually for, rather than only against randomised ones. The shape
 * of it is the point: three meals every day, two more on any day with a swim,
 * one more on any day with a gym session.
 */

import type { DayType, Profile } from "../lib/nutrition";
import type { PlanMeal } from "../lib/batch";

export const REAL_DAY_TYPES: DayType[] = [
  { id: 1, name: "Rest", sort_order: 0, sessions: [], fixed_kcal: null, percent: null },
  {
    id: 2,
    name: "Gym only",
    sort_order: 1,
    sessions: [{ activity: "gym", level: "moderate", met: 5, minutes: 60 }],
    fixed_kcal: null,
    percent: null,
  },
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
  {
    id: 5,
    name: "Double swim",
    sort_order: 4,
    sessions: [
      { activity: "swim", level: "moderate", met: 8.3, minutes: 90 },
      { activity: "swim", level: "hard", met: 9.8, minutes: 75 },
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
  bf_source: "none",
  neck_cm: null,
  hip_cm: null,
  waist_cm: null,
  activity: 1.725,
  base_activity: 1.25,
  energy_model: "sessions",
  goal: "recomp",
  protein_basis: "bodyweight",
  protein_per_kg: 2.8,
  fat_per_kg: 0.8,
  phase_name: "Toned maintenance",
  phase_start: "2026-08-31",
  phase_weeks: 15,
  phase_start_adjust: 0,
  phase_end_adjust: -0.08,
  calibrated_tdee: null,
  use_calibration: false,
  calorie_override: 3100,
  carb_floor_per_kg: 1,
  cycling: true,
  plan_weight_kg: null,
  plan_bf_pct: null,
  plan_updated_on: null,
  auto_roll: true,
  week: { mon: 4, tue: 3, wed: 3, thu: 4, fri: 3, sat: 4, sun: 1 },
  shop_days: 7,
  shop_start_dow: 6,
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
  locked = false
) => ({ name, grams, kcal_100, protein_100, carbs_100, fat_100, min_grams, max_grams, locked });

export const REAL_MEALS: PlanMeal[] = [
  {
    id: 1,
    name: "Breakfast",
    times_per_day: 1,
    day_type_ids: null,
    batch: false,
    ingredients: [
      ing("Rice Cakes", 40, 394, 8.5, 82.3, 2.8, 37),
      ing("Banana", 105, 89, 1.1, 22.8, 0.3, 78),
      ing("Honey", 16, 325, 0, 81.2, 0),
      ing("Milk", 275, 50, 3.6, 4.8, 1.8, null, null, true),
      ing("Protein Powder", 33, 394, 72, 11.5, 6.1, null, null, true),
    ],
  },
  {
    id: 2,
    name: "Lunch",
    times_per_day: 1,
    day_type_ids: null,
    batch: false,
    ingredients: [
      ing("Pasta", 225, 157, 5.8, 32, 0.5, null, 293),
      ing("Tuna", 336, 109, 24.9, 0, 1, null, 356),
      ing("Mayonnaise", 56, 696, 1.1, 1.7, 76, null, 57),
      ing("Sweetcorn", 110, 77, 2.6, 11.5, 1.7),
    ],
  },
  {
    id: 3,
    name: "Pre Swim",
    times_per_day: 1,
    day_type_ids: [3, 4, 5],
    batch: false,
    ingredients: [ing("Dates", 150, 265, 2.4, 58.7, 0.6, 100, 150)],
  },
  {
    id: 4,
    name: "Post Swim",
    times_per_day: 1,
    day_type_ids: [3, 4, 5],
    batch: false,
    ingredients: [
      ing("Greek Yohurt", 450, 60, 6.1, 7.7, 0.4, 350, 450),
      ing("Protein Grenola", 90, 461, 17.9, 55, 17.3, 65, 150),
      ing("Honey", 20, 325, 0, 81.2, 0, 10, 20),
    ],
  },
  {
    id: 5,
    name: "Post Gym",
    times_per_day: 1,
    day_type_ids: [2, 4],
    batch: false,
    ingredients: [
      ing("Bagel", 90, 263, 9.2, 50.9, 1.8, 90, 90),
      ing("Peanut Butter", 12, 652, 25.4, 17.3, 52.1, 12, 20),
    ],
  },
  {
    id: 6,
    name: "Dinner",
    times_per_day: 1,
    day_type_ids: null,
    batch: false,
    ingredients: [
      ing("Chicken Breast", 313, 106, 24, 0, 1.1, null, 313),
      ing("White Rice", 22, 369, 8.1, 83.7, 0.5, 21),
      ing("Sweetcorn", 110, 77, 2.6, 11.5, 1.7),
    ],
  },
];
