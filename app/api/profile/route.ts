import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { normaliseProfile } from "@/lib/profile";
import { seedAccount } from "@/lib/accounts";
import { applyRoll, rollState } from "@/lib/weekly";
import { refitPlan, restagePlan } from "@/lib/refit";
import { applyDayFor } from "@/lib/pending";
import { aimFor, buildWeekPlan, dayKey, legacyBlockAdjust, normaliseDayType } from "@/lib/nutrition";
import { STEER_LIMIT, steerPlan } from "@/lib/steer";
import { composition, weightRate } from "@/lib/trend";
import type { WeighIn } from "@/lib/trend";
import type { Profile } from "@/lib/nutrition";

export const dynamic = "force-dynamic";

/**
 * Roll the plan forward if shopping day has been and gone.
 *
 * This lives on the read rather than in a scheduled job because the app has no
 * scheduler and a phone that opens the page is the only reliable clock it has.
 * It is safe to sit here: it writes only when the snapshot is older than the
 * most recent shopping day, so the second and every later call on the same
 * week does nothing at all.
 *
 * It never runs without a trend behind it — three weigh-ins minimum — because
 * rebuilding a week's targets on one scale reading would be worse than leaving
 * last week's alone.
 */
async function rollIfDue(userId: number, p: Profile): Promise<Profile> {
  if (!p.auto_roll) return p;
  try {
    const rows = (await sql`
      select to_char(day, 'YYYY-MM-DD') as day, weight_kg, tag, at_time, bf_pct, bf_method,
             muscle_kg, water_pct
      from weigh_ins
      where user_id = ${userId} and day > current_date - 180
      order by day`) as any[];

    const entries = rows as WeighIn[];
    const state = rollState(p, entries);
    if (!state.due || !state.figures) return p;

    /**
     * The roll is also where the target gets steered.
     *
     * Same moment, on purpose. The snapshot decides what bodyweight the week
     * is built on and the steer decides how many calories that week gets, and
     * both have to land before the portions are re-fitted — otherwise the fit
     * runs against half a decision and Monday's numbers disagree with
     * Monday's shopping list. Maintenance for the step is read off the plan
     * as it stands *before* steering, so the size of a step never depends on
     * the size of the last one.
     */
    const dayTypes = (await sql`
      select * from day_types where user_id = ${userId} order by sort_order, id`) as any[];
    const before = buildWeekPlan(p, dayTypes.map((d, n) => normaliseDayType(d, n)));
    const steer = steerPlan(p, weightRate(entries), composition(entries), before.maintenance);

    const next = applyRoll(p, state.figures, state.dueOn, steer);
    await sql`
      update profile set
        plan_weight_kg = ${next.plan_weight_kg},
        plan_bf_pct = ${next.plan_bf_pct},
        plan_updated_on = ${next.plan_updated_on},
        recomp_adjust = ${next.recomp_adjust},
        updated_at = now()
      where id = ${userId}`;

    // Moving the targets without moving the plan leaves the two disagreeing,
    // and the gap only grows — so the roll re-fits the portions too, with the
    // same solver the Recalculate button uses.
    await refitPlan(userId, next, state.dueOn);
    return next;
  } catch (e) {
    // A failed roll must never take the page down — last week's numbers are a
    // perfectly good fallback, and they're the ones you shopped for.
    console.warn("weekly roll skipped:", e);
    return p;
  }
}

/**
 * Date columns are formatted in SQL, not in JavaScript.
 *
 * The driver hands a `date` back as a Date object at midnight *UTC*, so both
 * obvious things you might do to it are wrong: `String(d).slice(0, 10)` gives
 * "Sun Aug 30", and `toISOString().slice(0, 10)` gives the day before ours for
 * anywhere east of Greenwich in summer. `to_char` in the query gives the day
 * that was actually stored.
 */
export async function GET() {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const rows = await sql`
    select *,
           to_char(phase_start, 'YYYY-MM-DD') as phase_start,
           to_char(plan_updated_on, 'YYYY-MM-DD') as plan_updated_on,
           to_char(dob, 'YYYY-MM-DD') as dob
    from profile where id = ${who.id}`;

  // A profile row is created with the account, but an account made before this
  // route ever ran — or one whose seeding was interrupted — would otherwise
  // land on a blank page with no way back.
  if (!rows[0]) {
    await seedAccount(who.id);
    const made = await sql`select * from profile where id = ${who.id}`;
    return NextResponse.json(normaliseProfile(made[0] ?? {}));
  }

  const profile = await retireBlock(who.id, rows[0]);
  return NextResponse.json(await rollIfDue(who.id, profile));
}

/**
 * Move a profile off the old block and onto a pace — once, and without the
 * calories moving.
 *
 * A block walked the target from one percentage of maintenance to another
 * across a set number of weeks. A pace doesn't: the goal says where the
 * calories start and the steer moves them from what the scale does. Swapping
 * one for the other naively would jump the target by whatever the block had
 * reached, mid-week, against food already cooked. So the block's current value
 * is folded into the steer instead, and the week comes out the same.
 *
 * Differences under 1% of maintenance are dropped rather than carried. That is
 * the soft reset: a block a week or two into a gentle ramp was adding a few
 * dozen calories, and starting the new system from the goal's own starting
 * point is cleaner than carrying a residue nobody can explain.
 *
 * Runs per account on first read, keyed on `pace` being null, and writes the
 * pace in the same statement — so it cannot run twice for anyone.
 */
