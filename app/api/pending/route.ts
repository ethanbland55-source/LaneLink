import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { normaliseProfile } from "@/lib/profile";
import { applyDayFor, discardPending, listPending, stagePortions } from "@/lib/pending";
import { dayKey } from "@/lib/nutrition";

export const dynamic = "force-dynamic";

/** What is waiting, and the day it comes into force. */
export async function GET() {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const rows = await listPending(who.id);
  return NextResponse.json({
    portions: rows,
    applyOn: rows[0]?.apply_on ?? null,
    count: rows.length,
  });
}

/**
 * Stage a recalculation.
 *
 * Errors are returned rather than thrown. The first version of this let a
 * failure become a 500 that the button swallowed, so pressing Stage did
 * nothing at all and said nothing about why — which is the worst possible
 * behaviour for a control whose entire job is to promise something will
 * happen later.
 *
 * The day it applies on is worked out here rather than trusted from the
 * client, because that day is a property of the profile and not something a
 * stale tab should get to decide.
 */
export async function POST(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  try {
    const body = await req.json();

    const prof = await sql`select * from profile where id = ${who.id}`;
    const profile = normaliseProfile(prof[0] ?? {});
    const applyOn = applyDayFor(profile.plan_roll_dow ?? profile.shop_start_dow, dayKey());

    const rows = Array.isArray(body?.portions) ? body.portions : [];
    const count = await stagePortions(
      who.id,
      rows.map((r: any) => ({
        meal_id: Number(r.meal_id),
        slot: Number(r.slot),
        name: String(r.name ?? ""),
        grams: Number(r.grams),
      })),
      applyOn,
      typeof body?.note === "string" ? body.note : undefined
    );

    return NextResponse.json({ count, applyOn, sent: rows.length });
  } catch (e) {
    console.error("staging failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not stage the change" },
      { status: 500 }
    );
  }
}

/** Throw the staged changes away. The live plan is untouched either way. */
export async function DELETE() {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  await discardPending(who.id);
  return NextResponse.json({ ok: true });
}
