import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** All meals with their ingredients, ordered. */
export async function GET() {
  await ensureSchema();
  const meals = await sql`select * from meals order by sort_order, id`;
  const ings = await sql`select * from ingredients order by sort_order, id`;
  return NextResponse.json(
    meals.map((m: any) => ({
      ...m,
      ingredients: ings.filter((i: any) => i.meal_id === m.id),
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
  return NextResponse.json({ ...rows[0], ingredients: [] });
}

/** Replaces a meal's name and its whole ingredient list in one go. */
export async function PUT(req: Request) {
  await ensureSchema();
  const { id, name, ingredients } = await req.json();
  await sql`update meals set name = ${name} where id = ${id}`;
  await sql`delete from ingredients where meal_id = ${id}`;
  for (const [n, i] of (ingredients ?? []).entries()) {
    await sql`
      insert into ingredients
        (meal_id, name, grams, kcal_100, protein_100, carbs_100, fat_100, sort_order)
      values (${id}, ${i.name || "Ingredient"}, ${num(i.grams)}, ${num(i.kcal_100)},
              ${num(i.protein_100)}, ${num(i.carbs_100)}, ${num(i.fat_100)}, ${n})`;
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
