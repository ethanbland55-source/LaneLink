/**
 * Nutrition maths.
 *
 * Three things changed here over the first version:
 *
 *  1. **BMR** uses Katch-McArdle when you know your body fat percentage
 *     (it works off lean mass, which is the thing that actually burns the
 *     calories) and falls back to Mifflin-St Jeor when you don't.
 *  2. **Day types.** A swim week isn't flat. You can label each weekday as
 *     rest / easy / session / double and each gets its own calorie and carb
 *     number — but the adjustments are *normalised across the week*, so the
 *     seven-day average still lands exactly on your goal. Eating more on a
 *     double day doesn't quietly turn a maintenance phase into a surplus.
 *  3. **Fibre** is tracked as a fifth number, because it's the one that
 *     decides whether a day's food actually fills you up.
 */

import { profileFor } from "./foods";

export type Goal = "cut" | "maintain" | "bulk";

export type DayType = "rest" | "easy" | "session" | "double";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

export const DAY_TYPES: { value: DayType; label: string; hint: string }[] = [
  { value: "rest", label: "Rest", hint: "no training" },
  { value: "easy", label: "Easy", hint: "gym or a light swim" },
  { value: "session", label: "Session", hint: "one full swim set" },
  { value: "double", label: "Double", hint: "two sessions, or swim + gym" },
];

export type DayAdjust = Record<DayType, number>;

/** Sensible starting spread for an in-season swimmer. */
export const DEFAULT_DAY_ADJUST: DayAdjust = {
  rest: -0.12,
  easy: -0.04,
  session: 0.05,
  double: 0.16,
};

export const DEFAULT_WEEK: Record<Weekday, DayType> = {
  mon: "session",
  tue: "session",
  wed: "easy",
  thu: "session",
  fri: "easy",
  sat: "double",
  sun: "rest",
};

export type Profile = {
  sex: "male" | "female";
  dob: string | null;
  height_cm: number;
  weight_kg: number;
  body_fat_pct: number | null;
  activity: number;
  goal: Goal;
  protein_per_kg: number;
  fat_per_kg: number;
  calorie_override: number | null;
  /** g of fibre per 1000 kcal. 14 is the standard recommendation. */
  fibre_per_1000: number;
  /** Never let carbs fall below this many g/kg, even on a rest day. */
  carb_floor_per_kg: number;
  cycling: boolean;
  day_adjust: DayAdjust;
  week: Record<Weekday, DayType>;
  /** How many days of food you buy in one shop. */
  shop_days: number;
  /** Day of week you shop on. 0 = Sunday … 6 = Saturday. */
  shop_start_dow: number;
};

export type Macros = {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
};

export const ZERO_MACROS: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 };

export const ACTIVITY_LEVELS = [
  { value: 1.2, label: "Sedentary", hint: "desk job, no training" },
  { value: 1.375, label: "Lightly active", hint: "1–3 sessions/week" },
  { value: 1.465, label: "Moderately active", hint: "4–5 sessions/week" },
  { value: 1.55, label: "Active", hint: "daily, or intense 3–4x/week" },
  { value: 1.725, label: "Very active", hint: "intense 6–7x/week" },
  { value: 1.9, label: "Extra active", hint: "twice-a-day training" },
];

export const GOALS: { value: Goal; label: string; adjust: number; blurb: string }[] = [
  { value: "cut", label: "Cutting", adjust: -0.2, blurb: "20% below maintenance" },
  { value: "maintain", label: "Maintaining", adjust: 0, blurb: "at maintenance" },
  { value: "bulk", label: "Bulking", adjust: 0.12, blurb: "12% above maintenance" },
];

/** MET values for the sessions a swimmer actually does. */
export const METS = { swim_easy: 5.8, swim_hard: 9.8, gym: 5.0, run: 9.0 };

/**
 * Rough energy cost of a session: MET × 3.5 × kg / 200 kcal per minute.
 * Used only as a hint when choosing your day-type percentages.
 */
export function sessionKcal(weightKg: number, minutes: number, met: number): number {
  return Math.round(((met * 3.5 * weightKg) / 200) * minutes);
}

