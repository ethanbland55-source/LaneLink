import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { completeCheat } from "@/lib/cheat";

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
  return NextResponse.json({ ok: true });
}
