import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSchema();
  const rows = await sql`select * from profile where id = 1`;
  return NextResponse.json(rows[0] ?? null);
}

export async function PUT(req: Request) {
  await ensureSchema();
  const b = await req.json();
  const rows = await sql`
    update profile set
      sex = ${b.sex},
      dob = ${b.dob || null},
      height_cm = ${b.height_cm},
      weight_kg = ${b.weight_kg},
      activity = ${b.activity},
      goal = ${b.goal},
      protein_per_kg = ${b.protein_per_kg},
      fat_per_kg = ${b.fat_per_kg},
      calorie_override = ${b.calorie_override ?? null},
      updated_at = now()
    where id = 1
    returning *`;
  return NextResponse.json(rows[0]);
}
