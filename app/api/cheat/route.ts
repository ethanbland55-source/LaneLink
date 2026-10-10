import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { completeCheat } from "@/lib/cheat";
import { readCheatDebt, readProfile, runReview } from "@/lib/review";
import { addDays, dayKey } from "@/lib/nutrition";
import { lastRollDay, rollDowOf } from "@/lib/weekly";

export const dynamic = "force-dynamic";

/**
 * Cheat meals for a window of days.
 *
 * A window rather than a single day because the page that shows one also has
 * to say whether this week's has been used — "one a week" is only meaningful
 * if you can see the week.
 */
export async function GET(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const rows =
    from && to
      ? await sql`
          select id, to_char(day, 'YYYY-MM-DD') as day, meal_id, name,
                 kcal, protein, carbs, fat, note
            from cheat_meals
           where user_id = ${who.id} and day between ${from}::date and ${to}::date
           order by day`
      : await sql`
          select id, to_char(day, 'YYYY-MM-DD') as day, meal_id, name,
                 kcal, protein, carbs, fat, note
            from cheat_meals
           where user_id = ${who.id} and day > current_date - 90
           order by day`;

  return NextResponse.json(
    (rows as any[]).map((r) => ({
      ...r,
      id: Number(r.id),
      meal_id: r.meal_id == null ? null : Number(r.meal_id),
      kcal: Number(r.kcal),
      protein: Number(r.protein),
      carbs: Number(r.carbs),
      fat: Number(r.fat),
    }))
  );
}

/**
 * Re-decide the week that pays for an extra cheat meal, if it is waiting.
 *
 * The first meal of the week is the allowance and changes nothing, so the
 * review is only re-run when there is a debt to pay or one to clear. It is the
 * same re-run a settings change gets — see app/api/profile/route.ts — and for
 * the same reason: staged portions describe the targets they were fitted to.
 * Not after you chose to keep this week's plan; that was a decision too.
 *
 * Re-run as of the day it was first decided, so the only thing that changes
 * is the payback: a weigh-in since then doesn't get to move the plan after
 * the shop, which is the rule `refreshReview` keeps too.
 */
async function restageFor(userId: number, day: string): Promise<void> {
  try {
    const today = dayKey();
    const p = await readProfile(userId);
    if (!p?.next_apply_on || p.next_apply_on <= today || p.next_review?.dismissed) return;
    if (day < addDays(p.next_apply_on, -7) || day >= p.next_apply_on) return;
    const debt = await readCheatDebt(userId, p.next_apply_on);
    if (debt.kcal <= 0 && !(p.next_payback_adjust ?? 0)) return;
    await runReview(userId, p, p.next_reviewed_on ?? today, p.next_apply_on);
  } catch (e) {
    console.warn("cheat payback re-run skipped:", e);
  }
}

/**
 * Record one, or replace the one already on that day.
 *
 * Macros are completed on the way in — a menu gives you calories and nothing
 * else, and refusing that entry would just mean the meal never gets logged at
 * all, which is the one outcome worse than an estimate.
 */
export async function PUT(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const b = await req.json();
  const day = String(b.day || "").slice(0, 10);
  if (!day) return NextResponse.json({ error: "day required" }, { status: 400 });

  /**
   * One a week, and the server says so. The single exception is the week
   * written into `extra_cheat_week` — a one-off granted by hand, which allows
   * a second and no more. The week after pays it back; see lib/review.ts.
   */
  const prof = await readProfile(who.id);
  if (prof) {
    const from = lastRollDay(rollDowOf(prof), day);
    const others = (await sql`
      select count(*)::int as n from cheat_meals
       where user_id = ${who.id} and day between ${from}::date and ${addDays(from, 6)}::date
         and day <> ${day}::date`) as any[];
    const n = Number(others[0]?.n ?? 0);
    const allowed = prof.extra_cheat_week === from ? 2 : 1;
    if (n + 1 > allowed) {
      return NextResponse.json(
        { error: "This week's cheat meal is already used." },
        { status: 409 }
      );
    }
  }

  const m = completeCheat(b);
  const rows = await sql`
    insert into cheat_meals (user_id, day, meal_id, name, kcal, protein, carbs, fat, note)
    values (${who.id}, ${day}::date,
            (select id from meals
              where id = ${b.meal_id == null ? null : Number(b.meal_id)}
                and user_id = ${who.id}),
            ${String(b.name || "Cheat meal").slice(0, 80)},
            ${m.kcal}, ${m.protein}, ${m.carbs}, ${m.fat},
            ${b.note ? String(b.note).slice(0, 200) : null})
    on conflict (user_id, day) do update
      set meal_id = excluded.meal_id,
          name    = excluded.name,
          kcal    = excluded.kcal,
          protein = excluded.protein,
          carbs   = excluded.carbs,
          fat     = excluded.fat,
          note    = excluded.note
    returning id, to_char(day, 'YYYY-MM-DD') as day, meal_id, name,
              kcal, protein, carbs, fat, note`;

  await restageFor(who.id, day);

  const r = rows[0] as any;
  return NextResponse.json({
    ...r,
    id: Number(r.id),
    meal_id: r.meal_id == null ? null : Number(r.meal_id),
    kcal: Number(r.kcal),
    protein: Number(r.protein),
    carbs: Number(r.carbs),
    fat: Number(r.fat),
  });
}

export async function DELETE(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const day = new URL(req.url).searchParams.get("day");
  if (!day) return NextResponse.json({ error: "day required" }, { status: 400 });
  await sql`delete from cheat_meals where user_id = ${who.id} and day = ${day}::date`;
  await restageFor(who.id, day.slice(0, 10));
  return NextResponse.json({ ok: true });
}
