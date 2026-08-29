/**
 * Nutrition maths.
 *
 * The shape of a week is yours to describe. A **day type** is a name and a
 * list of training sessions — "Swim + gym", "Gym only", "Rest" — and you map
 * each weekday to one of them. Meals can be limited to particular day types,
 * so the carb top-up before a session simply isn't there on a rest day.
 *
 * Energy comes from those sessions rather than from one blanket activity
 * multiplier: a baseline for everything that isn't training, plus the measured
 * cost of what you actually did, net of the resting metabolism already counted
 * in the baseline.
 *
 * Whatever spread that produces, the seven-day average is scaled to land
 * exactly on your goal, so a heavy Saturday borrows from Sunday instead of
 * quietly becoming a surplus.
 */

import { profileFor } from "./foods";
import { normaliseSessions, sessionsKcal, type Session } from "./activities";

export type Goal = "cut" | "maintain" | "bulk";

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

/** Which day type each weekday uses, by id. */
export type WeekMap = Record<Weekday, number>;

export type DayType = {
  id: number;
  name: string;
  sort_order: number;
  sessions: Session[];
  /** Pin this day to a number of your own and opt it out of the maths. */
  fixed_kcal: number | null;
  /** A nudge on top of what the sessions say, e.g. +5% because you're always hungry Fridays. */
  percent: number | null;
};

/**
 * What a new account starts with. Named for the shape of a swim week because
 * that's the hardest case — a mix of pool and gym on the same day — but they
 * are only starting points and every one of them is editable.
 */
export const SEED_DAY_TYPES: { name: string; sessions: Session[] }[] = [
  { name: "Rest", sessions: [] },
  {
    name: "Gym only",
    sessions: [{ activity: "gym", level: "moderate", met: 5.0, minutes: 60 }],
  },
  {
    name: "Swim only",
    sessions: [{ activity: "swim", level: "moderate", met: 8.3, minutes: 90 }],
  },
  {
    name: "Swim + gym",
    sessions: [
      { activity: "swim", level: "moderate", met: 8.3, minutes: 90 },
      { activity: "gym", level: "moderate", met: 5.0, minutes: 45 },
    ],
  },
  {
    name: "Double swim",
    sessions: [
      { activity: "swim", level: "moderate", met: 8.3, minutes: 90 },
      { activity: "swim", level: "hard", met: 9.8, minutes: 75 },
    ],
  },
];

/** How the old four fixed types map onto the seeded ones when upgrading. */
export const LEGACY_DAY_TYPE_MAP: Record<string, string> = {
  rest: "Rest",
  easy: "Gym only",
  session: "Swim only",
  double: "Double swim",
};

export type EnergyModel = "sessions" | "flat";

