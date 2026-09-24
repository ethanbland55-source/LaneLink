import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { normaliseProfile } from "@/lib/profile";
import { seedAccount } from "@/lib/accounts";
import { restagePlan } from "@/lib/refit";
import { applyDayFor } from "@/lib/pending";
import { readProfile, reviewIfDue, runReview } from "@/lib/review";
import { stagedProfile } from "@/lib/weekly";
import { aimFor, dayKey, legacyBlockAdjust } from "@/lib/nutrition";
import { STEER_LIMIT } from "@/lib/steer";
import type { Profile } from "@/lib/nutrition";

export const dynamic = "force-dynamic";

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
           to_char(dob, 'YYYY-MM-DD') as dob,
           to_char(steer_moved_on, 'YYYY-MM-DD') as steer_moved_on,
           to_char(next_apply_on, 'YYYY-MM-DD') as next_apply_on,
           to_char(next_reviewed_on, 'YYYY-MM-DD') as next_reviewed_on
    from profile where id = ${who.id}`;

  // A profile row is created with the account, but an account made before this
  // route ever ran — or one whose seeding was interrupted — would otherwise
  // land on a blank page with no way back.
  if (!rows[0]) {
    await seedAccount(who.id);
    const made = await sql`select * from profile where id = ${who.id}`;
    return NextResponse.json(normaliseProfile(made[0] ?? {}));
  }

  /**
   * The weekly review lives on the read, not in a scheduled job, because the
   * app has no scheduler and a phone that opens the page is the only reliable
   * clock it has. On the other six days it costs one comparison. See
   * lib/review.ts, and lib/weekly.ts for when it runs.
   */
  const profile = await retireBlock(who.id, rows[0]);
  return NextResponse.json(await reviewIfDue(who.id, profile, dayKey()));
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
  const prev = await readProfile(who.id);
  const targetsBefore = prev ? targetSignature(prev) : null;
  await sql`
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
      adapt_macros = ${b.adapt_macros},
      auto_roll = ${b.auto_roll},
      bf_target_pct = ${b.bf_target_pct},
      periodise = ${b.periodise},
      updated_at = now()
    where id = ${who.id}`;
  let next = (await readProfile(who.id)) ?? b;

  /**
   * A settings change has to reach the plan that is waiting, not just the one
   * in force. Staged portions were fitted to the targets as they stood when
   * they were staged; change fat per kg or protein or a session and those
   * targets no longer exist, but the staged grams sit there looking
   * authoritative and would come into force on Monday as an answer to a
   * question that had already changed.
   *
   * A waiting weekly review is re-run whole, so its decision, its targets and
   * its portions all describe the settings as they now are. A rebalance you
   * staged by hand is re-fitted, keeping its day.
   */
  if (targetsBefore && targetSignature(next) !== targetsBefore) {
    if (next.next_apply_on && !next.next_review?.dismissed) {
      try {
        await runReview(who.id, next, dayKey(), next.next_apply_on);
      } catch (e) {
        console.warn("review re-run skipped:", e);
      }
      next = (await readProfile(who.id)) ?? next;
    } else {
      await restagePlan(
        who.id,
        stagedProfile(next),
        next.next_apply_on ?? applyDayFor(next.plan_roll_dow ?? next.shop_start_dow, dayKey())
      );
    }
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
    p.bf_target_pct,
    p.protein_basis,
    p.protein_per_kg,
    p.fat_per_kg,
    p.calorie_override,
    p.recomp_adjust,
    p.adapt_macros,
    p.cycling,
    p.periodise,
    p.week,
    p.calibrated_tdee,
    p.use_calibration,
    p.plan_weight_kg,
    p.plan_bf_pct,
  ]);
}
