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
import { assumedBodyFat, navyBodyFat, type BfEstimate } from "./bodyfat";
import { carbBandFor, type CarbBand } from "./evidence";

export type Goal = "cut" | "maintain" | "recomp" | "bulk";

/** Whether protein is scaled by total bodyweight or by lean mass. */
export type ProteinBasis = "bodyweight" | "lean";

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
  /** Where the body fat figure comes from: typed in, from the tape, or nowhere. */
  bf_source: "none" | "manual" | "tape";
  /** One-off tape measurements for the Navy estimate. */
  neck_cm: number | null;
  hip_cm: number | null;
  /** Most recent waist reading, kept here so the estimate stays current. */
  waist_cm: number | null;
  /** Legacy all-in-one multiplier, used only when energy_model is "flat". */
  activity: number;
  /** Everything that isn't a logged session. Used when energy_model is "sessions". */
  base_activity: number;
  energy_model: EnergyModel;
  goal: Goal;
  protein_basis: ProteinBasis;
  protein_per_kg: number;
  fat_per_kg: number;
  /** A named block of training with a start, a length and a drifting target. */
  phase_name: string;
  phase_start: string | null;
  /** 0 means open-ended: the starting adjustment simply holds. */
  phase_weeks: number;
  phase_start_adjust: number;
  phase_end_adjust: number;
  /** Expenditure worked out from your own intake and weight trend. */
  calibrated_tdee: number | null;
  use_calibration: boolean;
  calorie_override: number | null;
  carb_floor_per_kg: number;
  /**
   * The figures this week's targets are built on, snapshotted on shopping day.
   * Separate from weight_kg on purpose: the plan must not move under you every
   * time you stand on the scale. See lib/weekly.ts.
   */
  plan_weight_kg: number | null;
  plan_bf_pct: number | null;
  plan_updated_on: string | null;
  /** Whether shopping day rebuilds the plan by itself. */
  auto_roll: boolean;
  /** Lean protein and fat toward the days with training in them. */
  periodise: boolean;
  /** Off means one flat number every day, and the week grid is ignored. */
  cycling: boolean;
  week: WeekMap;
  shop_days: number;
  shop_start_dow: number;
  /**
   * The weekday the plan itself rolls over on, 0 = Sunday. Separate from
   * shopping day on purpose: you shop Saturday for food you start eating
   * Monday, and the days in between are still running on the old plan.
   */
  plan_roll_dow: number;
};

export type Macros = {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
};

export const ZERO_MACROS: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

/** Legacy single-multiplier levels, kept for the "flat" energy model. */
export const ACTIVITY_LEVELS = [
  { value: 1.2, label: "Sedentary", hint: "desk job, no training" },
  { value: 1.375, label: "Lightly active", hint: "1–3 sessions/week" },
  { value: 1.465, label: "Moderately active", hint: "4–5 sessions/week" },
  { value: 1.55, label: "Active", hint: "daily, or intense 3–4x/week" },
  { value: 1.725, label: "Very active", hint: "intense 6–7x/week" },
  { value: 1.9, label: "Extra active", hint: "twice-a-day training" },
];

/**
 * A goal is really a *shape over time*, not a single percentage. Each one sets
 * where the phase starts and where it ends up; a phase with a length walks
 * between the two.
 */
export const GOALS: {
  value: Goal;
  label: string;
  start: number;
  end: number;
  protein: { basis: ProteinBasis; perKg: number };
  fatPerKg: number;
  blurb: string;
}[] = [
  {
    value: "cut",
    label: "Cutting",
    start: -0.2,
    end: -0.2,
    protein: { basis: "bodyweight", perKg: 2.2 },
    fatPerKg: 0.7,
    blurb: "20% below maintenance throughout",
  },
  {
    value: "maintain",
    label: "Maintaining",
    start: 0,
    end: 0,
    protein: { basis: "bodyweight", perKg: 2.0 },
    fatPerKg: 0.8,
    blurb: "at maintenance",
  },
  {
    value: "recomp",
    label: "Toned maintenance",
    start: 0,
    end: -0.08,
    protein: { basis: "lean", perKg: 2.8 },
    fatPerKg: 0.8,
    blurb: "starts at maintenance and drifts gently under, protein by lean mass",
  },
  {
    value: "bulk",
    label: "Bulking",
    start: 0.12,
    end: 0.12,
    protein: { basis: "bodyweight", perKg: 1.8 },
    fatPerKg: 0.8,
    blurb: "12% above maintenance",
  },
];

