import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { totalFor, type Item } from "@/lib/nutrition";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await ensureSchema();
  const day = new URL(req.url).searchParams.get("day");
  const rows = day
    ? await sql`select * from log_entries where day = ${day} order by id`
    : await sql`select * from log_entries order by id desc limit 100`;
  return NextResponse.json(rows);
}

/** Add a meal to today's log, pre-filled from the plan. */
export async function POST(req: Request) {
  await ensureSchema();
  const { day, meal_id, meal_name, items, day_type } = await req.json();
  const t = totalFor((items ?? []) as Item[]);
  const rows = await sql`
    insert into log_entries (day, meal_id, meal_name, confirmed, kcal, protein, carbs, fat, items, day_type)
    values (${day}, ${meal_id ?? null}, ${meal_name}, false,
            ${t.kcal}, ${t.protein}, ${t.carbs}, ${t.fat},
            ${JSON.stringify(items ?? [])}::jsonb, ${day_type ?? null})
    returning *`;
  return NextResponse.json(rows[0]);
}

/** Edit gram amounts and/or confirm the meal. */
export async function PATCH(req: Request) {
  await ensureSchema();
  const { id, items, confirmed } = await req.json();
  const t = totalFor((items ?? []) as Item[]);
  const rows = await sql`
    update log_entries set
      items = ${JSON.stringify(items ?? [])}::jsonb,
      kcal = ${t.kcal}, protein = ${t.protein}, carbs = ${t.carbs}, fat = ${t.fat},
      confirmed = ${!!confirmed}
    where id = ${id}
    returning *`;
  return NextResponse.json(rows[0]);
}

export async function DELETE(req: Request) {
  await ensureSchema();
  const id = Number(new URL(req.url).searchParams.get("id"));
  await sql`delete from log_entries where id = ${id}`;
  return NextResponse.json({ ok: true });
}