export function ageFromDob(dob: string | null | undefined): number {
  if (!dob) return 25;
  const b = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return Math.max(1, age);
}

/** Lean body mass, when body fat is known. */
export function leanMass(p: Profile): number | null {
  if (p.body_fat_pct == null || p.body_fat_pct <= 0 || p.body_fat_pct >= 60) return null;
  return p.weight_kg * (1 - p.body_fat_pct / 100);
}

/** Katch-McArdle if we know lean mass, otherwise Mifflin-St Jeor. */
export function bmr(p: Profile): number {
  const lbm = leanMass(p);
  if (lbm != null) return 370 + 21.6 * lbm;
  const age = ageFromDob(p.dob);
  const base = 10 * p.weight_kg + 6.25 * p.height_cm - 5 * age;
  return p.sex === "female" ? base - 161 : base + 5;
}

export function bmrMethod(p: Profile): "Katch-McArdle" | "Mifflin-St Jeor" {
  return leanMass(p) != null ? "Katch-McArdle" : "Mifflin-St Jeor";
}

export function tdee(p: Profile): number {
  return bmr(p) * p.activity;
}

/** The seven-day average calorie number, before any day-type shuffling. */
export function baseKcal(p: Profile): number {
  if (p.calorie_override != null && p.calorie_override > 0) return p.calorie_override;
  const goal = GOALS.find((g) => g.value === p.goal) ?? GOALS[1];
  return tdee(p) * (1 + goal.adjust);
}

/**
 * Day multipliers, normalised so the week averages out to exactly 1.
 *
 * If your week is 3 sessions, 2 easy, 1 double and 1 rest, the raw
 * percentages don't average to zero — so we divide them all by the week's
 * mean. The hard days stay relatively harder, the total stays honest.
 */
export function dayMultipliers(p: Profile): Record<DayType, number> {
  const adj = p.day_adjust ?? DEFAULT_DAY_ADJUST;
  const raw: Record<DayType, number> = {
    rest: 1 + (adj.rest ?? 0),
    easy: 1 + (adj.easy ?? 0),
    session: 1 + (adj.session ?? 0),
    double: 1 + (adj.double ?? 0),
  };
  if (!p.cycling) return { rest: 1, easy: 1, session: 1, double: 1 };

  const week = p.week ?? DEFAULT_WEEK;
  let sum = 0;
  for (const d of WEEKDAYS) sum += raw[week[d] ?? "session"] ?? 1;
  const mean = sum / WEEKDAYS.length || 1;

  return {
    rest: raw.rest / mean,
    easy: raw.easy / mean,
    session: raw.session / mean,
    double: raw.double / mean,
  };
}

export function weekdayOf(dayKeyStr: string): Weekday {
  const d = new Date(dayKeyStr + "T12:00:00");
  // getDay(): 0 = Sunday
  return WEEKDAYS[(d.getDay() + 6) % 7];
}

export function dayTypeFor(p: Profile, dayKeyStr: string): DayType {
  if (!p.cycling) return "session";
  const week = p.week ?? DEFAULT_WEEK;
  return week[weekdayOf(dayKeyStr)] ?? "session";
}

export type Targets = Macros & {
  maintenance: number;
  bmr: number;
  /** The flat seven-day average, for comparison. */
  base: number;
  dayType: DayType;
  multiplier: number;
  method: string;
};

/**
 * The day's target. Protein is fixed, fat is fixed at your g/kg unless carbs
 * would otherwise fall through the floor, and carbs take the rest — so a
 * double day shows up almost entirely as extra carbohydrate, which is what
 * you actually want it to be.
 */
