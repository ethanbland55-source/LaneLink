import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { normaliseProfile } from "@/lib/profile";
import { applyDayFor, discardPending, listPending, stagePortions } from "@/lib/pending";
import { dayKey } from "@/lib/nutrition";

export const dynamic = "force-dynamic";

/** What is waiting, and the day it comes into force. */
export async function GET() {
  await ensureSchema();
  const rows = await listPending();
  return NextResponse.json({
    portions: rows,
    applyOn: rows[0]?.apply_on ?? null,
    count: rows.length,
  });
}

/**
 * Stage a recalculation.
 *
 * The body is the fitted plan; the day it applies on is worked out here rather
 * than trusted from the client, because that day is a property of the profile
 * and not something a stale tab should get to decide.
 */
export async function POST(req: Request) {
  await ensureSchema();
  const body = await req.json();

  const prof = await sql`select * from profile where id = 1`;
  const profile = normaliseProfile(prof[0] ?? {});
  const applyOn = applyDayFor(profile.plan_roll_dow ?? profile.shop_start_dow, dayKey());

  const rows = Array.isArray(body?.portions) ? body.portions : [];
  const count = await stagePortions(
    rows.map((r: any) => ({
      ingredient_id: Number(r.ingredient_id ?? r.id),
      grams: Number(r.grams),
    })),
    applyOn,
    typeof body?.note === "string" ? body.note : undefined
  );

  return NextResponse.json({ count, applyOn });
}

/** Throw the staged changes away. The live plan is untouched either way. */
export async function DELETE() {
  await ensureSchema();
  await discardPending();
  return NextResponse.json({ ok: true });
}
