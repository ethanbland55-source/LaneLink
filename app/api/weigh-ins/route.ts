import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { parseClock, type Tag } from "@/lib/trend";
import { plausibleBf } from "@/lib/bodyfat";

export const dynamic = "force-dynamic";

const TAGS: Tag[] = ["morning", "evening", "other"];

function num(v: unknown, lo: number, hi: number): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

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

/** The tag a clock time falls in, so old readings and new ones stay comparable. */
function tagForHour(hour: number): Tag {
  if (hour < 11) return "morning";
  if (hour < 17) return "other";
  return "evening";
}

function row(r: any) {
  return {
    day: r.day,
    weight_kg: r.weight_kg == null ? null : Number(r.weight_kg),
    tag: (TAGS.includes(r.tag) ? r.tag : "morning") as Tag,
    at_time: r.at_time ?? null,
    bf_pct: r.bf_pct == null ? null : Number(r.bf_pct),
    // Carried so the trend can tell a scan from a retired tape estimate — see
    // `isScan` in lib/trend.ts.
    bf_method: r.bf_method ?? null,
    note: r.note ?? null,
  };
}

/**
 * A weigh-in is two numbers now, and on most days only one of them.
 *
 * It used to be nine: a waist, a neck, a set of hips and five skinfold sites,
 * because the app was trying to derive a body fat percentage from measurements
 * anyone could take. It derives nothing now — the scale measures it, you type
 * what it says, and everything downstream reads that. The old columns are
 * still on the table and old readings still hold whatever they held; nothing
 * writes to them any more and nothing reads them.
 */
export async function GET(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const days = Math.min(365, Math.max(7, Number(new URL(req.url).searchParams.get("days")) || 120));
  const rows = await sql`
    select to_char(day, 'YYYY-MM-DD') as day, weight_kg, tag, at_time, bf_pct, bf_method, note
    from weigh_ins
    where user_id = ${who.id} and day > current_date - ${days}::int
    order by day`;
  return NextResponse.json(rows.map(row));
}

/**
 * One entry per day; writing again replaces it.
 *
 * Weight most days, body fat on the two you scan. They share a row because
 * they were taken in the same moment on the same scale — and because lean mass
 * is one multiplied by the other, so storing them apart would let them end up
 * describing different mornings.
 */
export async function PUT(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const b = await req.json();
  const day = String(b?.day ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const w = num(b?.weight_kg, 20, 400);
  const at = clock(b?.at_time);
  // A typed tag still wins when there's no clock time; with one, the time
  // decides, so the two can never contradict each other.
  const tag: Tag = at ? tagForHour(parseClock(at) ?? 7) : TAGS.includes(b?.tag) ? b.tag : "morning";
  const bfPct = plausibleBf(b?.bf_pct);

  if (w == null && bfPct == null) {
    await sql`delete from weigh_ins where user_id = ${who.id} and day = ${day}`;
    return NextResponse.json({ ok: true, removed: true });
  }

  const rows = await sql`
    insert into weigh_ins (user_id, day, weight_kg, tag, at_time, bf_pct, bf_method, note)
    values (${who.id}, ${day}, ${w}, ${tag}, ${at}, ${bfPct},
            ${bfPct == null ? null : "scan"}, ${b?.note ?? null})
    on conflict (user_id, day) do update set
      weight_kg = ${w}, tag = ${tag}, at_time = ${at}, bf_pct = ${bfPct},
      bf_method = ${bfPct == null ? null : "scan"}, note = ${b?.note ?? null}
    returning to_char(day, 'YYYY-MM-DD') as day, weight_kg, tag, at_time, bf_pct, bf_method, note`;

  // Mirror the scan onto the profile so a brand new account has a body fat
  // figure to build a protein target from before its first weekly roll. Only
  // ever moves forward: a reading typed in for an older day can't overwrite
  // what a newer one already said.
  if (bfPct != null) {
    await sql`
      update profile set body_fat_pct = ${bfPct}
      where id = ${who.id}
        and not exists (
          select 1 from weigh_ins
           where user_id = ${who.id} and bf_method = 'scan' and day > ${day}::date
        )`;
  }

  return NextResponse.json(row(rows[0]));
}
