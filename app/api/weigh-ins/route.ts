import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await ensureSchema();
  const days = Math.min(365, Math.max(7, Number(new URL(req.url).searchParams.get("days")) || 120));
  const rows = await sql`
    select to_char(day, 'YYYY-MM-DD') as day, weight_kg, waist_cm, note
    from weigh_ins
    where day > current_date - ${days}::int
    order by day`;
  return NextResponse.json(
    rows.map((r: any) => ({
      day: r.day,
      weight_kg: r.weight_kg == null ? null : Number(r.weight_kg),
      waist_cm: r.waist_cm == null ? null : Number(r.waist_cm),
      note: r.note ?? null,
    }))
  );
}

/** One entry per day; writing again replaces it. */
export async function PUT(req: Request) {
  await ensureSchema();
  const b = await req.json();
  const day = String(b?.day ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const w = Number(b?.weight_kg);
  const waist = Number(b?.waist_cm);
  const weight = Number.isFinite(w) && w > 20 && w < 400 ? w : null;
  const cm = Number.isFinite(waist) && waist > 30 && waist < 250 ? waist : null;

  if (weight == null && cm == null) {
    await sql`delete from weigh_ins where day = ${day}`;
    return NextResponse.json({ ok: true, removed: true });
  }

  const rows = await sql`
    insert into weigh_ins (day, weight_kg, waist_cm, note)
    values (${day}, ${weight}, ${cm}, ${b?.note ?? null})
    on conflict (day) do update set
      weight_kg = ${weight}, waist_cm = ${cm}, note = ${b?.note ?? null}
    returning to_char(day, 'YYYY-MM-DD') as day, weight_kg, waist_cm, note`;

  const r: any = rows[0];
  return NextResponse.json({
    day: r.day,
    weight_kg: r.weight_kg == null ? null : Number(r.weight_kg),
    waist_cm: r.waist_cm == null ? null : Number(r.waist_cm),
    note: r.note ?? null,
  });
}

export async function DELETE(req: Request) {
  await ensureSchema();
  const day = new URL(req.url).searchParams.get("day") ?? "";
  await sql`delete from weigh_ins where day = ${day}`;
  return NextResponse.json({ ok: true });
}
