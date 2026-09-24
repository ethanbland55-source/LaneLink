/**
 * The weekly review: read the scale, decide next week, and park the decision
 * where the shopping list can see it and the plan in force can't.
 *
 * The scheduling rules are in lib/weekly.ts (`reviewSchedule`), the decision
 * in lib/steer.ts, and the swap on roll day in lib/pending.ts. This file is the
 * part with a database behind it: gather the inputs, run the three, write down
 * what happened.
 */

import { sql } from "./db";
import {
  WEEKDAYS,
  addDays,
  aimNow,
  buildWeekPlan,
  normaliseDayType,
  planWeight,
  type Profile,
  type Review,
  type ReviewLimit,
  type ReviewTargets,
  type WeekPlan,
} from "./nutrition";
import { normaliseProfile } from "./profile";
import { applyDuePortions, stagePortions } from "./pending";
import { fitFromDb, MAX_MOVE } from "./refit";
import { bfNowOf, steerPlan, steerSignals } from "./steer";
import { planningBodyFat, reviewDayFor, reviewSchedule, rollFigures } from "./weekly";
import type { WeighIn } from "./trend";

/**
 * The profile row, with every date column formatted in SQL.
 *
 * The driver hands a `date` back as a Date at local midnight, which on a
 * machine east of Greenwich is the previous day in UTC — and the normaliser
 * reads UTC. `to_char` gives the day that was actually stored.
 */
export async function readProfile(userId: number): Promise<Profile | null> {
  const rows = (await sql`
    select *,
           to_char(phase_start, 'YYYY-MM-DD')      as phase_start,
           to_char(plan_updated_on, 'YYYY-MM-DD')  as plan_updated_on,
           to_char(dob, 'YYYY-MM-DD')              as dob,
           to_char(steer_moved_on, 'YYYY-MM-DD')   as steer_moved_on,
           to_char(next_apply_on, 'YYYY-MM-DD')    as next_apply_on,
           to_char(next_reviewed_on, 'YYYY-MM-DD') as next_reviewed_on
      from profile where id = ${userId}`) as any[];
  return rows[0] ? normaliseProfile(rows[0]) : null;
}

/** Every weigh-in the steer might read, up to and including `today`. */
async function readEntries(userId: number, today: string): Promise<WeighIn[]> {
  return (await sql`
    select to_char(day, 'YYYY-MM-DD') as day, weight_kg, tag, at_time, bf_pct, bf_method,
           muscle_kg, water_pct, bmr_kcal,
           seg_la_muscle_kg, seg_ra_muscle_kg, seg_tr_muscle_kg, seg_ll_muscle_kg, seg_rl_muscle_kg
      from weigh_ins
     where user_id = ${userId}
       and day > ${today}::date - 180 and day <= ${today}::date
     order by day`) as WeighIn[];
}

/** The week's average day, and the per-kilo settings behind it. */
function summarise(plan: WeekPlan, p: Profile): ReviewTargets {
  const days = WEEKDAYS.map((d) => plan.byId[plan.week[d]]).filter(Boolean);
  const n = days.length || 1;
  const avg = (k: "kcal" | "protein" | "carbs" | "fat") =>
    Math.round(days.reduce((a, t) => a + t[k], 0) / n);
  return {
    kcal: avg("kcal"),
    protein: avg("protein"),
    carbs: avg("carbs"),
    fat: avg("fat"),
    proteinPerKg: plan.macroShape.proteinPerKg,
    proteinBasis: p.protein_basis,
    fatPerKg: plan.macroShape.fatPerKg,
    weightKg: Math.round(planWeight(p) * 10) / 10,
    bfPct: planningBodyFat(p),
  };
}

/**
 * Decide next week and stage it.
 *
 * Returns what was decided, or null when there is not enough on the scale to
 * decide anything (fewer than three weigh-ins) or nothing to fit.
 *
 * `applyOn` is normally the coming roll day. When it is today — the late case,
 * see `reviewSchedule` — it comes into force before this returns.
 */
