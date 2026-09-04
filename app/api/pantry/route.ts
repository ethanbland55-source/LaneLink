import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** What you already have in, so the shopping list can subtract it. */
export async function GET() {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const rows = await sql`select * from pantry where user_id = ${who.id} order by name`;
  return NextResponse.json(rows.map((r: any) => ({ ...r, grams: Number(r.grams) })));
}

export async function PUT(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const { name, grams } = await req.json();
  const clean = String(name ?? "").trim();
  if (!clean) return NextResponse.json({ ok: false }, { status: 400 });

  const g = Number(grams);
  if (!Number.isFinite(g) || g <= 0) {
    await sql`delete from pantry where user_id = ${who.id} and name = ${clean}`;
    return NextResponse.json({ ok: true, removed: true });
  }

  const rows = await sql`
    insert into pantry (user_id, name, grams) values (${who.id}, ${clean}, ${g})
    on conflict (user_id, name) do update set grams = ${g}, updated_at = now()
    returning *`;
  return NextResponse.json({ ...rows[0], grams: Number(rows[0].grams) });
}

export async function DELETE(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const name = new URL(req.url).searchParams.get("name") ?? "";
  await sql`delete from pantry where user_id = ${who.id} and name = ${name}`;
  return NextResponse.json({ ok: true });
}
