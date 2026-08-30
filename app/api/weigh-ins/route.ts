import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { DEFAULT_WAIST_OFFSET, type Tag } from "@/lib/trend";

export const dynamic = "force-dynamic";

const TAGS: Tag[] = ["morning", "evening", "other"];

function row(r: any) {
  return {
    day: r.day,
    weight_kg: r.weight_kg == null ? null : Number(r.weight_kg),
    waist_cm: r.waist_cm == null ? null : Number(r.waist_cm),
    tag: (TAGS.includes(r.tag) ? r.tag : "morning") as Tag,
    note: r.note ?? null,
  };
}

export async function GET(req: Request) {
  await ensureSchema();
  const days = Math.min(365, Math.max(7, Number(new URL(req.url).searchParams.get("days")) || 120));
  const rows = await sql`
    select to_char(day, 'YYYY-MM-DD') as day, weight_kg, waist_cm, tag, note
    from weigh_ins
    where day > current_date - ${days}::int
    order by day`;
  return NextResponse.json(rows.map(row));
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
  const tag: Tag = TAGS.includes(b?.tag) ? b.tag : "morning";

  if (weight == null && cm == null) {
    await sql`delete from weigh_ins where day = ${day}`;
    return NextResponse.json({ ok: true, removed: true });
  }

  const rows = await sql`
    insert into weigh_ins (day, weight_kg, waist_cm, tag, note)
    values (${day}, ${weight}, ${cm}, ${tag}, ${b?.note ?? null})
    on conflict (day) do update set
      weight_kg = ${weight}, waist_cm = ${cm}, tag = ${tag}, note = ${b?.note ?? null}
    returning to_char(day, 'YYYY-MM-DD') as day, weight_kg, waist_cm, tag, note`;

  // Mirror the waist onto the profile, corrected to morning-equivalent, so the
  // tape body fat estimate follows the measurement without a second entry
  // point. Only ever moves forward — an older reading typed in later doesn't
  // overwrite a newer one.
  if (cm != null) {
    const corrected = cm - (DEFAULT_WAIST_OFFSET[tag] ?? 0);
    await sql`
      update profile set waist_cm = ${corrected}
      where id = 1
        and not exists (
          select 1 from weigh_ins
          where waist_cm is not null and day > ${day}::date
        )`;
  }

  return NextResponse.json(row(rows[0]));
}

export async function DELETE(req: Request) {
  await ensureSchema();
  const day = new URL(req.url).searchParams.get("day") ?? "";
  await sql`delete from weigh_ins where day = ${day}`;
  return NextResponse.json({ ok: true });
}