export function goalDef(g: Goal) {
  return GOALS.find((x) => x.value === g) ?? GOALS[1];
}

/**
 * Per-meal protein dose that actually does something.
 *
 * Below roughly 0.4 g/kg in a sitting you don't clear the leucine threshold
 * that switches on muscle protein synthesis, so the protein is used but the
 * signal isn't sent. Four or five doses a day, one of them near training and
 * one before sleep, is the pattern the physique-nutrition literature settles
 * on.
 */
export const PROTEIN_PER_MEAL_G_PER_KG = 0.4;
export const PROTEIN_DOSES_TARGET = 4;

export function ageFromDob(dob: string | null | undefined): number {
  if (!dob) return 25;
  const b = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return Math.max(1, age);
}

/* ------------------------------------------------------------------ */
/* Phase                                                               */
/* ------------------------------------------------------------------ */

export type Phase = {
  name: string;
  /** 0 at the start of the block, 1 at the end. Null when open-ended. */
  progress: number | null;
  week: number | null;
  weeks: number;
  /** The energy adjustment in force today. */
  adjust: number;
  startAdjust: number;
  endAdjust: number;
  daysIn: number | null;
  daysLeft: number | null;
};

/**
 * Where you are in the block, and therefore how hard today is.
 *
 * A phase that ramps is the point of "toned maintenance": you start level with
 * maintenance so nothing about training suffers while you settle in, and the
 * deficit arrives so slowly that the scale barely reacts while body
 * composition does. Ending eight weeks later a few per cent under is a
 * different experience from starting there, even though the average is
 * similar.
 */
export function phaseOf(p: Profile, today: string): Phase {
  const weeks = Math.max(0, Math.round(p.phase_weeks || 0));
  const start = p.phase_start;
  const base = {
    name: p.phase_name || goalDef(p.goal).label,
    weeks,
    startAdjust: p.phase_start_adjust,
    endAdjust: p.phase_end_adjust,
  };

  if (!start || weeks <= 0) {
    return { ...base, progress: null, week: null, adjust: p.phase_start_adjust, daysIn: null, daysLeft: null };
  }

  const msPerDay = 86_400_000;
  const daysIn = Math.floor(
    (new Date(today + "T12:00:00").getTime() - new Date(start + "T12:00:00").getTime()) / msPerDay
  );
  const total = weeks * 7;
  const clamped = Math.min(total, Math.max(0, daysIn));

  /**
   * The drift steps once a week, not once a day.
   *
   * A target that slides every morning means the containers you portioned on
   * Sunday are wrong by Wednesday and the shopping list disagrees with the
   * plan it was built from. Holding it flat for the whole week and stepping on
   * roll day is both easier to live with and easier to trust — and across the
   * block the average adjustment comes out the same either way.
   */
  const weeksIn = Math.floor(clamped / 7);
  const steppedDays = Math.min(total, weeksIn * 7);
  const progress = total > 0 ? steppedDays / total : 1;

  return {
    ...base,
    progress,
    week: weeksIn + 1,
    adjust: p.phase_start_adjust + (p.phase_end_adjust - p.phase_start_adjust) * progress,
    daysIn,
    daysLeft: total - clamped,
  };
}

/**
 * A body fat percentage, however we can get one.
 *
 * Typed in by hand if you've had it measured; otherwise estimated from a tape,
 * which most people can actually do. Neck is a one-off measurement and the
 * waist you're taking anyway, so the estimate keeps itself current as the
 * waist moves — which is the half of it worth trusting.
 */
export function estimatedBodyFat(p: Profile): BfEstimate | null {
  const kg = planWeight(p);

  // The figure the weekly roll took off your measurements wins: it came from
  // an actual tape or an actual set of calipers on an actual day, which beats
  // re-deriving one from whatever happens to be in the settings.
  if (p.plan_bf_pct != null && p.plan_bf_pct > 0) {
    const pct = p.plan_bf_pct;
    return {
      pct,
      leanKg: Math.round(kg * (1 - pct / 100) * 10) / 10,
      fatKg: Math.round(kg * (pct / 100) * 10) / 10,
      error: 3,
      method: "manual",
      label: "measured this week",
    };
  }

  if (p.bf_source === "manual" && p.body_fat_pct != null && p.body_fat_pct > 0) {
    const pct = p.body_fat_pct;
    return {
      pct,
      leanKg: Math.round(kg * (1 - pct / 100) * 10) / 10,
      fatKg: Math.round(kg * (pct / 100) * 10) / 10,
      error: 0,
      method: "manual",
      label: "measured",
    };
  }
  if (p.bf_source === "tape" && p.neck_cm && p.waist_cm) {
    return navyBodyFat({
      sex: p.sex,
      heightCm: p.height_cm,
      neckCm: p.neck_cm,
      waistCm: p.waist_cm,
      hipCm: p.hip_cm,
      weightKg: kg,
    });
  }
  return null;
}

