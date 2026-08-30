import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import {
  DEFAULT_WAIST_RISE_PER_HOUR,
  TAG_HOUR,
  hoursAwake,
  parseClock,
  riseAt,
  type Tag,
} from "@/lib/trend";
import { navyBodyFat, skinfoldBodyFat, type BfMethod } from "@/lib/bodyfat";
import { ageFromDob } from "@/lib/nutrition";

export const dynamic = "force-dynamic";

const TAGS: Tag[] = ["morning", "evening", "other"];
const METHODS: BfMethod[] = ["tape", "skinfold", "manual"];

/** Every measurement a weigh-in can carry, and the sane range for each. */
const SITES: Record<string, [number, number]> = {
  waist_cm: [30, 250],
  neck_cm: [20, 90],
  hip_cm: [50, 250],
  sf_chest: [1, 80],
  sf_abdomen: [1, 80],
  sf_thigh: [1, 80],
  sf_tricep: [1, 80],
  sf_suprailiac: [1, 80],
};

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
  const out: any = {
    day: r.day,
    weight_kg: r.weight_kg == null ? null : Number(r.weight_kg),
    waist_cm: r.waist_cm == null ? null : Number(r.waist_cm),
    tag: (TAGS.includes(r.tag) ? r.tag : "morning") as Tag,
    at_time: r.at_time ?? null,
    bf_pct: r.bf_pct == null ? null : Number(r.bf_pct),
    bf_method: r.bf_method ?? null,
    note: r.note ?? null,
  };
  for (const k of Object.keys(SITES)) {
    if (k === "waist_cm") continue;
    out[k] = r[k] == null ? null : Number(r[k]);
  }
  return out;
}

const COLUMNS = `to_char(day, 'YYYY-MM-DD') as day, weight_kg, waist_cm, tag, at_time,
                 neck_cm, hip_cm, sf_chest, sf_abdomen, sf_thigh, sf_tricep,
                 sf_suprailiac, bf_pct, bf_method, note`;

export async function GET(req: Request) {
  await ensureSchema();
  const days = Math.min(365, Math.max(7, Number(new URL(req.url).searchParams.get("days")) || 120));
  const rows = await sql`
    select to_char(day, 'YYYY-MM-DD') as day, weight_kg, waist_cm, tag, at_time,
           neck_cm, hip_cm, sf_chest, sf_abdomen, sf_thigh, sf_tricep,
           sf_suprailiac, bf_pct, bf_method, note
    from weigh_ins
    where day > current_date - ${days}::int
    order by day`;
  return NextResponse.json(rows.map(row));
}

/**
 * One entry per day; writing again replaces it.
 *
 * Body fat is worked out here rather than in the browser so the stored figure
 * and the one on screen can never disagree — and so a measurement typed on a
 * phone still lands a number the weekly roll can read.
 */
export async function PUT(req: Request) {
  await ensureSchema();
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

  const m: Record<string, number | null> = {};
  for (const [k, [lo, hi]] of Object.entries(SITES)) m[k] = num(b?.[k], lo, hi);

  const anything = w != null || Object.values(m).some((v) => v != null);
  if (!anything) {
    await sql`delete from weigh_ins where day = ${day}`;
    return NextResponse.json({ ok: true, removed: true });
  }

  // --- Body fat, from whichever measurements are actually here -------------
  const prof = (await sql`select sex, dob, height_cm, weight_kg from profile where id = 1`) as any[];
  const p = prof[0] ?? {};
  const sex = p.sex === "female" ? "female" : "male";
  const weightForBf = w ?? (Number(p.weight_kg) || 0);

  const wanted: BfMethod | null = METHODS.includes(b?.bf_method) ? b.bf_method : null;
  let bfPct: number | null = null;
  let bfMethod: BfMethod | null = null;

  if (wanted === "manual") {
    bfPct = num(b?.bf_pct, 3, 60);
    bfMethod = bfPct != null ? "manual" : null;
  } else {
    const skin =
      sex === "female"
        ? [m.sf_tricep, m.sf_suprailiac, m.sf_thigh]
        : [m.sf_chest, m.sf_abdomen, m.sf_thigh];

    if (wanted !== "tape" && skin.every((v) => v != null)) {
      const est = skinfoldBodyFat({
        sex,
        ageYears: ageFromDob(p.dob ? String(p.dob).slice(0, 10) : null),
        sites: skin as number[],
        weightKg: weightForBf,
      });
      if (est) {
        bfPct = est.pct;
        bfMethod = "skinfold";
      }
    }

    if (bfPct == null && m.waist_cm != null && m.neck_cm != null) {
      const est = navyBodyFat({
        sex,
        heightCm: Number(p.height_cm) || 0,
        neckCm: m.neck_cm,
        waistCm: m.waist_cm,
        hipCm: m.hip_cm,
        weightKg: weightForBf,
      });
      if (est) {
        bfPct = est.pct;
        bfMethod = "tape";
      }
    }
  }

  const rows = await sql`
    insert into weigh_ins
      (day, weight_kg, waist_cm, tag, at_time, neck_cm, hip_cm, sf_chest,
       sf_abdomen, sf_thigh, sf_tricep, sf_suprailiac, bf_pct, bf_method, note)
    values (${day}, ${w}, ${m.waist_cm}, ${tag}, ${at}, ${m.neck_cm}, ${m.hip_cm},
            ${m.sf_chest}, ${m.sf_abdomen}, ${m.sf_thigh}, ${m.sf_tricep},
            ${m.sf_suprailiac}, ${bfPct}, ${bfMethod}, ${b?.note ?? null})
    on conflict (day) do update set
      weight_kg = ${w}, waist_cm = ${m.waist_cm}, tag = ${tag}, at_time = ${at},
      neck_cm = ${m.neck_cm}, hip_cm = ${m.hip_cm}, sf_chest = ${m.sf_chest},
      sf_abdomen = ${m.sf_abdomen}, sf_thigh = ${m.sf_thigh},
      sf_tricep = ${m.sf_tricep}, sf_suprailiac = ${m.sf_suprailiac},
      bf_pct = ${bfPct}, bf_method = ${bfMethod}, note = ${b?.note ?? null}
    returning to_char(day, 'YYYY-MM-DD') as day, weight_kg, waist_cm, tag, at_time,
              neck_cm, hip_cm, sf_chest, sf_abdomen, sf_thigh, sf_tricep,
              sf_suprailiac, bf_pct, bf_method, note`;

  // Mirror the tape onto the profile, corrected to morning-equivalent, so the
  // settings page and the estimate agree without a second entry point. Only
  // ever moves forward — an older reading typed in later can't overwrite a
  // newer one.
  const hours = hoursAwake(parseClock(at) ?? TAG_HOUR[tag]);
  if (m.waist_cm != null) {
    const corrected = m.waist_cm - riseAt(hours, DEFAULT_WAIST_RISE_PER_HOUR);
    await sql`
      update profile set waist_cm = ${corrected}
      where id = 1
        and not exists (
          select 1 from weigh_ins where waist_cm is not null and day > ${day}::date
        )`;
  }
  if (m.neck_cm != null) {
    await sql`update profile set neck_cm = ${m.neck_cm} where id = 1`;
  }
  if (m.hip_cm != null) {
    await sql`update profile set hip_cm = ${m.hip_cm} where id = 1`;
  }
  // Deliberately not touching profile.bf_source or body_fat_pct. The figure
  // the plan uses comes from the latest weigh-in that has one, via the weekly
  // roll — squeezing "calipers" into a three-value profile column here would
  // only give the two paths a way to disagree.

  return NextResponse.json(row(rows[0]));
}