export type Profile = {
  sex: "male" | "female";
  dob: string | null;
  height_cm: number;
  weight_kg: number;
  body_fat_pct: number | null;
  /** Legacy all-in-one multiplier, used only when energy_model is "flat". */
  activity: number;
  /** Everything that isn't a logged session. Used when energy_model is "sessions". */
  base_activity: number;
  energy_model: EnergyModel;
  goal: Goal;
  protein_per_kg: number;
  fat_per_kg: number;
  calorie_override: number | null;
  fibre_per_1000: number;
  carb_floor_per_kg: number;
  /** Off means one flat number every day, and the week grid is ignored. */
  cycling: boolean;
  week: WeekMap;
  shop_days: number;
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

/** Legacy single-multiplier levels, kept for the "flat" energy model. */
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

/** Everything that isn't a training session. */
export function baseline(p: Profile): number {
  return bmr(p) * (p.energy_model === "sessions" ? p.base_activity : p.activity);
}

/** What one day type costs before the week is balanced against your goal. */
export function dayTypeCost(p: Profile, dt: DayType): number {
  if (p.energy_model === "sessions") {
    return baseline(p) + sessionsKcal(p.weight_kg, dt.sessions);
  }
  return baseline(p) * (1 + (dt.percent ?? 0));
}

export type Targets = Macros & {
  dayTypeId: number;
  name: string;
  /** Raw energy cost of this kind of day, before balancing. */
  cost: number;
  sessionKcal: number;
  /** This day's calories relative to the weekly average. */
  multiplier: number;
  sessions: Session[];
};

export type WeekPlan = {
  byId: Record<number, Targets>;
  order: number[];
  week: WeekMap;
  bmr: number;
  method: string;
  baseline: number;
  /** Mean daily cost across the seven days you've mapped. */
  maintenance: number;
  /** The seven-day average you're aiming for. */
  goalKcal: number;
  /** What every non-pinned day was multiplied by to make the week balance. */
  balance: number;
  dayTypes: DayType[];
};

function macrosFor(p: Profile, kcal: number): Macros {
  const protein = p.protein_per_kg * p.weight_kg;
  let fat = p.fat_per_kg * p.weight_kg;
  const carbFloor = (p.carb_floor_per_kg ?? 1) * p.weight_kg;

  let carbs = (kcal - protein * 4 - fat * 9) / 4;

  // On a low day, protect carbohydrate before fat — you still have to train on
  // it. Fat gives way down to a hard 0.45 g/kg hormonal floor.
  if (carbs < carbFloor) {
    const fatFloor = 0.45 * p.weight_kg;
    const needed = (carbFloor - carbs) * 4;
    const giveable = Math.max(0, (fat - fatFloor) * 9);
    fat -= Math.min(needed, giveable) / 9;
    carbs = (kcal - protein * 4 - fat * 9) / 4;
  }

  return {
    kcal: Math.round(kcal),
    protein: Math.round(protein),
    carbs: Math.round(Math.max(0, carbs)),
    fat: Math.round(fat),
    fibre: Math.round(Math.max(25, (kcal / 1000) * (p.fibre_per_1000 ?? 14))),
  };
}

/**
 * Work out every day type's numbers at once.
 *
 * The balancing step is the important one. Each day type has a raw cost; days
 * you've pinned to a fixed number are taken out of the pot, and everything
 * else is scaled by a single factor chosen so that the seven mapped days
 * average out to your goal exactly. One factor for all of them, so the
 * relative shape of your week — the thing you actually described — survives.
 */
export function buildWeekPlan(p: Profile, dayTypes: DayType[]): WeekPlan {
  const types = [...dayTypes].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const fallbackId = types[0]?.id ?? 0;
  const week = {} as WeekMap;
  for (const d of WEEKDAYS) {
    const id = p.week?.[d];
    week[d] = types.some((t) => t.id === id) ? id : fallbackId;
  }

  const cost = new Map<number, number>();
  for (const t of types) cost.set(t.id, dayTypeCost(p, t));

  const used = WEEKDAYS.map((d) => types.find((t) => t.id === week[d])).filter(
    (t): t is DayType => !!t
  );
  const days = used.length || 1;

  const maintenance =
    used.reduce((a, t) => a + (cost.get(t.id) ?? 0), 0) / days ||
    (types.length ? cost.get(types[0].id) ?? baseline(p) : baseline(p));

  const goal = GOALS.find((g) => g.value === p.goal) ?? GOALS[1];
  const goalKcal =
    p.calorie_override != null && p.calorie_override > 0
      ? p.calorie_override
      : maintenance * (1 + goal.adjust);

  // Balance: pinned days come out of the weekly pot, the rest share what's left
  // in proportion to what they cost.
  let balance = 1;
  if (p.cycling) {
    let pinned = 0;
    let flexible = 0;
    for (const t of used) {
      if (t.fixed_kcal != null && t.fixed_kcal > 0) pinned += t.fixed_kcal;
      else flexible += cost.get(t.id) ?? 0;
    }
    const remaining = days * goalKcal - pinned;
    balance = flexible > 0 ? remaining / flexible : 1;
    // A balance outside this range means the week is dominated by pinned days;
    // clamp rather than serve someone 900 kcal because the maths said so.
    balance = Math.min(1.6, Math.max(0.5, balance));
  } else {
    balance = maintenance > 0 ? goalKcal / maintenance : 1;
  }

  const floor = bmr(p) * 1.05;
  const byId: Record<number, Targets> = {};
  for (const t of types) {
    const raw = cost.get(t.id) ?? baseline(p);
    let kcal: number;
    if (!p.cycling) kcal = goalKcal;
    else if (t.fixed_kcal != null && t.fixed_kcal > 0) kcal = t.fixed_kcal;
    else kcal = raw * balance;
    kcal = Math.max(floor, kcal);

    byId[t.id] = {
      ...macrosFor(p, kcal),
      dayTypeId: t.id,
      name: t.name,
      cost: Math.round(raw),
      sessionKcal: Math.round(sessionsKcal(p.weight_kg, t.sessions)),
      multiplier: goalKcal > 0 ? kcal / goalKcal : 1,
      sessions: t.sessions,
    };
  }

  return {
    byId,
    order: types.map((t) => t.id),
    week,
    bmr: Math.round(bmr(p)),
    method: bmrMethod(p),
    baseline: Math.round(baseline(p)),
    maintenance: Math.round(maintenance),
    goalKcal: Math.round(goalKcal),
    balance,
    dayTypes: types,
  };
}

export function weekdayOf(dayKeyStr: string): Weekday {
  const d = new Date(dayKeyStr + "T12:00:00");
  return WEEKDAYS[(d.getDay() + 6) % 7]; // getDay(): 0 = Sunday
}

/** Which day type a calendar day falls on. */
export function dayTypeIdFor(plan: WeekPlan, dayKeyStr: string): number {
  if (!plan.order.length) return 0;
  return plan.week[weekdayOf(dayKeyStr)] ?? plan.order[0];
}

export function targetsFor(plan: WeekPlan, dayTypeId: number): Targets {
  return (
    plan.byId[dayTypeId] ??
    plan.byId[plan.order[0]] ?? {
      ...ZERO_MACROS,
      dayTypeId: 0,
      name: "—",
      cost: 0,
      sessionKcal: 0,
      multiplier: 1,
      sessions: [],
    }
  );
}

export function normaliseDayType(raw: any, index = 0): DayType {
  const fixed = Number(raw?.fixed_kcal);
  const pct = Number(raw?.percent);
  return {
    id: Number(raw?.id) || 0,
    name: String(raw?.name ?? "Day type").slice(0, 40) || "Day type",
    sort_order: Number.isFinite(Number(raw?.sort_order)) ? Number(raw.sort_order) : index,
    sessions: normaliseSessions(raw?.sessions),
    fixed_kcal: Number.isFinite(fixed) && fixed > 0 ? Math.min(9000, fixed) : null,
    percent: Number.isFinite(pct) && Math.abs(pct) <= 0.5 ? pct : null,
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
  return isoDay(d);
}

export function addDays(dayKeyStr: string, n: number): string {
  const d = new Date(dayKeyStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

function isoDay(d: Date): string {
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
 * wrong — and every downstream number inherits that error.
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
  return (Number(i.grams) || 0) * profileFor(i.name, i).rawToCooked;
}