/**
 * The bodyweight every target is worked out from.
 *
 * Defined here rather than imported from lib/weekly.ts so that the maths in
 * this file has no dependency on the rolling machinery — it just needs to know
 * which number to use, and the answer is "the snapshot, if there is one".
 */
export function planWeight(p: Profile): number {
  return p.plan_weight_kg != null && p.plan_weight_kg > 0 ? p.plan_weight_kg : p.weight_kg;
}

/** Lean body mass, when a body fat figure is available from anywhere. */
export function leanMass(p: Profile): number | null {
  const bf = estimatedBodyFat(p);
  if (!bf || bf.pct <= 0 || bf.pct >= 60) return null;
  return planWeight(p) * (1 - bf.pct / 100);
}

/** Katch-McArdle if we know lean mass, otherwise Mifflin-St Jeor. */
export function bmr(p: Profile): number {
  const lbm = leanMass(p);
  if (lbm != null) return 370 + 21.6 * lbm;
  const age = ageFromDob(p.dob);
  const base = 10 * planWeight(p) + 6.25 * p.height_cm - 5 * age;
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
    return baseline(p) + sessionsKcal(planWeight(p), dt.sessions);
  }
  return baseline(p) * (1 + (dt.percent ?? 0));
}

export type Targets = Macros & {
  dayTypeId: number;
  name: string;
  /** Fat as a share of the day's calories. */
  fatPct: number;
  /**
   * Fat in g per kg bodyweight, after the carb floor has had its say. This is
   * the number that matters for hormonal health — the *share* of calories
   * naturally falls on a big training day without the grams changing, which is
   * exactly what you want, so it makes a poor warning signal.
   */
  fatPerKg: number;
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
  phase: Phase;
  /** True when maintenance came from your own data rather than the formula. */
  calibrated: boolean;
  /** Mean daily cost across the seven days you've mapped. */
  maintenance: number;
  /** The seven-day average you're aiming for. */
  goalKcal: number;
  /** What every non-pinned day was multiplied by to make the week balance. */
  balance: number;
  dayTypes: DayType[];
};

/**
 * The protein number.
 *
 * Scaling by lean mass rather than scale weight is the more defensible basis —
 * fat tissue doesn't need feeding — and it's what the recomposition literature
 * uses, at 2.6–3.5 g/kg of fat-free mass. It needs a body fat percentage to
 * work, so without one it quietly falls back to bodyweight. Either way the
 * result is clamped to something sane per kg of actual bodyweight, so a
 * mistyped body fat figure can't ask you to eat 400 g of protein.
 */
export function proteinTarget(p: Profile): number {
  const lbm = leanMass(p);
  let raw: number;

  if (p.protein_basis === "lean") {
    // Falling back to bodyweight without converting would be a silent 15%
    // jump — 2.8 g/kg of lean mass and 2.8 g/kg of bodyweight are not the
    // same number. Assume a plausible body fat figure instead, erring on the
    // high side so the target doesn't inflate.
    const lean = lbm ?? planWeight(p) * (1 - assumedBodyFat(p.sex) / 100);
    raw = p.protein_per_kg * lean;
  } else {
    raw = p.protein_per_kg * planWeight(p);
  }

  return Math.min(3.2 * planWeight(p), Math.max(1.4 * planWeight(p), raw));
}

/** True when the lean-mass target is running on an assumption, not a figure. */
export function proteinIsAssumed(p: Profile): boolean {
  return p.protein_basis === "lean" && leanMass(p) == null;
}

