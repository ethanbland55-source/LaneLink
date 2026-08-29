import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** What you already have in, so the shopping list can subtract it. */
export async function GET() {
  await ensureSchema();
  const rows = await sql`select * from pantry order by name`;
  return NextResponse.json(rows.map((r: any) => ({ ...r, grams: Number(r.grams) })));
}

export async function PUT(req: Request) {
  await ensureSchema();
  const { name, grams } = await req.json();
  const clean = String(name ?? "").trim();
  if (!clean) return NextResponse.json({ ok: false }, { status: 400 });

  const g = Number(grams);
  if (!Number.isFinite(g) || g <= 0) {
    await sql`delete from pantry where name = ${clean}`;
    return NextResponse.json({ ok: true, removed: true });
  }

  const rows = await sql`
    insert into pantry (name, grams) values (${clean}, ${g})
    on conflict (name) do update set grams = ${g}, updated_at = now()
    returning *`;
  return NextResponse.json({ ...rows[0], grams: Number(rows[0].grams) });
}

export async function DELETE(req: Request) {
  await ensureSchema();
  const name = new URL(req.url).searchParams.get("name") ?? "";
  await sql`delete from pantry where name = ${name}`;
  return NextResponse.json({ ok: true });
}
