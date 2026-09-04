/**
 * Energy availability — the number that decides whether getting leaner costs
 * you the season.
 *
 * Every other figure in this app is about the size of a day. This one is about
 * what is left of it once the training has been paid for, and it is the
 * difference between an athlete who gets lean and one who gets slow.
 *
 *     EA (kcal per kg fat-free mass per day) = (intake − exercise cost) / FFM
 *
 * The exercise term is the cost *above rest*, which is what `sessionKcal`
 * already computes — `(MET − 1) × 3.5 × kg × min / 200`. Getting that wrong is
 * the commonest error in the literature and it inflates EA by hundreds of
 * calories, so it is worth saying plainly: this is net, not gross.
 *
 * ## Why a swimmer needs this and a calorie target isn't enough
 *
 * A weekly average can look perfectly sensible while a Tuesday with two swims
 * in it leaves 1,900 kcal to run a body on. Bodyweight will not tell you —
 * this is the failure mode where nothing on the scale moves and the swimming
 * quietly goes backwards. In junior swimmers, those in low energy availability
 * lost about 10% of their swimming speed over twelve weeks *at stable body
 * mass*, while adequately fuelled team-mates improved by about 8%.
 * (Shaw, Boyd, Burke & Koivisto, "Nutrition for Swimming", IJSNEM 2014.)
 *
 * ## The thresholds, and how much to trust them
 *
 * For males the honest answer is that nobody is sure. The 2023 IOC consensus
 * on Relative Energy Deficiency in Sport deliberately declines to set a
 * clinical cut-off, warning of "risks in setting a definitive clinical
 * threshold", and says the male figure "is even less understood, but appears
 * to be lower (eg, ~9 to 25 kcal/kg FFM/day)" than the female one. The widely
 * used 30/45 numbers were derived from female reproductive physiology; only
 * one study has ever taken males as low as 15, and they showed a markedly
 * blunted hormonal response compared with females.
 *
 * So the numbers below are aims and warnings, never a diagnosis:
 *
 *   - **≥ 40** — optimal, and what to plan for.
 *   - **30–40** — reduced. Fine for a short, deliberate block; not a place to
 *     live, and not somewhere to be by accident.
 *   - **< 30** — low. The plan should not put you here, and this module makes
 *     sure it doesn't.
 *
 * And EA is a computed quantity that inherits error from three places: what
 * you logged, the MET estimate for the session, and the fat-free mass figure —
 * which on a skinfold estimate carries about ±3.5 %BF, roughly ±2.7 kg, which
 * on its own moves EA by about ±1.5. Treat single-day values as noise and the
 * weekly pattern as signal.
 *
 * References:
 *   Mountjoy et al., 2023 IOC consensus statement on REDs, BJSM 57(17):1073.
 *   Melin, Heikura, Tenforde & Mountjoy, "Energy Availability in Athletics",
 *     IJSNEM 2019;29(2):152 — the 40/30 operational scheme.
 *   Areta, Taylor & Koehler, Eur J Appl Physiol 2021;121:1 — male evidence.
 */

import {
  WEEKDAYS,
  leanMass,
  planWeight,
  targetsFor,
  type DayType,
  type Profile,
  type WeekPlan,
} from "./nutrition";
import { sessionsKcal } from "./activities";

/**
 * The two thresholds live in lib/nutrition.ts, where the plan can enforce the
 * floor without importing this module back the other way. Re-exported here
 * because this is where they are explained.
 */
export { EA_FLOOR, EA_OPTIMAL } from "./nutrition";
import { EA_FLOOR, EA_OPTIMAL } from "./nutrition";

export type EaBand = "optimal" | "reduced" | "low" | "unknown";

export type DayEnergy = {
  dayTypeId: number;
  name: string;
  /** Weekdays using this kind of day. */
  days: number;
  /** The day's calorie target. */
  intake: number;
  /** Cost of the day's sessions, above rest. */
  exercise: number;
  /** Fat-free mass the figure is divided by, kg. */
  ffm: number;
  /** kcal per kg FFM per day, or null when body composition is unknown. */
  ea: number | null;
  band: EaBand;
  /** Calories this day is short of the floor. Zero when it is fine. */
  shortfall: number;
};

