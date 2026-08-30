import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { totalFor, type Item } from "@/lib/nutrition";

export const dynamic = "force-dynamic";

/** "7:5" -> "07:05". Anything that isn't a clock time comes back null. */
function clock(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!(h >= 0 && h < 24 && min >= 0 && min < 60)) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  await ensureSchema();
  const day = new URL(req.url).searchParams.get("day");
  const rows = day
    ? await sql`select * from log_entries where day = ${day}
                order by at_time nulls last, id`
    : await sql`select * from log_entries order by id desc limit 100`;
  return NextResponse.json(rows);
}

/** Add a meal to today's log, pre-filled from the plan. */
export async function POST(req: Request) {
  await ensureSchema();
  const { day, meal_id, meal_name, items, day_type_id, at_time } = await req.json();
  const t = totalFor((items ?? []) as Item[]);
  const dt = Number(day_type_id);
  const rows = await sql`
    insert into log_entries (day, meal_id, meal_name, confirmed, kcal, protein, carbs, fat, items, day_type_id, at_time)
    values (${day}, ${meal_id ?? null}, ${meal_name}, false,
            ${t.kcal}, ${t.protein}, ${t.carbs}, ${t.fat},
            ${JSON.stringify(items ?? [])}::jsonb, ${Number.isFinite(dt) && dt > 0 ? dt : null},
            ${clock(at_time)})
    returning *`;
  return NextResponse.json(rows[0]);
}

/** Edit gram amounts and/or confirm the meal. */
export async function PATCH(req: Request) {
  await ensureSchema();
  const { id, items, confirmed, at_time } = await req.json();
  const t = totalFor((items ?? []) as Item[]);
  // at_time is only written when the caller sends one, so confirming a meal
  // can't wipe the time it was eaten at.
  const at = clock(at_time);
  const rows = await sql`
    update log_entries set
      items = ${JSON.stringify(items ?? [])}::jsonb,
      kcal = ${t.kcal}, protein = ${t.protein}, carbs = ${t.carbs}, fat = ${t.fat},
      confirmed = ${!!confirmed},
      at_time = coalesce(${at}, at_time)
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
