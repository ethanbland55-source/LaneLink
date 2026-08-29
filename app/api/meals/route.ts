import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { profileFor } from "@/lib/foods";

export const dynamic = "force-dynamic";

/** All meals with their ingredients, ordered. */
export async function GET() {
  await ensureSchema();
  const meals = await sql`select * from meals order by sort_order, id`;
  const ings = await sql`select * from ingredients order by sort_order, id`;
  return NextResponse.json(
    meals.map((m: any) => ({
      ...m,
      times_per_day: Number(m.times_per_day ?? 1),
      day_type_ids: (m.day_type_ids ?? null) as number[] | null,
      ingredients: ings
        .filter((i: any) => i.meal_id === m.id)
        .map((i: any) => ({
          ...i,
          grams: Number(i.grams),
          kcal_100: Number(i.kcal_100),
          protein_100: Number(i.protein_100),
          carbs_100: Number(i.carbs_100),
          fat_100: Number(i.fat_100),
          fibre_100: Number(i.fibre_100 ?? 0),
          min_grams: i.min_grams == null ? null : Number(i.min_grams),
          max_grams: i.max_grams == null ? null : Number(i.max_grams),
        })),
    }))
  );
}

export async function POST(req: Request) {
  await ensureSchema();
  const { name } = await req.json();
  const rows = await sql`
    insert into meals (name, sort_order)
    values (${name || "New meal"}, coalesce((select max(sort_order) + 1 from meals), 0))
    returning *`;
  return NextResponse.json({ ...rows[0], times_per_day: 1, day_type_ids: null, ingredients: [] });
}

/** Replaces a meal's name and its whole ingredient list in one go. */
export async function PUT(req: Request) {
  await ensureSchema();
  const { id, name, ingredients, times_per_day, day_type_ids } = await req.json();

  const reps = Number(times_per_day);

  // null means "every day type". Anything pointing at a day type that no
  // longer exists is dropped here rather than left to rot in the array.
  const live = (await sql`select id from day_types`) as any[];
  const liveIds = new Set(live.map((r) => Number(r.id)));
  const picked: number[] = Array.isArray(day_type_ids)
    ? [...new Set(day_type_ids.map(Number).filter((n: number) => liveIds.has(n)))]
    : [];
  // Sent as an explicit array literal and cast, rather than relying on the
  // driver to infer int[] from a JS array.
  const types: string | null =
    picked.length > 0 && picked.length < liveIds.size ? `{${picked.join(",")}}` : null;

  await sql`
    update meals set
      name = ${name},
      times_per_day = ${Number.isFinite(reps) && reps > 0 ? reps : 1},
      day_type_ids = ${types}::int[]
    where id = ${id}`;

  await sql`delete from ingredients where meal_id = ${id}`;
  for (const [n, i] of (ingredients ?? []).entries()) {
    // Classify on write so the shopping list never has to guess later.
    const cls = profileFor(i.name ?? "", {
      kcal_100: num(i.kcal_100),
      protein_100: num(i.protein_100),
      carbs_100: num(i.carbs_100),
      fat_100: num(i.fat_100),
    });
    await sql`
      insert into ingredients
        (meal_id, name, grams, kcal_100, protein_100, carbs_100, fat_100, fibre_100,
         fibre_estimated, food_class, aisle, pack_grams,
         min_grams, max_grams, locked, sort_order)
      values (${id}, ${i.name || "Ingredient"}, ${num(i.grams)}, ${num(i.kcal_100)},
              ${num(i.protein_100)}, ${num(i.carbs_100)}, ${num(i.fat_100)}, ${num(i.fibre_100)},
              ${!!i.fibre_estimated}, ${cls.cls}, ${cls.aisle}, ${cls.packGrams},
              ${i.min_grams == null ? null : num(i.min_grams)},
              ${i.max_grams == null ? null : num(i.max_grams)},
              ${!!i.locked}, ${n})`;
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  await ensureSchema();
  const id = Number(new URL(req.url).searchParams.get("id"));
  await sql`delete from meals where id = ${id}`;
  return NextResponse.json({ ok: true });
}

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
