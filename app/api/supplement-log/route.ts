import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** What was taken on a day. */
export async function GET(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const day = new URL(req.url).searchParams.get("day");
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return NextResponse.json([]);
  const rows = await sql`
    select supplement_id, taken, at_time
    from supplement_log where user_id = ${who.id} and day = ${day}`;
  return NextResponse.json(
    rows.map((r: any) => ({
      supplement_id: Number(r.supplement_id),
      taken: Number(r.taken),
      at_time: r.at_time ?? null,
    }))
  );
}

/**
 * Tick one off, or untick it.
 *
 * `taken` is a count rather than a flag because a supplement can be taken more
 * than once a day, and "did you take the second one" is a different question
 * from "did you take it".
 */
export async function PUT(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const b = await req.json();
  const day = String(b?.day ?? "").slice(0, 10);
  const id = Number(b?.supplement_id);
  const taken = Math.max(0, Math.round(Number(b?.taken) || 0));

  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(id)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (taken <= 0) {
    await sql`
      delete from supplement_log
       where user_id = ${who.id} and day = ${day} and supplement_id = ${id}`;
    return NextResponse.json({ supplement_id: id, taken: 0, at_time: null });
  }

  const at = typeof b?.at_time === "string" && /^\d{2}:\d{2}$/.test(b.at_time) ? b.at_time : null;
  const rows = await sql`
    insert into supplement_log (user_id, day, supplement_id, taken, at_time)
    values (${who.id}, ${day}, ${id}, ${taken}, ${at})
    on conflict (day, supplement_id) do update set
      taken = ${taken}, at_time = coalesce(${at}, supplement_log.at_time)
    returning supplement_id, taken, at_time`;
  const r = rows[0] as any;
  return NextResponse.json({
    supplement_id: Number(r.supplement_id),
    taken: Number(r.taken),
    at_time: r.at_time ?? null,
  });
}
