import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { TIMING_LABEL, type SuppTiming, type SuppUnit } from "@/lib/supplements";

export const dynamic = "force-dynamic";

const UNITS: SuppUnit[] = ["g", "mg", "mcg", "IU", "capsule", "scoop", "ml"];

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function row(r: any) {
  return {
    id: Number(r.id),
    name: String(r.name),
    dose: Number(r.dose),
    unit: (UNITS.includes(r.unit) ? r.unit : "g") as SuppUnit,
    timing: (r.timing in TIMING_LABEL ? r.timing : "anytime") as SuppTiming,
    meal_id: r.meal_id == null ? null : Number(r.meal_id),
    day_type_ids: (r.day_type_ids ?? null) as number[] | null,
    times_per_day: Number(r.times_per_day ?? 1),
    kcal: Number(r.kcal),
    protein: Number(r.protein),
    carbs: Number(r.carbs),
    fat: Number(r.fat),
    note: r.note ?? null,
    sort_order: Number(r.sort_order ?? 0),
  };
}

export async function GET() {
  await ensureSchema();
  const rows = await sql`select * from supplements order by sort_order, id`;
  return NextResponse.json(rows.map(row));
}

export async function POST(req: Request) {
  await ensureSchema();
  const b = await req.json();
  const rows = await sql`
    insert into supplements
      (name, dose, unit, timing, times_per_day, kcal, protein, carbs, fat, note, sort_order)
    values (${String(b?.name ?? "Supplement").slice(0, 60)}, ${num(b?.dose)},
            ${UNITS.includes(b?.unit) ? b.unit : "g"},
            ${b?.timing in TIMING_LABEL ? b.timing : "anytime"},
            ${Math.max(1, num(b?.times_per_day, 1))},
            ${num(b?.kcal)}, ${num(b?.protein)}, ${num(b?.carbs)}, ${num(b?.fat)},
            ${b?.note ?? null},
            coalesce((select max(sort_order) + 1 from supplements), 0))
    returning *`;
  return NextResponse.json(row(rows[0]));
}

export async function PUT(req: Request) {
  await ensureSchema();
  const b = await req.json();
  const id = Number(b?.id);
  if (!Number.isFinite(id)) return NextResponse.json({ ok: false }, { status: 400 });

  // Day types that no longer exist are dropped here rather than left to rot.
  const live = (await sql`select id from day_types`) as any[];
  const liveIds = new Set(live.map((r) => Number(r.id)));
  const picked: number[] = Array.isArray(b?.day_type_ids)
    ? [...new Set<number>(b.day_type_ids.map(Number).filter((n: number) => liveIds.has(n)))]
    : [];
  const types: string | null =
    picked.length > 0 && picked.length < liveIds.size ? `{${picked.join(",")}}` : null;

  const mealId = Number(b?.meal_id);

  const rows = await sql`
    update supplements set
      name = ${String(b?.name ?? "Supplement").slice(0, 60)},
      dose = ${num(b?.dose)},
      unit = ${UNITS.includes(b?.unit) ? b.unit : "g"},
      timing = ${b?.timing in TIMING_LABEL ? b.timing : "anytime"},
      meal_id = ${Number.isFinite(mealId) && mealId > 0 ? mealId : null},
      day_type_ids = ${types}::int[],
      times_per_day = ${Math.max(1, num(b?.times_per_day, 1))},
      kcal = ${num(b?.kcal)},
      protein = ${num(b?.protein)},
      carbs = ${num(b?.carbs)},
      fat = ${num(b?.fat)},
      note = ${b?.note ?? null}
    where id = ${id}
    returning *`;
  return NextResponse.json(row(rows[0]));
}

export async function DELETE(req: Request) {
  await ensureSchema();
  const id = Number(new URL(req.url).searchParams.get("id"));
  await sql`delete from supplements where id = ${id}`;
  return NextResponse.json({ ok: true });
}
