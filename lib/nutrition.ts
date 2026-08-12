/**
 * Nutrition maths.
 *
 * BMR uses Mifflin-St Jeor — the same default formula calculator.net's BMR
 * calculator uses — then multiplies by the activity factor to get TDEE.
 * Macros follow the rule of thumb: protein fixed at ~2 g/kg, fat 0.6–0.8 g/kg,
 * carbs take whatever calories are left.
 */

export type Goal = "cut" | "maintain" | "bulk";

export type Profile = {
  sex: "male" | "female";
  dob: string | null;
  height_cm: number;
  weight_kg: number;
  activity: number;
  goal: Goal;
  protein_per_kg: number;
  fat_per_kg: number;
  calorie_override: number | null;
};

export type Macros = { kcal: number; protein: number; carbs: number; fat: number };

export const ACTIVITY_LEVELS = [
  { value: 1.2, label: "Sedentary", hint: "little or no exercise" },
  { value: 1.375, label: "Lightly active", hint: "1–3 sessions/week" },
  { value: 1.465, label: "Moderately active", hint: "4–5 sessions/week" },
  { value: 1.55, label: "Active", hint: "daily, or intense 3–4x/week" },
  { value: 1.725, label: "Very active", hint: "intense 6–7x/week" },
  { value: 1.9, label: "Extra active", hint: "twice-a-day training, physical job" },
];

export const GOALS: { value: Goal; label: string; adjust: number; blurb: string }[] = [
  { value: "cut", label: "Cutting", adjust: -0.2, blurb: "20% below maintenance" },
  { value: "maintain", label: "Maintaining", adjust: 0, blurb: "at maintenance" },
  { value: "bulk", label: "Bulking", adjust: 0.12, blurb: "12% above maintenance" },
];

export function ageFromDob(dob: string | null | undefined): number {
  if (!dob) return 25;
  const b = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return Math.max(1, age);
}

/** Mifflin-St Jeor. */
export function bmr(p: Profile): number {
  const age = ageFromDob(p.dob);
  const base = 10 * p.weight_kg + 6.25 * p.height_cm - 5 * age;
  return p.sex === "female" ? base - 161 : base + 5;
}

export function tdee(p: Profile): number {
  return bmr(p) * p.activity;
}

/** The daily target: kcal plus the protein/fat/carb split. */
export function targets(p: Profile): Macros & { maintenance: number; bmr: number } {
  const maintenance = tdee(p);
  const goal = GOALS.find((g) => g.value === p.goal) ?? GOALS[1];
  const kcal = p.calorie_override ?? maintenance * (1 + goal.adjust);

  const protein = p.protein_per_kg * p.weight_kg;
  const fat = p.fat_per_kg * p.weight_kg;
  const carbs = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);

  return {
    kcal: Math.round(kcal),
    protein: Math.round(protein),
    fat: Math.round(fat),
    carbs: Math.round(carbs),
    maintenance: Math.round(maintenance),
    bmr: Math.round(bmr(p)),
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

export type Item = {
  name: string;
  grams: number;
  kcal_100: number;
  protein_100: number;
  carbs_100: number;
  fat_100: number;
};

export function itemMacros(i: Item): Macros {
  const f = (Number(i.grams) || 0) / 100;
  return {
    kcal: (Number(i.kcal_100) || 0) * f,
    protein: (Number(i.protein_100) || 0) * f,
    carbs: (Number(i.carbs_100) || 0) * f,
    fat: (Number(i.fat_100) || 0) * f,
  };
}

export function sumMacros(list: Macros[]): Macros {
  return list.reduce(
    (a, m) => ({
      kcal: a.kcal + m.kcal,
      protein: a.protein + m.protein,
      carbs: a.carbs + m.carbs,
      fat: a.fat + m.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

export function totalFor(items: Item[]): Macros {
  return sumMacros(items.map(itemMacros));
}