export async function runReview(
  userId: number,
  p: Profile,
  today: string,
  applyOn: string
): Promise<Review | null> {
  const [entries, dtRows] = await Promise.all([
    readEntries(userId, today),
    sql`select * from day_types where user_id = ${userId} order by sort_order, id`,
  ]);

  const figures = rollFigures(entries, today);
  if (!figures) return null;

  const dayTypes = (dtRows as any[]).map((d, i) => normaliseDayType(d, i));
  const before = buildWeekPlan(p, dayTypes);
  const { rate, comp } = steerSignals(entries);
  const steer = steerPlan(p, rate, comp, before.maintenance, { applyOn });

  // The scale's resting burn: the middle of the last three scans that gave one.
  const bmrs = entries
    .map((e: any) => Number(e.bmr_kcal))
    .filter((v) => Number.isFinite(v) && v > 800)
    .slice(-3)
    .sort((a, b) => a - b);
  const scaleBmr = bmrs.length ? bmrs[Math.floor(bmrs.length / 2)] : p.plan_bmr_kcal;

  const next: Profile = {
    ...p,
    plan_weight_kg: figures.weightKg,
    plan_bf_pct: figures.bodyFatPct ?? p.plan_bf_pct,
    plan_bmr_kcal: scaleBmr ?? null,
    recomp_adjust: steer.next,
  };
  const after = buildWeekPlan(next, dayTypes);

  // Fit the portions to next week's targets, anchored on this week's — "keep
  // it close" means close to the food actually being eaten. See lib/refit.ts.
  const fitted = await fitFromDb(userId, next, applyOn);
  const rows: { meal_id: number; slot: number; name: string; grams: number }[] = [];
  const held: string[] = [];
  const limits: ReviewLimit[] = [];
  let landsKcal: number | null = null;
  if (fitted) {
    const used = (fitted.days as any[]).filter((d) => d.weight > 0);
    const w = used.reduce((a, d) => a + d.weight, 0);
    if (w > 0) landsKcal = Math.round(used.reduce((a, d) => a + d.after.kcal * d.weight, 0) / w);

    // Whose limit is in the way, in terms the Plan page can act on. Only
    // plain portions — a cooked-ahead tray is one serving, and its limit is
    // the tray's, which the Rebalance dialog already knows how to move.
    // Never offered: taking a protein food under its floor. Those floors are
    // there on purpose — protein doesn't go down in a recomposition.
    for (const sg of fitted.suggestions
      .filter((x) => !(x.key === "protein" && x.direction === "down"))
      .slice(0, 3)) {
      const slot = (fitted.fit.slots as any[])[sg.index];
      if (!slot || slot.kind !== "item") continue;
      const meal = fitted.input.find((m) => m.id === slot.mealId);
      if (!meal) continue;
      limits.push({
        mealId: slot.mealId,
        slot: slot.index,
        meal: meal.name,
        name: sg.name,
        direction: sg.direction,
        from: Math.round(sg.from),
        to: Math.round(sg.to),
        key: sg.key,
        closes: Math.round(sg.closes),
        dayName: sg.dayName ?? null,
      });
    }

    const was = new Map<number, number>();
    for (const m of fitted.input) {
      for (const it of m.ingredients as any[]) was.set(Number(it.id), Number(it.grams));
    }
    for (const m of fitted.meals) {
      (m.ingredients as any[]).forEach((it, slot) => {
        const from = was.get(Number(it.id));
        const to = Math.round(Number(it.grams) * 10) / 10;
        if (from == null || !Number.isFinite(to) || to <= 0) return;
        if (from > 0 && Math.abs(to - from) / from > MAX_MOVE) {
          held.push(String(it.name));
          return;
        }
        rows.push({ meal_id: m.id, slot, name: String(it.name), grams: to });
      });
    }
  }
  await stagePortions(userId, rows, applyOn, "Weekly review");

  const aim = aimNow(p, bfNowOf(comp), steer.atTarget);
  const review: Review = {
    on: today,
    applyOn,
    headline: steer.headline,
    detail: steer.detail,
    tone: steer.tone,
    moving: steer.moving,
    decisive: steer.decisive,
    stepKcal: steer.kcal,
    totalKcal: steer.totalKcal,
    cooldownUntil: steer.cooldownUntil,
    from: summarise(before, p),
    to: summarise(after, next),
    weight: {
      kgPerWeek: rate ? Math.round(rate.kgPerWeek * 100) / 100 : null,
      seKgPerWeek: rate ? Math.round(rate.seKgPerWeek * 100) / 100 : null,
      aimKg: [
        Math.round((aim.weight[0] / 100) * figures.weightKg * 100) / 100,
        Math.round((aim.weight[1] / 100) * figures.weightKg * 100) / 100,
      ],
      reading: steer.weight,
    },
    bf: {
      ptsPerMonth: comp?.settled ? Math.round(comp.bfPtsPerMonth * 10) / 10 : null,
      sePtsPerMonth: comp?.settled ? Math.round(comp.bfSePtsPerMonth * 10) / 10 : null,
      aim: aim.bf,
      reading: steer.bf,
      settled: !!comp?.settled,
    },
    held,
    landsKcal,
    limits,
    atTarget: steer.atTarget,
  };

  await sql`
    update profile set
      next_apply_on       = ${applyOn}::date,
      next_reviewed_on    = ${today}::date,
      next_plan_weight_kg = ${next.plan_weight_kg},
      next_plan_bf_pct    = ${next.plan_bf_pct},
      next_plan_bmr_kcal  = ${next.plan_bmr_kcal},
      next_recomp_adjust  = ${next.recomp_adjust},
      next_review         = ${JSON.stringify(review)}::jsonb,
      updated_at = now()
    where id = ${userId}`;

  if (applyOn <= today) await applyDuePortions(userId, today);
  return review;
}

/**
 * Bring anything due into force, then run the review if it's time.
 *
 * Called on every profile read — a phone that opens the app is the only clock
 * this has, and on the other six days of the week it costs one comparison.
 * Never throws: a review that failed leaves this week's plan, which is the one
 * that was bought and cooked for.
 */
export async function reviewIfDue(userId: number, p: Profile, today: string): Promise<Profile> {
  try {
    let cur = p;
    if (cur.next_apply_on && cur.next_apply_on <= addDays(today, 1)) {
      await applyDuePortions(userId, today);
      cur = (await readProfile(userId)) ?? cur;
    }
    const s = reviewSchedule(cur, today);
    if (!s.due) return cur;
    await runReview(userId, cur, today, s.applyOn);
    return (await readProfile(userId)) ?? cur;
  } catch (e) {
    console.warn("weekly review skipped:", e);
    return p;
  }
}

/**
 * Re-run a waiting review because new weigh-in data arrived on review day.
 *
 * Only on the day itself: a Friday morning scan should count, a Saturday
 * evening weigh-in after the shop must not change what was bought. And not
 * after you chose to keep this week's plan — that was a decision too.
 */
export async function refreshReview(userId: number, today: string): Promise<void> {
  try {
    const p = await readProfile(userId);
    if (!p || !p.auto_roll || !p.next_apply_on || p.next_review?.dismissed) return;
    if (reviewDayFor(p, p.next_apply_on) !== today) return;
    await runReview(userId, p, today, p.next_apply_on);
  } catch (e) {
    console.warn("review refresh skipped:", e);
  }
}
