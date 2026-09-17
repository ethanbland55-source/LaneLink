import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { parseClock, type Tag } from "@/lib/trend";
import { plausibleBf } from "@/lib/bodyfat";
import { EXTRA_KEYS, SEGMENT_KEYS, plausible, plausibleSegment } from "@/lib/scan";

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
    ...Object.fromEntries(
      EXTRA_KEYS.map((k) => [k, r[k] == null ? null : Number(r[k])])
    ),
    ...Object.fromEntries(
      SEGMENT_KEYS.map((k) => [k, r[k] == null ? null : Number(r[k])])
    ),
  };
}

/**
 * A weigh-in is a weight on most days, and a scan on two of them.
 *
 * It used to carry a waist, a neck, a set of hips and five skinfold sites,
 * because the app was trying to derive a body fat percentage from measurements
 * anyone could take. It derives nothing now — the scale measures it, you type
 * what it says, and everything downstream reads that. The old columns are
 * still on the table and old readings still hold whatever they held; nothing
 * writes to them any more and nothing reads them.
 *
 * A scan is body fat plus whatever else the scale showed that morning — see
 * lib/scan.ts for the list and for which of them the app actually reads.
 */
export async function GET(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const days = Math.min(365, Math.max(7, Number(new URL(req.url).searchParams.get("days")) || 120));
  const rows = await sql`
    select to_char(day, 'YYYY-MM-DD') as day, weight_kg, tag, at_time, bf_pct, bf_method, note,
           muscle_kg, water_pct, bone_kg, visceral_fat, subq_fat_pct, skeletal_pct,
           protein_pct, bmr_kcal, body_age,
           seg_la_muscle_kg, seg_la_fat_kg, seg_ra_muscle_kg, seg_ra_fat_kg,
           seg_tr_muscle_kg, seg_tr_fat_kg, seg_ll_muscle_kg, seg_ll_fat_kg,
           seg_rl_muscle_kg, seg_rl_fat_kg
    from weigh_ins
    where user_id = ${who.id} and day > current_date - ${days}::int
    order by day`;
  return NextResponse.json(rows.map(row));
}