/**
 * Whether the week is restricting, in balance, or in surplus.
 *
 * This turns out to matter more than the EA number itself, and getting it
 * wrong makes the warning actively misleading. At true energy balance,
 *
 *     EA = BMR × base_activity / FFM
 *
 * — the session cost cancels out, because you ate it. So a lean athlete whose
 * non-training activity is modest lands somewhere in the low thirties *at
 * maintenance*, and no amount of eating "enough" moves it without eating into
 * a surplus. That is arithmetic, not under-fuelling.
 *
 * The thresholds in the literature come from restriction studies. A day at 33
 * while in energy balance is a different animal from a day at 33 while 500
 * kcal down, and telling someone in balance that they are under-fuelled is
 * how you get an athlete eating past maintenance to satisfy a number.
 */
export type EnergyContext = "restricting" | "balanced" | "surplus";

export function contextOf(plan: WeekPlan): EnergyContext {
  const gap = (actualWeeklyAverage(plan) - plan.maintenance) / (plan.maintenance || 1);
  if (gap < -0.02) return "restricting";
  if (gap > 0.02) return "surplus";
  return "balanced";
}

/**
 * Fat-free mass, or nothing.
 *
 * Deliberately returns null rather than guessing from bodyweight. An EA figure
 * built on an invented FFM is worse than no EA figure, because it looks like
 * evidence.
 */
export function fatFreeMass(p: Profile): number | null {
  const lbm = leanMass(p);
  return lbm != null && lbm > 20 ? lbm : null;
}

export function bandOf(ea: number | null): EaBand {
  if (ea == null) return "unknown";
  if (ea >= EA_OPTIMAL) return "optimal";
  if (ea >= EA_FLOOR) return "reduced";
  return "low";
}

/**
 * The lowest EA the arithmetic allows at true energy balance.
 *
 * Useful because it says whether a "reduced" reading can be fixed by eating
 * more at all, or whether it is simply what this body composition and this
 * activity level come to when intake equals expenditure.
 */
export function balancedEa(p: Profile, plan: WeekPlan): number | null {
  const ffm = fatFreeMass(p);
  return ffm ? Math.round((plan.baseline / ffm) * 10) / 10 : null;
}

/** What each kind of day leaves you to live on. */
export function weekEnergy(p: Profile, plan: WeekPlan): DayEnergy[] {
  const ffm = fatFreeMass(p);
  const weight = planWeight(p);

  const daysUsing = new Map<number, number>();
  for (const d of WEEKDAYS) {
    const id = plan.week[d];
    daysUsing.set(id, (daysUsing.get(id) ?? 0) + 1);
  }

  return plan.order.map((id) => {
    const t = targetsFor(plan, id);
    const dt = plan.dayTypes.find((x) => x.id === id);
    const exercise = dt ? sessionsKcal(weight, dt.sessions ?? []) : 0;
    const ea = ffm ? (t.kcal - exercise) / ffm : null;
    return {
      dayTypeId: id,
      name: t.name,
      days: daysUsing.get(id) ?? 0,
      intake: t.kcal,
      exercise: Math.round(exercise),
      ffm: ffm ?? 0,
      ea: ea == null ? null : Math.round(ea * 10) / 10,
      band: bandOf(ea),
      shortfall: ffm && ea != null && ea < EA_FLOOR ? Math.ceil(EA_FLOOR * ffm + exercise - t.kcal) : 0,
    };
  });
}

/**
 * The calories a day needs before it is allowed to be a training day.
 *
 * Used as a floor when the plan is built, so that a deficit can never quietly
 * take a day below the line. The rule the literature is clear about, even
 * where it is unsure about the exact number, is that when the deficit and
 * energy availability disagree, **energy availability wins** — you can always
 * lose the fat next month, and you cannot get the season back.
 */
