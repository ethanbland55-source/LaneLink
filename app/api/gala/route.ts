import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { buildWeekPlan, normaliseDayType } from "@/lib/nutrition";
import { readGalaDays, readProfile, restageForCheat } from "@/lib/review";

export const dynamic = "force-dynamic";

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Gala days between two dates, with the carbohydrate each carried over a
 * normal day — the figure the scale correction in lib/gala.ts runs on.
 */
export async function GET(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!isDay(from) || !isDay(to)) {
    return NextResponse.json({ error: "from and to required" }, { status: 400 });
  }

  const [p, dtRows] = await Promise.all([
    readProfile(who.id),
    sql`select * from day_types where user_id = ${who.id} order by sort_order, id`,
  ]);
  if (!p) return NextResponse.json([]);
  const plan = buildWeekPlan(
    p,
    (dtRows as any[]).map((d, i) => normaliseDayType(d, i))
  );
  return NextResponse.json(await readGalaDays(who.id, from, to, plan));
}

/** Turn a day into a gala day, or back. `base_day_type_id` is the day it's built on. */
export async function PUT(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const b = await req.json();
  const day = String(b.day || "").slice(0, 10);
  if (!isDay(day)) return NextResponse.json({ error: "day required" }, { status: 400 });

  if (b.on) {
    const base = Number(b.base_day_type_id);
    await sql`
      insert into gala_days (user_id, day, base_day_type_id)
      values (${who.id}, ${day}::date,
              (select id from day_types where id = ${Number.isFinite(base) ? base : null}
                 and user_id = ${who.id}))
      on conflict (user_id, day) do update set base_day_type_id = excluded.base_day_type_id`;
  } else {
    await sql`delete from gala_days where user_id = ${who.id} and day = ${day}::date`;
  }

  // Whether a meal out that day is the week's free one or a debt depends on
  // this, so a waiting payback may need deciding again.
  await restageForCheat(who.id, day);
  return NextResponse.json({ day, on: !!b.on });
}
