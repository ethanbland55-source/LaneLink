import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { readProfile, runReview } from "@/lib/review";
import { nextRollDay, reviewSchedule, rollDowOf } from "@/lib/weekly";
import { dayKey } from "@/lib/nutrition";

export const dynamic = "force-dynamic";

/**
 * Loosen one portion limit, then re-run the waiting review against it.
 *
 * A limit is a setting, not a portion — it says how small or big a food may
 * go, and changing it moves nothing today. So it is written straight to the
 * ingredient; the portions themselves still only change on roll day, through
 * the review this re-runs.
 */
export async function PATCH(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  try {
    const b = await req.json();
    const mealId = Number(b?.meal_id);
    const slot = Number(b?.slot);
    const name = String(b?.name ?? "");
    const to = Number(b?.to);
    const dir = b?.direction === "up" ? "up" : "down";
    if (!Number.isFinite(mealId) || !Number.isFinite(slot) || !name || !(to >= 0)) {
      return NextResponse.json({ error: "Bad limit" }, { status: 400 });
    }

    const moved = (await (dir === "down"
      ? sql`update ingredients set min_grams = ${Math.floor(to)}
             where user_id = ${who.id} and meal_id = ${mealId} and sort_order = ${slot} and name = ${name}
             returning id`
      : sql`update ingredients set max_grams = ${Math.ceil(to)}
             where user_id = ${who.id} and meal_id = ${mealId} and sort_order = ${slot} and name = ${name}
             returning id`)) as any[];
    if (!moved.length) {
      return NextResponse.json({ error: "That food has changed since — open the meal to edit it." }, { status: 409 });
    }

    const p = await readProfile(who.id);
    if (p?.next_apply_on) await runReview(who.id, p, dayKey(), p.next_apply_on);
    return NextResponse.json({ profile: await readProfile(who.id) });
  } catch (e) {
    console.error("limit change failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not change the limit" },
      { status: 500 }
    );
  }
}

/**
 * Run the weekly review now, by hand.
 *
 * It stages for the coming roll day exactly as the automatic one does — it
 * never changes the plan in force. Pressed before review day it is a preview
 * that review day will redo with that day's weigh-ins; pressed after this
 * week's change has already come in, it is for the week after.
 */
export async function POST() {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  try {
    const p = await readProfile(who.id);
    if (!p) return NextResponse.json({ error: "No profile" }, { status: 404 });

    const today = dayKey();
    const s = reviewSchedule(p, today);
    const current = p.plan_updated_on != null && p.plan_updated_on >= s.rollOn;
    const applyOn = current ? nextRollDay(rollDowOf(p), today) : s.late ? today : s.rollOn;

    const review = await runReview(who.id, p, today, applyOn);
    if (!review) {
      return NextResponse.json(
        { error: "Not enough weigh-ins yet — three at least." },
        { status: 409 }
      );
    }
    return NextResponse.json({ review, profile: await readProfile(who.id) });
  } catch (e) {
    console.error("review failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not run the review" },
      { status: 500 }
    );
  }
}