function macrosFor(p: Profile, kcal: number, mul = { protein: 1, fat: 1 }): Macros {
  const protein = proteinTarget(p) * mul.protein;
  let fat = p.fat_per_kg * planWeight(p) * mul.fat;
  const carbFloor = (p.carb_floor_per_kg ?? 1) * planWeight(p);

  let carbs = (kcal - protein * 4 - fat * 9) / 4;

  // On a low day, protect carbohydrate before fat — you still have to train on
  // it. Fat gives way down to a hard 0.45 g/kg hormonal floor.
  if (carbs < carbFloor) {
    const fatFloor = 0.45 * planWeight(p);
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
export function buildWeekPlan(
  p: Profile,
  dayTypes: DayType[],
  opts: { today?: string } = {}
): WeekPlan {
  const today = opts.today ?? dayKey();
  const phase = phaseOf(p, today);

  // Never end up with no day types at all. If seeding hasn't run yet, or the
  // fetch failed, or someone deleted the last one, fall back to a single
  // unnamed day rather than producing a plan of zeroes — a blank target is a
  // far worse failure than an unlabelled one.
  const supplied = [...dayTypes].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const types: DayType[] = supplied.length
    ? supplied
    : [
        {
          id: 0,
          name: "Every day",
          sort_order: 0,
          sessions: [],
          fixed_kcal: null,
          percent: null,
        },
      ];
  const fallbackId = types[0].id;
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

  let maintenance =
    used.reduce((a, t) => a + (cost.get(t.id) ?? 0), 0) / days ||
    (types.length ? cost.get(types[0].id) ?? baseline(p) : baseline(p));

  // If your own intake and weight trend disagree with the formula, believe the
  // data. The whole week is scaled by one factor so the relative shape of it —
  // which came from your sessions — survives intact.
  let calibrated = false;
  if (p.use_calibration && p.calibrated_tdee && p.calibrated_tdee > 0 && maintenance > 0) {
    const factor = Math.min(1.3, Math.max(0.75, p.calibrated_tdee / maintenance));
    for (const t of types) cost.set(t.id, (cost.get(t.id) ?? 0) * factor);
    maintenance = maintenance * factor;
    calibrated = true;
  }

  const goalKcal =
    p.calorie_override != null && p.calorie_override > 0
      ? p.calorie_override
      : maintenance * (1 + phase.adjust);

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

  // Calories first, because fat is a share of them.
  const kcalById = new Map<number, number>();
  for (const t of types) {
    const raw = cost.get(t.id) ?? baseline(p);
    let kcal: number;
    if (!p.cycling) kcal = goalKcal;
    else if (t.fixed_kcal != null && t.fixed_kcal > 0) kcal = t.fixed_kcal;
    else kcal = raw * balance;
    kcalById.set(t.id, Math.max(floor, kcal));
  }

  // Protein and fat lean toward the days that earn them, averaging out across
  // the week so the figures you set still mean what they say.
  const muls = loadMultipliers(types, week, { kcalById });

  const byId: Record<number, Targets> = {};
  for (const t of types) {
    const raw = cost.get(t.id) ?? baseline(p);
    const kcal = kcalById.get(t.id) ?? floor;

    const m = macrosFor(p, kcal, p.periodise ? muls.get(t.id) ?? undefined : undefined);
    byId[t.id] = {
      ...m,
      dayTypeId: t.id,
      name: t.name,
      fatPct: kcal > 0 ? (m.fat * 9) / kcal : 0,
      fatPerKg: planWeight(p) > 0 ? m.fat / planWeight(p) : 0,
      cost: Math.round(raw),
      sessionKcal: Math.round(sessionsKcal(planWeight(p), t.sessions)),
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
    phase,
    calibrated,
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
      fatPct: 0,
      fatPerKg: 0,
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
    { ...ZERO_MACROS }
  );
}

export function scaleMacros(m: Macros, k: number): Macros {
  return {
    kcal: m.kcal * k,
    protein: m.protein * k,
    carbs: m.carbs * k,
    fat: m.fat * k,
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

/* ------------------------------------------------------------------ */
/* Fuelling the work                                                   */
/* ------------------------------------------------------------------ */

/**
 * MET-weighted training minutes for a day type.
 *
 * The carbohydrate bands in the position stands are written in hours of
 * training per day, which quietly assumes those hours are hard. An hour of
 * technique work and an hour of main set are not the same glycogen cost, so
 * minutes are weighted by intensity above rest and normalised so that a
 * 7-MET hour counts as an hour.
 */
export function trainingLoad(dt: DayType): number {
  return (dt.sessions ?? []).reduce(
    (a, s) => a + Math.max(0, Number(s.minutes) || 0) * (Math.max(1, Number(s.met) || 1) - 1) / 6,
    0
  );
}

export type CarbCheck = {
  dayTypeId: number;
  name: string;
  band: CarbBand;
  loadMinutes: number;
  /** What the plan's carb target comes to, per kg of bodyweight. */
  perKg: number;
  grams: number;
  /** The band's range in grams for this bodyweight. */
  lowGrams: number;
  highGrams: number;
  /**
   * `low_by_design` is the important one. Under the band on a day with little
   * training in it is carbohydrate periodisation working as intended, not a
   * fault; under it on a training day is under-fuelling the work.
   */
  verdict: "under_fuelled" | "low_by_design" | "in" | "over";
};

/**
 * Is each kind of day carrying the carbohydrate its training actually asks for?
 *
 * This is the check that matters most to a swimmer and the one a
 * percentage-of-calories split will never make. Carbohydrate requirement
 * scales with the work done, not with the size of the day's calorie budget —
 * so a hard pool session inside a modest deficit is exactly the situation
 * where a macro split derived from percentages under-fuels, and exactly the
 * situation a swimmer is in most of the time.
 *
 * Bands from Burke et al. (2011), carried forward by the ACSM/AND/DC position
 * stand (Thomas et al. 2016) and applied to swimming by Shaw et al. (2014).
 *
 * Two honest caveats, both of which the app repeats on screen:
 *
 *  - **The bands assume energy balance.** In a deficit you cannot hit the top
 *    of them and should not try; the useful reading is whether the *training*
 *    days are carrying more than the rest days, not whether every day clears
 *    the bar.
 *  - **Being under on a light day is the point.** Fuelling for the work
 *    required (Impey et al. 2018) means low days are meant to be low. Only a
 *    training day under its band is a problem, and only that one is called one.
 *
 * Reported and never silently corrected: under-fuelling costs training quality
 * rather than body composition, and the fix is usually to move carbohydrate
 * toward the session rather than to add any.
 */
export function carbCheck(p: Profile, plan: WeekPlan): CarbCheck[] {
  const kg = planWeight(p);
  return plan.dayTypes.map((dt) => {
    const t = targetsFor(plan, dt.id);
    const load = trainingLoad(dt);
    const band = carbBandFor(load);
    const lowGrams = Math.round(band.low * kg);
    const highGrams = Math.round(band.high * kg);
    return {
      dayTypeId: dt.id,
      name: dt.name,
      band,
      loadMinutes: Math.round(load),
      perKg: kg > 0 ? Math.round((t.carbs / kg) * 10) / 10 : 0,
      grams: t.carbs,
      lowGrams,
      highGrams,
      verdict:
        t.carbs > highGrams
          ? "over"
          : t.carbs >= lowGrams
            ? "in"
            : load >= 45
              ? "under_fuelled"
              : "low_by_design",
    };
  });
}

/* ------------------------------------------------------------------ */
/* How much the day's training moves protein and fat                    */
/* ------------------------------------------------------------------ */

/**
 * Protein and fat lean on the day, gently.
 *
 * Carbohydrate periodisation is well established — fuel the work required, and
 * the swing is large. Protein and fat are a different and weaker case, and the
 * honest version of it is this:
 *
 *  - **Protein should not swing much.** Muscle protein synthesis stays raised
 *    for a day or two after a session (Phillips et al. 1997), so a rest day
 *    between two training days is still working through the last one. In a
 *    deficit, protein protects lean mass on every day, trained or not
 *    (Mettler et al. 2010). Anyone who drops protein hard on rest days is
 *    doing something the evidence does not support.
 *  - **But a range is a range, and this is maintenance.** The recommendations
 *    are bands, not points. The tight one — 2.3–3.1 g/kg of fat-free mass
 *    (Helms et al. 2014) — is for lean athletes in a *deficit*, where protein
 *    is the thing standing between you and lost muscle. At maintenance the
 *    binding evidence is looser and lower: benefit plateaus around 1.6 g/kg
 *    bodyweight with the confidence interval reaching 2.2 (Morton et al.
 *    2018), and the ISSN position stand puts 1.4–2.0 g/kg bodyweight as enough
 *    to build and hold muscle (Jäger et al. 2017). So a rest day near 1.8 g/kg
 *    and a hard double near 2.5 is periodisation *within* the evidence rather
 *    than outside it, and it is what a periodised framework actually does
 *    (Stellingwerff et al. 2019). The spread is wide enough to matter and
 *    bounded at both ends by numbers someone has actually studied.
 *  - **Fat is a share of energy, not a gram figure.** Fat guidance is written
 *    as a percentage — roughly 20–35% for athletes (Thomas et al. 2016), lower
 *    for physique work (Iraki et al. 2019) — over a floor for hormonal health.
 *    A flat gram figure inverts that: 63 g is 25% of a 2,239 kcal rest day and
 *    17% of a 3,365 kcal training day, which quietly makes rest days the
 *    *fattiest* ones. So fat is set as a constant percentage of the day: every
 *    day lands on the same share, and the big days get proportionally more of
 *    it in grams. That is also the shape the food has — the meals that only
 *    appear on a training day carry fat with them whether you ask them to or
 *    not, and a target that scales with the day is a target they can hit.
 *
 * Protein's spread is deliberately small, fat's is whatever the calorie curve
 * says, and the week still averages exactly the figures you set — this moves
 * protein and fat *between* days, it does not add any. Turn it off and every
 * day gets the same, as before.
 */
export const LOAD_SPREAD = { protein: 0.16 };

/** Only used when the caller has no per-day calories to work from. */
const FAT_FALLBACK = 0.14;

/**
 * Where each day type sits between the lightest day of the week and the
 * heaviest, by MET-weighted training minutes. 0 on the lightest, 1 on the
 * heaviest, and 0.5 for everything when every day is the same.
 */
export function loadPositions(types: DayType[], week: WeekMap): Map<number, number> {
  const used = new Set(WEEKDAYS.map((d) => week[d]));
  const loads = new Map(types.map((t) => [t.id, trainingLoad(t)]));
  const inWeek = [...loads.entries()].filter(([id]) => used.has(id)).map(([, v]) => v);

  const lo = inWeek.length ? Math.min(...inWeek) : 0;
  const hi = inWeek.length ? Math.max(...inWeek) : 0;
  const span = hi - lo;

  const out = new Map<number, number>();
  for (const t of types) {
    const v = loads.get(t.id) ?? 0;
    // Day types outside the week still get a sensible position rather than
    // falling off the end of a scale built without them.
    out.set(t.id, span > 1e-9 ? Math.max(0, Math.min(1, (v - lo) / span)) : 0.5);
  }
  return out;
}

/** The mean of a value across the seven days as they are actually mapped. */
function weekMean(week: WeekMap, of: (id: number) => number | undefined): number {
  let n = 0;
  let sum = 0;
  for (const d of WEEKDAYS) {
    const v = of(week[d]);
    if (v == null || !Number.isFinite(v)) continue;
    n++;
    sum += v;
  }
  return n ? sum / n : 1;
}

/**
 * Multipliers on protein and fat, one per day type, averaging exactly 1 across
 * the week you actually eat.
 *
 * The normalisation is the point. Without it, leaning protein toward training
 * days would quietly raise or lower the weekly total depending on how the week
 * happens to be shaped, and the figure you set would stop meaning anything.
 *
 * Pass `kcalById` and fat is set the way the literature writes it — as a share
 * of the day's energy — rather than as a spread around a gram figure. Without
 * it fat falls back to the same shape as protein, which is only there so a
 * caller with no per-day calories still gets something sensible.
 */
export function loadMultipliers(
  types: DayType[],
  week: WeekMap,
  opts: { spread?: { protein: number }; kcalById?: Map<number, number> } = {}
): Map<number, { protein: number; fat: number }> {
  const spread = opts.spread ?? LOAD_SPREAD;
  const pos = loadPositions(types, week);

  const kcalById = opts.kcalById;
  const meanKcal = kcalById ? weekMean(week, (id) => kcalById.get(id)) : 0;
  const byEnergy = !!kcalById && meanKcal > 0;

  const raw = new Map<number, { protein: number; fat: number }>();
  for (const t of types) {
    const x = (pos.get(t.id) ?? 0.5) - 0.5; // -0.5 .. +0.5
    raw.set(t.id, {
      protein: 1 + 2 * x * spread.protein,
      // A constant share of energy: a bigger day gets proportionally more fat,
      // and every day lands on the same percentage.
      fat: byEnergy ? (kcalById.get(t.id) ?? meanKcal) / meanKcal : 1 + 2 * x * FAT_FALLBACK,
    });
  }

  const meanP = weekMean(week, (id) => raw.get(id)?.protein);
  const meanF = weekMean(week, (id) => raw.get(id)?.fat);

  const out = new Map<number, { protein: number; fat: number }>();
  for (const [id, m] of raw) {
    out.set(id, { protein: m.protein / (meanP || 1), fat: m.fat / (meanF || 1) });
  }
  return out;
}
