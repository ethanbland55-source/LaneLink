import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { normaliseProfile } from "@/lib/profile";
import { applyRoll, rollState } from "@/lib/weekly";
import { refitPlan, restagePlan } from "@/lib/refit";
import { applyDayFor } from "@/lib/pending";
import { dayKey } from "@/lib/nutrition";
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
async function rollIfDue(p: Profile): Promise<Profile> {
  if (!p.auto_roll) return p;
  try {
    const rows = (await sql`
      select to_char(day, 'YYYY-MM-DD') as day, weight_kg, waist_cm, tag, at_time, bf_pct
      from weigh_ins
      where day > current_date - 180
      order by day`) as any[];

    const state = rollState(p, rows as WeighIn[]);
    if (!state.due || !state.figures) return p;

    const next = applyRoll(p, state.figures, state.dueOn);
    await sql`
      update profile set
        plan_weight_kg = ${next.plan_weight_kg},
        plan_bf_pct = ${next.plan_bf_pct},
        plan_updated_on = ${next.plan_updated_on},
        updated_at = now()
      where id = 1`;

    // Moving the targets without moving the plan leaves the two disagreeing,
    // and the gap only grows — so the roll re-fits the portions too, with the
    // same solver the Recalculate button uses.
    await refitPlan(next, state.dueOn);
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
  const rows = await sql`
    select *,
           to_char(phase_start, 'YYYY-MM-DD') as phase_start,
           to_char(plan_updated_on, 'YYYY-MM-DD') as plan_updated_on,
           to_char(dob, 'YYYY-MM-DD') as dob
    from profile where id = 1`;
  const profile = normaliseProfile(rows[0] ?? {});
  return NextResponse.json(await rollIfDue(profile));
}

export async function PUT(req: Request) {
  await ensureSchema();
  // Normalise on the way in too, so a stale client can't write nonsense.
  const b = normaliseProfile(await req.json());
  const prev = (await sql`
    select *, to_char(plan_updated_on, 'YYYY-MM-DD') as plan_updated_on,
              to_char(phase_start, 'YYYY-MM-DD') as phase_start,
              to_char(dob, 'YYYY-MM-DD') as dob
      from profile where id = 1`) as any[];
  const before: string | null = prev[0]?.plan_updated_on ?? null;
  const targetsBefore = prev.length ? targetSignature(normaliseProfile(prev[0])) : null;
  const rows = await sql`
    update profile set
      sex = ${b.sex},
      dob = ${b.dob || null},
      height_cm = ${b.height_cm},
      weight_kg = ${b.weight_kg},
      body_fat_pct = ${b.body_fat_pct},
      bf_source = ${b.bf_source},
      neck_cm = ${b.neck_cm},
      hip_cm = ${b.hip_cm},
      waist_cm = ${b.waist_cm},
      activity = ${b.activity},
      goal = ${b.goal},
      protein_basis = ${b.protein_basis},
      protein_per_kg = ${b.protein_per_kg},
      fat_per_kg = ${b.fat_per_kg},
      calorie_override = ${b.calorie_override},
      carb_floor_per_kg = ${b.carb_floor_per_kg},
      cycling = ${b.cycling},
      energy_model = ${b.energy_model},
      base_activity = ${b.base_activity},
      week_ids = ${JSON.stringify(b.week)}::jsonb,
      phase_name = ${b.phase_name || null},
      phase_start = ${b.phase_start || null},
      phase_weeks = ${b.phase_weeks},
      phase_start_adjust = ${b.phase_start_adjust},
      phase_end_adjust = ${b.phase_end_adjust},
      calibrated_tdee = ${b.calibrated_tdee},
      use_calibration = ${b.use_calibration},
      shop_days = ${b.shop_days},
      shop_start_dow = ${b.shop_start_dow},
      plan_roll_dow = ${b.plan_roll_dow},
      plan_weight_kg = ${b.plan_weight_kg},
      plan_bf_pct = ${b.plan_bf_pct},
      plan_updated_on = ${b.plan_updated_on || null},
      auto_roll = ${b.auto_roll},
      periodise = ${b.periodise},
      updated_at = now()
    where id = 1
    returning *,
              to_char(phase_start, 'YYYY-MM-DD') as phase_start,
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
    await refitPlan(next, next.plan_updated_on);
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
    await restagePlan(next, applyDayFor(next.plan_roll_dow ?? next.shop_start_dow, dayKey()));
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
    p.bf_source,
    p.activity,
    p.base_activity,
    p.energy_model,
    p.goal,
    p.protein_basis,
    p.protein_per_kg,
    p.fat_per_kg,
    p.carb_floor_per_kg,
    p.calorie_override,
    p.cycling,
    p.periodise,
    p.week,
    p.phase_start,
    p.phase_weeks,
    p.phase_start_adjust,
    p.phase_end_adjust,
    p.calibrated_tdee,
    p.use_calibration,
    p.plan_weight_kg,
    p.plan_bf_pct,
  ]);
}