export function eaFloorKcal(p: Profile, dt: DayType | undefined): number {
  const ffm = fatFreeMass(p);
  if (!ffm || !dt) return 0;
  return EA_FLOOR * ffm + sessionsKcal(planWeight(p), dt.sessions ?? []);
}

/* ------------------------------------------------------------------ */
/* How fast is too fast                                                */
/* ------------------------------------------------------------------ */

/**
 * The rate of loss that keeps the performance.
 *
 * Twenty-four elite athletes, eleven weeks, both groups lifting. The group
 * losing 0.7% of bodyweight a week **gained 2.1% lean mass and lost 31% of
 * their fat**, and put 7% on their jump and 13.6% on their bench. The group
 * losing 1.0–1.4% a week lost *less* fat (21%), gained no lean mass and no
 * performance. Faster was worse on every measure that mattered, including the
 * one it was supposed to be better at.
 *
 * (Garthe, Raastad, Refsnes, Koivisto & Sundgot-Borgen, IJSNEM 2011;21(2):97.)
 *
 * So 0.7%/week is the target and 1.0%/week is the ceiling, and a phase that
 * asks for more than that is asking for something the evidence says it will
 * not get.
 */
export const LOSS_TARGET_PCT = 0.007;
export const LOSS_CEILING_PCT = 0.01;

/** What the seven mapped days average to, after every floor has applied. */
export function actualWeeklyAverage(plan: WeekPlan): number {
  let total = 0;
  let n = 0;
  for (const d of WEEKDAYS) {
    const id = plan.week[d];
    if (id == null) continue;
    total += targetsFor(plan, id).kcal;
    n++;
  }
  return n ? total / n : plan.goalKcal;
}

export type RateVerdict = {
  /** Weekly change the current phase implies, as a fraction of bodyweight. */
  pctPerWeek: number;
  kgPerWeek: number;
  verdict: "gaining" | "maintaining" | "sensible" | "brisk" | "too_fast";
  note: string;
};

/**
 * What the plan's calorie gap implies for the scale, and whether that rate is
 * one the evidence supports.
 *
 * 7,700 kcal to a kilogram is the usual approximation and is good enough over
 * a week; it overstates the loss over months, which is a reason to re-read
 * your own trend rather than to trust the arithmetic.
 */
export function lossRate(p: Profile, plan: WeekPlan): RateVerdict {
  /**
   * The average you will actually eat, not the one you asked for.
   *
   * `plan.goalKcal` is the target before the energy-availability floor has had
   * its say, and once that binds the two are different numbers — ask for 20%
   * under and the floor quietly gives most of it back, which is the whole
   * point of it. Reading the requested figure here reported a rate of loss
   * that was never going to happen.
   */
  const actual = actualWeeklyAverage(plan);
  const gap = actual - plan.maintenance;
  const kgPerWeek = (gap * 7) / 7700;
  const weight = planWeight(p) || 1;
  const pct = kgPerWeek / weight;

  if (pct > 0.002)
    return {
      pctPerWeek: pct,
      kgPerWeek,
      verdict: "gaining",
      note: "Gaining. Fine in a build block; worth knowing if you meant to hold.",
    };
  if (pct > -0.002)
    return {
      pctPerWeek: pct,
      kgPerWeek,
      verdict: "maintaining",
      note: "Holding weight. Leanness has to come from training and protein, which is slower and keeps the training.",
    };
  if (pct >= -LOSS_TARGET_PCT * 1.15)
    return {
      pctPerWeek: pct,
      kgPerWeek,
      verdict: "sensible",
      note: "About 0.7% a week — the rate that gained lean mass and strength in the elite-athlete trial, rather than the faster one that gained neither.",
    };
  if (pct >= -LOSS_CEILING_PCT)
    return {
      pctPerWeek: pct,
      kgPerWeek,
      verdict: "brisk",
      note: "Above 0.7% a week. Workable for a short block, but this is where lean mass and power start paying for it.",
    };
  return {
    pctPerWeek: pct,
    kgPerWeek,
    verdict: "too_fast",
    note: "Past 1% a week. In the trial this lost less fat than the slower group and gained no lean mass or strength — it is not a faster route to the same place.",
  };
}

