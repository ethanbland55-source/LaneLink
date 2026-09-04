import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { normaliseDayType } from "@/lib/nutrition";
import { normaliseSessions } from "@/lib/activities";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const rows = await sql`
    select * from day_types where user_id = ${who.id} order by sort_order, id`;
  return NextResponse.json(rows.map((r: any, i: number) => normaliseDayType(r, i)));
}

export async function POST(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const { name } = await req.json().catch(() => ({ name: null }));
  const rows = await sql`
    insert into day_types (user_id, name, sort_order, sessions)
    values (${who.id},
            ${String(name ?? "New day type").slice(0, 40)},
            coalesce((select max(sort_order) + 1 from day_types where user_id = ${who.id}), 0),
            '[]'::jsonb)
    returning *`;
  return NextResponse.json(normaliseDayType(rows[0]));
}

export async function PUT(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const b = await req.json();
  const id = Number(b?.id);
  if (!Number.isFinite(id)) return NextResponse.json({ ok: false }, { status: 400 });

  const d = normaliseDayType({ ...b, sessions: normaliseSessions(b?.sessions) });
  const rows = await sql`
    update day_types set
      name = ${d.name},
      sort_order = ${d.sort_order},
      sessions = ${JSON.stringify(d.sessions)}::jsonb,
      fixed_kcal = ${d.fixed_kcal},
      percent = ${d.percent}
    where id = ${id} and user_id = ${who.id}
    returning *`;
  if (!rows[0]) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json(normaliseDayType(rows[0]));
}

/**
 * Deleting a day type must not strand anything that pointed at it: meals lose
 * the reference (falling back to "every day"), and any weekday using it is
 * moved to the first remaining type.
 */
export async function DELETE(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isFinite(id)) return NextResponse.json({ ok: false }, { status: 400 });

  const all = (await sql`
    select id from day_types where user_id = ${who.id} order by sort_order, id`) as any[];
  if (all.length <= 1) {
    return NextResponse.json(
      { ok: false, error: "You need at least one day type." },
      { status: 400 }
    );
  }
  const fallback = Number(all.find((r) => Number(r.id) !== id)?.id);

  await sql`delete from day_types where id = ${id} and user_id = ${who.id}`;
  await sql`
    update meals
    set day_type_ids = nullif(array_remove(day_type_ids, ${id}::int), '{}'::int[])
    where user_id = ${who.id} and day_type_ids is not null`;

  const prof = (await sql`select week_ids from profile where id = ${who.id}`) as any[];
  const week = (prof[0]?.week_ids ?? {}) as Record<string, number>;
  let changed = false;
  for (const k of Object.keys(week)) {
    if (Number(week[k]) === id) {
      week[k] = fallback;
      changed = true;
    }
  }
  if (changed) {
    await sql`
      update profile set week_ids = ${JSON.stringify(week)}::jsonb where id = ${who.id}`;
  }

  return NextResponse.json({ ok: true });
}
