import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { normaliseProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSchema();
  const rows = await sql`select * from profile where id = 1`;
  return NextResponse.json(normaliseProfile(rows[0] ?? {}));
}

export async function PUT(req: Request) {
  await ensureSchema();
  // Normalise on the way in too, so a stale client can't write nonsense.
  const b = normaliseProfile(await req.json());
  const rows = await sql`
    update profile set
      sex = ${b.sex},
      dob = ${b.dob || null},
      height_cm = ${b.height_cm},
      weight_kg = ${b.weight_kg},
      body_fat_pct = ${b.body_fat_pct},
      bf_source = ${b.bf_source},
      neck_cm = ${b.neck_cm},
      hip_cm = ${b.hip_cm},
      waist_cm = ${b.waist_cm},
      activity = ${b.activity},
      goal = ${b.goal},
      protein_basis = ${b.protein_basis},
      protein_per_kg = ${b.protein_per_kg},
      fat_per_kg = ${b.fat_per_kg},
      calorie_override = ${b.calorie_override},
      carb_floor_per_kg = ${b.carb_floor_per_kg},
      cycling = ${b.cycling},
      energy_model = ${b.energy_model},
      base_activity = ${b.base_activity},
      week_ids = ${JSON.stringify(b.week)}::jsonb,
      phase_name = ${b.phase_name || null},
      phase_start = ${b.phase_start || null},
      phase_weeks = ${b.phase_weeks},
      phase_start_adjust = ${b.phase_start_adjust},
      phase_end_adjust = ${b.phase_end_adjust},
      calibrated_tdee = ${b.calibrated_tdee},
      use_calibration = ${b.use_calibration},
      shop_days = ${b.shop_days},
      shop_start_dow = ${b.shop_start_dow},
      updated_at = now()
    where id = 1
    returning *`;
  return NextResponse.json(normaliseProfile(rows[0]));
}