/* ------------------------------------------------------------------ */
/* Carbohydrate for the work required                                  */
/* ------------------------------------------------------------------ */

/**
 * Grams of carbohydrate per kg bodyweight, by what the day actually contains.
 *
 * "Fuel for the work required" means matching carbohydrate to the session in
 * front of you, and the honest version of it is the conservative one: eat less
 * on a genuinely easy day, not less before a hard one. The cell-signalling
 * case for training deliberately glycogen-depleted is real, and the
 * performance case is not — a meta-analysis of nine training studies found no
 * effect on endurance performance at all (SMD 0.17, 95% CI −0.15 to 0.49,
 * p = 0.29). Below roughly 200 mmol/kg dry weight of muscle glycogen, training
 * intensity is measurably compromised, which in a sport where technique holds
 * up or falls apart under fatigue is the wrong thing to gamble.
 *
 * References:
 *   Thomas, Erdman & Burke, ACSM/AND/DC position stand, JAND 2016;116(3):501.
 *   Shaw et al., "Nutrition for Swimming", IJSNEM 2014 — 3–10 g/kg by session.
 *   Impey et al., "Fuel for the Work Required", Sports Med 2018;48:1031.
 *   Gejl & Nybo, JISSN 2021;18:37 — the null meta-analysis.
 */
export type CarbBandDef = {
  key: "light" | "moderate" | "high" | "very_high";
  label: string;
  low: number;
  high: number;
  /** Minutes of load (minutes × (MET−1)/6) at or above which this band starts. */
  fromLoad: number;
};

export const CARB_BANDS: CarbBandDef[] = [
  { key: "light", label: "Light", low: 3, high: 5, fromLoad: 0 },
  { key: "moderate", label: "Moderate", low: 5, high: 7, fromLoad: 45 },
  { key: "high", label: "High", low: 6, high: 10, fromLoad: 90 },
  { key: "very_high", label: "Very high", low: 8, high: 12, fromLoad: 200 },
];

export function carbBandFor(loadMinutes: number): CarbBandDef {
  let out = CARB_BANDS[0];
  for (const b of CARB_BANDS) if (loadMinutes >= b.fromLoad) out = b;
  return out;
}

/* ------------------------------------------------------------------ */
/* Protein, and the fact that it competes for the plate                */
/* ------------------------------------------------------------------ */

/**
 * A sanity range for protein in-season, and why more is not better.
 *
 * 1.6–2.0 g/kg covers the evidence for training adaptation and for holding
 * lean mass through a modest deficit. Going higher is safe but not free: on a
 * heavy day, 8–10 g/kg of carbohydrate plus 2.4 g/kg of protein is already
 * near four thousand calories before a gram of fat, so every extra gram of
 * protein is a gram of carbohydrate you don't eat. In-season, carbohydrate
 * should generally win that argument.
 *
 * The evidence above ~1.8 g/kg in a *modest* deficit is genuinely contested: a
 * 2025 RCT comparing 1.2, 1.6 and 2.2 g/kg during energy restriction found no
 * difference in body composition between them. The clear benefit of going
 * higher shows up in aggressive deficits, which this plan is not.
 *
 * References:
 *   Jäger et al., ISSN position stand, JISSN 2017;14:20.
 *   Witard, Garthe & Phillips, IJSNEM 2019;29(2):165.
 *   Kanaan, Nait-Yahia & Doucet, Eur J Clin Nutr 2025;79(6):544 — the null RCT.
 */
export const PROTEIN_SENSIBLE = { low: 1.6, high: 2.0, ceiling: 2.4 };

export type ProteinVerdict = {
  perKg: number;
  grams: number;
  verdict: "low" | "in_range" | "high" | "very_high";
  note: string;
};