/**
 * One entry per day, and a write only touches the fields it actually sends.
 *
 * Weight and body fat share a row — lean mass is one multiplied by the other,
 * so storing them apart would let them end up describing different mornings —
 * but they are entered in two different places, on two different rhythms.
 * Weight is daily and can be any hour; a scan is Monday and Saturday, first
 * thing, and only means anything under those conditions.
 *
 * That makes a full-row replace the wrong shape. Saving Monday's scan would
 * blank the weight typed at breakfast, and saving Tuesday's weight would blank
 * a scan that never gets retaken. So a key absent from the body leaves that
 * column exactly as it was, and a key present as null clears it — which is
 * what emptying the box on its own card should do, and only that.
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

  const sent = (k: string) => Object.prototype.hasOwnProperty.call(b ?? {}, k);

  // Whatever is already there. The merge happens here rather than in SQL
  // because "leave this one alone" written as a conditional upsert is the kind
  // of query nobody can read twice and be sure of.
  const before = (await sql`
    select weight_kg, tag, at_time, bf_pct, bf_method, note,
           muscle_kg, water_pct, bone_kg, visceral_fat, subq_fat_pct, skeletal_pct,
           protein_pct, bmr_kcal, body_age,
           seg_la_muscle_kg, seg_la_fat_kg, seg_ra_muscle_kg, seg_ra_fat_kg,
           seg_tr_muscle_kg, seg_tr_fat_kg, seg_ll_muscle_kg, seg_ll_fat_kg,
           seg_rl_muscle_kg, seg_rl_fat_kg
      from weigh_ins where user_id = ${who.id} and day = ${day}`) as any[];
  const had = before[0];

  const w = sent("weight_kg")
    ? num(b.weight_kg, 20, 400)
    : had?.weight_kg == null
      ? null
      : Number(had.weight_kg);

  const at = sent("at_time") ? clock(b.at_time) : (had?.at_time ?? null);

  // A typed tag still wins when there's no clock time; with one, the time
  // decides, so the two can never contradict each other.
  const tag: Tag = at
    ? tagForHour(parseClock(at) ?? 7)
    : TAGS.includes(b?.tag)
      ? b.tag
      : TAGS.includes(had?.tag)
        ? had.tag
        : "morning";

  const bfPct = sent("bf_pct")
    ? plausibleBf(b.bf_pct)
    : had?.bf_pct == null
      ? null
      : Number(had.bf_pct);

  const note = sent("note") ? (b.note ?? null) : (had?.note ?? null);

  // The rest of the scan, key by key on the same rule. And none of it
  // survives without body fat: the extras describe a scan, and a scan with no
  // body fat on it isn't one — clearing the percentage clears the lot.
  const x: Record<string, number | null> = {};
  for (const k of EXTRA_KEYS) {
    x[k] =
      bfPct == null
        ? null
        : sent(k)
          ? plausible(k, b[k])
          : had?.[k] == null
            ? null
            : Number(had[k]);
  }

  // The five segments, on exactly the same rule — including "no body fat means
  // no scan means none of this", which is what makes clearing the percentage
  // clear the whole morning rather than leaving ten orphaned limb figures.
  for (const k of SEGMENT_KEYS) {
    x[k] =
      bfPct == null
        ? null
        : sent(k)
          ? plausibleSegment(b[k])
          : had?.[k] == null
            ? null
            : Number(had[k]);
  }

  // Nothing left in the row at all, so there is no row.
  if (w == null && bfPct == null) {
    await sql`delete from weigh_ins where user_id = ${who.id} and day = ${day}`;
    return NextResponse.json({ ok: true, removed: true });
  }

  const method = bfPct == null ? null : "scan";
  const rows = await sql`
    insert into weigh_ins (user_id, day, weight_kg, tag, at_time, bf_pct, bf_method, note,
                           muscle_kg, water_pct, bone_kg, visceral_fat, subq_fat_pct,
                           skeletal_pct, protein_pct, bmr_kcal, body_age,
                           seg_la_muscle_kg, seg_la_fat_kg, seg_ra_muscle_kg, seg_ra_fat_kg,
                           seg_tr_muscle_kg, seg_tr_fat_kg, seg_ll_muscle_kg, seg_ll_fat_kg,
                           seg_rl_muscle_kg, seg_rl_fat_kg)
    values (${who.id}, ${day}, ${w}, ${tag}, ${at}, ${bfPct}, ${method}, ${note},
            ${x.muscle_kg}, ${x.water_pct}, ${x.bone_kg}, ${x.visceral_fat}, ${x.subq_fat_pct},
            ${x.skeletal_pct}, ${x.protein_pct}, ${x.bmr_kcal}, ${x.body_age},
            ${x.seg_la_muscle_kg}, ${x.seg_la_fat_kg}, ${x.seg_ra_muscle_kg}, ${x.seg_ra_fat_kg},
            ${x.seg_tr_muscle_kg}, ${x.seg_tr_fat_kg}, ${x.seg_ll_muscle_kg}, ${x.seg_ll_fat_kg},
            ${x.seg_rl_muscle_kg}, ${x.seg_rl_fat_kg})
    on conflict (user_id, day) do update set
      weight_kg = ${w}, tag = ${tag}, at_time = ${at}, bf_pct = ${bfPct},
      bf_method = ${method}, note = ${note},
      muscle_kg = ${x.muscle_kg}, water_pct = ${x.water_pct}, bone_kg = ${x.bone_kg},
      visceral_fat = ${x.visceral_fat}, subq_fat_pct = ${x.subq_fat_pct},
      skeletal_pct = ${x.skeletal_pct}, protein_pct = ${x.protein_pct},
      bmr_kcal = ${x.bmr_kcal}, body_age = ${x.body_age},
      seg_la_muscle_kg = ${x.seg_la_muscle_kg}, seg_la_fat_kg = ${x.seg_la_fat_kg},
      seg_ra_muscle_kg = ${x.seg_ra_muscle_kg}, seg_ra_fat_kg = ${x.seg_ra_fat_kg},
      seg_tr_muscle_kg = ${x.seg_tr_muscle_kg}, seg_tr_fat_kg = ${x.seg_tr_fat_kg},
      seg_ll_muscle_kg = ${x.seg_ll_muscle_kg}, seg_ll_fat_kg = ${x.seg_ll_fat_kg},
      seg_rl_muscle_kg = ${x.seg_rl_muscle_kg}, seg_rl_fat_kg = ${x.seg_rl_fat_kg}
    returning to_char(day, 'YYYY-MM-DD') as day, weight_kg, tag, at_time, bf_pct, bf_method, note,
              muscle_kg, water_pct, bone_kg, visceral_fat, subq_fat_pct, skeletal_pct,
              protein_pct, bmr_kcal, body_age,
              seg_la_muscle_kg, seg_la_fat_kg, seg_ra_muscle_kg, seg_ra_fat_kg,
              seg_tr_muscle_kg, seg_tr_fat_kg, seg_ll_muscle_kg, seg_ll_fat_kg,
              seg_rl_muscle_kg, seg_rl_fat_kg`;

  /**
   * Keep the profile's figure pointed at the newest scan.
   *
   * It exists so a brand new account has something to build a protein target
   * from before its first weekly roll, after which `plan_bf_pct` takes over
   * and this stops being read.
   *
   * Recomputed from the table rather than written from `bfPct`, because the
   * write that needs handling most is the one that removes a figure. Mirroring
   * only on the way in meant a mistyped 34%, noticed and cleared ten seconds
   * later, stayed on the profile and went on setting the protein target until
   * the next roll — the correction had nowhere to land. Asking the table for
   * its latest scan answers every case the same way: a new scan, an older day
   * typed in late, a scan deleted.
   *
   * The coalesce is the one deliberate asymmetry. With no scans left at all it
   * keeps whatever is there — a figure from before scans existed — because
   * clearing a weigh-in is not a request to erase it.
   */
  if (sent("bf_pct")) {
    await sql`
      update profile set body_fat_pct = coalesce(
        (select w.bf_pct from weigh_ins w
          where w.user_id = ${who.id} and w.bf_method = 'scan'
          order by w.day desc limit 1),
        body_fat_pct
      )
      where id = ${who.id}`;
  }

  return NextResponse.json(row(rows[0]));
}