export function targets(p: Profile, dayType: DayType = "session"): Targets {
  const maintenance = tdee(p);
  const base = baseKcal(p);
  const mult = dayMultipliers(p)[dayType] ?? 1;
  const kcal = base * mult;

  const protein = p.protein_per_kg * p.weight_kg;
  let fat = p.fat_per_kg * p.weight_kg;
  const carbFloor = (p.carb_floor_per_kg ?? 1) * p.weight_kg;

  let carbs = (kcal - protein * 4 - fat * 9) / 4;

  // On a low day, protect carbohydrate before fat — you still have to train
  // on it. Fat gives way down to a hard 0.45 g/kg hormonal floor.
  if (carbs < carbFloor) {
    const fatFloor = 0.45 * p.weight_kg;
    const needed = (carbFloor - carbs) * 4;
    const giveable = Math.max(0, (fat - fatFloor) * 9);
    const take = Math.min(needed, giveable);
    fat -= take / 9;
    carbs = (kcal - protein * 4 - fat * 9) / 4;
  }
  carbs = Math.max(0, carbs);

  const fibre = Math.max(25, (kcal / 1000) * (p.fibre_per_1000 ?? 14));

  return {
    kcal: Math.round(kcal),
    protein: Math.round(protein),
    fat: Math.round(fat),
    carbs: Math.round(carbs),
    fibre: Math.round(fibre),
    maintenance: Math.round(maintenance),
    bmr: Math.round(bmr(p)),
    base: Math.round(base),
    dayType,
    multiplier: mult,
    method: bmrMethod(p),
  };
}

/** Every day type at once — used by the plan page and the shopping maths. */
export function allDayTargets(p: Profile): Record<DayType, Targets> {
  return {
    rest: targets(p, "rest"),
    easy: targets(p, "easy"),
    session: targets(p, "session"),
    double: targets(p, "double"),
  };
}

/**
 * The logging day rolls over at 03:00 local time, so anything eaten late at
 * night still counts toward the day you think of it as.
 */
export const DAY_ROLLOVER_HOUR = 3;

export function dayKey(at: Date = new Date()): string {
  const d = new Date(at);
  d.setHours(d.getHours() - DAY_ROLLOVER_HOUR);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(dayKeyStr: string, n: number): string {
  const d = new Date(dayKeyStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type Item = {
  name: string;
  grams: number;
  kcal_100: number;
  protein_100: number;
  carbs_100: number;
  fat_100: number;
  fibre_100?: number;
};

export function itemMacros(i: Item): Macros {
  const f = (Number(i.grams) || 0) / 100;
  return {
    kcal: (Number(i.kcal_100) || 0) * f,
    protein: (Number(i.protein_100) || 0) * f,
    carbs: (Number(i.carbs_100) || 0) * f,
    fat: (Number(i.fat_100) || 0) * f,
    fibre: (Number(i.fibre_100) || 0) * f,
  };
}

export function sumMacros(list: Macros[]): Macros {
  return list.reduce(
    (a, m) => ({
      kcal: a.kcal + m.kcal,
      protein: a.protein + m.protein,
      carbs: a.carbs + m.carbs,
      fat: a.fat + m.fat,
      fibre: a.fibre + (m.fibre || 0),
    }),
    { ...ZERO_MACROS }
  );
}

export function scaleMacros(m: Macros, k: number): Macros {
  return {
    kcal: m.kcal * k,
    protein: m.protein * k,
    carbs: m.carbs * k,
    fat: m.fat * k,
    fibre: (m.fibre || 0) * k,
  };
}

export function totalFor(items: Item[]): Macros {
  return sumMacros(items.map(itemMacros));
}

/**
 * A sanity check on the per-100g numbers themselves: 4/4/9 should reconstruct
 * the calorie figure. If it's more than 12% out, the label was probably typed
 * wrong — and every downstream number inherits that error, so it's worth
 * saying so.
 */
export function macroConsistency(i: Item): { ok: boolean; implied: number; stated: number } {
  const implied =
    (Number(i.protein_100) || 0) * 4 + (Number(i.carbs_100) || 0) * 4 + (Number(i.fat_100) || 0) * 9;
  const stated = Number(i.kcal_100) || 0;
  if (stated <= 0) return { ok: true, implied, stated };
  return { ok: Math.abs(implied - stated) <= Math.max(12, stated * 0.12), implied, stated };
}

/** Cooked weight of a raw ingredient, from the food knowledge base. */
export function cookedGrams(i: Item): number {
  const p = profileFor(i.name, i);
  return (Number(i.grams) || 0) * p.rawToCooked;
}