export function proteinVerdict(grams: number, weightKg: number): ProteinVerdict {
  const perKg = weightKg > 0 ? grams / weightKg : 0;
  if (perKg < PROTEIN_SENSIBLE.low)
    return {
      perKg,
      grams,
      verdict: "low",
      note: "Under 1.6 g/kg. Fine in a surplus, thin if you are trying to hold lean mass at maintenance.",
    };
  if (perKg <= PROTEIN_SENSIBLE.high)
    return { perKg, grams, verdict: "in_range", note: "In the range the evidence supports." };
  if (perKg <= PROTEIN_SENSIBLE.ceiling)
    return {
      perKg,
      grams,
      verdict: "high",
      note: "Above 2.0 g/kg. Safe, but the benefit over 1.6–2.0 in a modest deficit is contested, and it is carbohydrate you are not eating.",
    };
  return {
    perKg,
    grams,
    verdict: "very_high",
    note: "Past 2.4 g/kg. This is crowding out the carbohydrate the training runs on for a gain the evidence does not really show.",
  };
}

/* ------------------------------------------------------------------ */
/* Fat, and the floor under it                                         */
/* ------------------------------------------------------------------ */

/**
 * Dietary fat is the one macro with a floor that isn't about performance.
 *
 * Carbohydrate runs the session and protein holds the muscle on, and both show
 * their shortfall in a week. Fat is slower and quieter: the position stands
 * put athletes at 20–35% of energy from fat and say plainly that going under
 * 20% buys no performance, and low-fat intakes in men are associated with
 * lower testosterone — which is the hormone doing the work on the side of this
 * that is about staying lean *and* muscular rather than just light.
 *
 * So the check here is on the share of calories as well as the grams. A
 * swimmer's plate is carbohydrate-heavy by necessity, so the share drifts down
 * on its own as training goes up; that is fine and expected. What is not fine
 * is setting the per-kg figure so low that every day of the week lands in the
 * teens.
 *
 *   Thomas, Erdman & Burke, ACSM/AND/DC position stand, JAND 2016;116(3):501.
 */
export const FAT_MIN_PCT = 0.2;
export const FAT_MIN_PER_KG = 0.5;

export type FatCheck = {
  dayTypeId: number;
  name: string;
  days: number;
  grams: number;
  perKg: number;
  pctKcal: number;
  verdict: "low" | "lean" | "ok";
};

export function fatCheck(plan: WeekPlan, weightKg: number): FatCheck[] {
  const daysUsing = new Map<number, number>();
  for (const d of WEEKDAYS) {
    const id = plan.week[d];
    daysUsing.set(id, (daysUsing.get(id) ?? 0) + 1);
  }
  return plan.order.map((id) => {
    const t = targetsFor(plan, id);
    const perKg = weightKg > 0 ? t.fat / weightKg : 0;
    const pctKcal = t.kcal > 0 ? (t.fat * 9) / t.kcal : 0;
    return {
      dayTypeId: id,
      name: t.name,
      days: daysUsing.get(id) ?? 0,
      grams: t.fat,
      perKg: Math.round(perKg * 100) / 100,
      pctKcal,
      verdict:
        perKg < FAT_MIN_PER_KG || pctKcal < 0.15 ? "low" : pctKcal < FAT_MIN_PCT ? "lean" : "ok",
    };
  });
}

/**
 * How to spread it: four to five feeds of about 0.4 g/kg, three to four hours
 * apart, and 30–40 g of something slow before bed.
 *
 * The per-dose figure has drifted up from the old 0.25 g/kg as the research
 * moved to athletes eating mixed whole-food meals inside a deficit, where the
 * response per dose is blunted. The pre-sleep dose is mechanistically solid
 * and outcome evidence is modest — worth doing, not worth worrying about.
 */
export const PROTEIN_DOSE_PER_KG = 0.4;
export const PROTEIN_FEEDS = { low: 4, high: 5 };
export const PRE_SLEEP_PROTEIN = { low: 30, high: 40 };
