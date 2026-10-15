import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { completeCheat } from "@/lib/cheat";
import { readProfile, restageForCheat } from "@/lib/review";
import { addDays } from "@/lib/nutrition";
import { lastRollDay, rollDowOf } from "@/lib/weekly";

export const dynamic = "force-dynamic";

const shape = (r: any) => ({
  ...r,
  id: Number(r.id),
  meal_id: r.meal_id == null ? null : Number(r.meal_id),
  kcal: Number(r.kcal),
  protein: Number(r.protein),
  carbs: Number(r.carbs),
  fat: Number(r.fat),
});

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
           order by day, slot, id`
      : await sql`
          select id, to_char(day, 'YYYY-MM-DD') as day, meal_id, name,
                 kcal, protein, carbs, fat, note
            from cheat_meals
           where user_id = ${who.id} and day > current_date - 90
           order by day, slot, id`;

  return NextResponse.json((rows as any[]).map(shape));
}

/**
 * Record one, edit one, or replace the one already on that day.
 *
 * Macros are completed on the way in — a menu gives you calories and nothing
 * else, and refusing that entry would just mean the meal never gets logged at
 * all, which is the one outcome worse than an estimate.
 *
 * - With an `id`: that meal, edited.
 * - On a gala day: a new one, however many there already are.
 * - Otherwise: today's one, replaced — one a week, and the server says so. The
 *   single exception is the week written into `extra_cheat_week`, a one-off
 *   granted by hand, which allows a second and no more. Meals out on gala days
 *   don't use the week's allowance. The week after pays for extras; see
 *   lib/review.ts.
 */
export async function PUT(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const b = await req.json();
  const day = String(b.day || "").slice(0, 10);
  if (!day) return NextResponse.json({ error: "day required" }, { status: 400 });

  const m = completeCheat(b);
  const mealId = b.meal_id == null ? null : Number(b.meal_id);
  const name = String(b.name || "Cheat meal").slice(0, 80);
  const note = b.note ? String(b.note).slice(0, 200) : null;
  const id = Number(b.id);

  let rows: any[];
  if (Number.isFinite(id) && id > 0) {
    rows = (await sql`
      update cheat_meals set
        meal_id = (select id from meals where id = ${mealId} and user_id = ${who.id}),
        name = ${name}, kcal = ${m.kcal}, protein = ${m.protein},
        carbs = ${m.carbs}, fat = ${m.fat}, note = ${note}
      where id = ${id} and user_id = ${who.id}
      returning id, to_char(day, 'YYYY-MM-DD') as day, meal_id, name,
                kcal, protein, carbs, fat, note`) as any[];
    if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  } else {
    const galaRows = (await sql`
      select 1 from gala_days where user_id = ${who.id} and day = ${day}::date`) as any[];
    const gala = galaRows.length > 0;

    if (gala) {
      rows = (await sql`
        insert into cheat_meals (user_id, day, slot, meal_id, name, kcal, protein, carbs, fat, note)
        values (${who.id}, ${day}::date,
                (select coalesce(max(slot) + 1, 0) from cheat_meals
                  where user_id = ${who.id} and day = ${day}::date),
                (select id from meals where id = ${mealId} and user_id = ${who.id}),
                ${name}, ${m.kcal}, ${m.protein}, ${m.carbs}, ${m.fat}, ${note})
        returning id, to_char(day, 'YYYY-MM-DD') as day, meal_id, name,
                  kcal, protein, carbs, fat, note`) as any[];
    } else {
      const prof = await readProfile(who.id);
      if (prof) {
        const from = lastRollDay(rollDowOf(prof), day);
        const others = (await sql`
          select count(*)::int as n from cheat_meals
           where user_id = ${who.id} and day between ${from}::date and ${addDays(from, 6)}::date
             and day <> ${day}::date
             and day not in (select day from gala_days where user_id = ${who.id})`) as any[];
        const n = Number(others[0]?.n ?? 0);
        const allowed = prof.extra_cheat_week === from ? 2 : 1;
        if (n + 1 > allowed) {
          return NextResponse.json(
            { error: "This week's cheat meal is already used." },
            { status: 409 }
          );
        }
      }

      rows = (await sql`
        insert into cheat_meals (user_id, day, slot, meal_id, name, kcal, protein, carbs, fat, note)
        values (${who.id}, ${day}::date, 0,
                (select id from meals where id = ${mealId} and user_id = ${who.id}),
                ${name}, ${m.kcal}, ${m.protein}, ${m.carbs}, ${m.fat}, ${note})
        on conflict (user_id, day, slot) do update
          set meal_id = excluded.meal_id,
              name    = excluded.name,
              kcal    = excluded.kcal,
              protein = excluded.protein,
              carbs   = excluded.carbs,
              fat     = excluded.fat,
              note    = excluded.note
        returning id, to_char(day, 'YYYY-MM-DD') as day, meal_id, name,
                  kcal, protein, carbs, fat, note`) as any[];
    }
  }

  const saved = shape(rows[0]);
  await restageForCheat(who.id, saved.day);
  return NextResponse.json(saved);
}

/** One meal by `id`, or everything on a `day`. */
export async function DELETE(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  const day = url.searchParams.get("day");

  if (Number.isFinite(id) && id > 0) {
    const gone = (await sql`
      delete from cheat_meals where id = ${id} and user_id = ${who.id}
      returning to_char(day, 'YYYY-MM-DD') as day`) as any[];
    if (gone[0]) await restageForCheat(who.id, gone[0].day);
    return NextResponse.json({ ok: true });
  }
  if (!day) return NextResponse.json({ error: "id or day required" }, { status: 400 });
  await sql`delete from cheat_meals where user_id = ${who.id} and day = ${day}::date`;
  await restageForCheat(who.id, day.slice(0, 10));
  return NextResponse.json({ ok: true });
}