async function retireBlock(userId: number, raw: any) {
  if (raw.pace != null) return normaliseProfile(raw);

  const goalName = normaliseProfile(raw).goal;
  const was = legacyBlockAdjust(raw, dayKey());
  const diff = was - aimFor(goalName, "steady").adjust;
  const carry = Math.abs(diff) < 0.01 ? 0 : Math.max(-STEER_LIMIT, Math.min(STEER_LIMIT, diff));

  await sql`
    update profile set pace = 'steady', recomp_adjust = ${carry}, updated_at = now()
     where id = ${userId} and pace is null`;
  return normaliseProfile({ ...raw, pace: "steady", recomp_adjust: carry });
}

export async function PUT(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  // Normalise on the way in too, so a stale client can't write nonsense.
  const b = normaliseProfile(await req.json());
  const prev = (await sql`
    select *, to_char(plan_updated_on, 'YYYY-MM-DD') as plan_updated_on,
              to_char(dob, 'YYYY-MM-DD') as dob
      from profile where id = ${who.id}`) as any[];
  const before: string | null = prev[0]?.plan_updated_on ?? null;
  const targetsBefore = prev.length ? targetSignature(normaliseProfile(prev[0])) : null;
  const rows = await sql`
    update profile set
      sex = ${b.sex},
      dob = ${b.dob || null},
      height_cm = ${b.height_cm},
      weight_kg = ${b.weight_kg},
      body_fat_pct = ${b.body_fat_pct},
      activity = ${b.activity},
      goal = ${b.goal},
      pace = ${b.pace},
      protein_basis = ${b.protein_basis},
      protein_per_kg = ${b.protein_per_kg},
      fat_per_kg = ${b.fat_per_kg},
      calorie_override = ${b.calorie_override},
      cycling = ${b.cycling},
      energy_model = ${b.energy_model},
      base_activity = ${b.base_activity},
      week_ids = ${JSON.stringify(b.week)}::jsonb,
      calibrated_tdee = ${b.calibrated_tdee},
      use_calibration = ${b.use_calibration},
      shop_days = ${b.shop_days},
      shop_start_dow = ${b.shop_start_dow},
      plan_roll_dow = ${b.plan_roll_dow},
      plan_weight_kg = ${b.plan_weight_kg},
      plan_bf_pct = ${b.plan_bf_pct},
      plan_updated_on = ${b.plan_updated_on || null},
      recomp_adjust = ${b.recomp_adjust},
      auto_roll = ${b.auto_roll},
      periodise = ${b.periodise},
      updated_at = now()
    where id = ${who.id}
    returning *,
              to_char(plan_updated_on, 'YYYY-MM-DD') as plan_updated_on,
              to_char(dob, 'YYYY-MM-DD') as dob`;
  const next = normaliseProfile(rows[0]);

  /**
   * Rolling by hand has to do what rolling by itself does.
   *
   * The Progress page's Roll button writes the new snapshot straight through
   * this route, and because that stamps `plan_updated_on`, the automatic path
   * then sees nothing due and returns early forever after. The targets moved
   * and the portions never followed — the exact drift lib/refit.ts exists to
   * stop, reachable only by pressing the button that says it is rolling.
   */
  if (before && next.plan_updated_on && next.plan_updated_on !== before) {
    await refitPlan(who.id, next, next.plan_updated_on);
  }

  /**
   * A settings change has to reach the plan that is waiting, not just the one
   * in force. Staged portions were fitted to the targets as they stood when
   * the button was pressed; change fat per kg or protein or a session and
   * those targets no longer exist, but the staged grams sit there looking
   * authoritative and would come into force on Monday as an answer to a
   * question that had already changed.
   */
  if (targetsBefore && targetSignature(next) !== targetsBefore) {
    await restagePlan(
      who.id,
      next,
      applyDayFor(next.plan_roll_dow ?? next.shop_start_dow, dayKey())
    );
  }

  return NextResponse.json(next);
}

/**
 * Everything that moves a target. Compared before and after a save so that a
 * change to any of it can re-fit what is staged — and a change to a name, a
 * shopping day or a display preference doesn't.
 */
function targetSignature(p: Profile): string {
  return JSON.stringify([
    p.sex,
    p.dob,
    p.height_cm,
    p.weight_kg,
    p.body_fat_pct,
    p.activity,
    p.base_activity,
    p.energy_model,
    p.goal,
    p.pace,
    p.protein_basis,
    p.protein_per_kg,
    p.fat_per_kg,
    p.calorie_override,
    p.recomp_adjust,
    p.cycling,
    p.periodise,
    p.week,
    p.calibrated_tdee,
    p.use_calibration,
    p.plan_weight_kg,
    p.plan_bf_pct,
  ]);
}
