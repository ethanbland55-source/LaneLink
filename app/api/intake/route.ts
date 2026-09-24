import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Calories actually eaten per day: confirmed meals, plus cheat meals.
 *
 * Only confirmed entries count — a draft you added and never ate would
 * otherwise quietly inflate the calibration. Cheat meals count in full: they
 * are logged in their own table, and the meal a cheat replaces is simply never
 * ticked off, so leaving them out read a week with a 2,500 kcal meal out as
 * about 350 kcal a day less food than was eaten — and the calibration, which
 * is intake minus what the scale did, as a maintenance that much too low.
 */
export async function GET(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const days = Math.min(365, Math.max(7, Number(new URL(req.url).searchParams.get("days")) || 90));
  const rows = await sql`
    select to_char(day, 'YYYY-MM-DD') as day,
           sum(kcal)    as kcal,
           sum(protein) as protein
    from (
      select day, kcal, protein from log_entries
       where user_id = ${who.id} and confirmed = true and day > current_date - ${days}::int
      union all
      select day, kcal, protein from cheat_meals
       where user_id = ${who.id} and day > current_date - ${days}::int
    ) eaten
    group by day
    order by day`;
  return NextResponse.json(
    rows.map((r: any) => ({
      day: r.day,
      kcal: Number(r.kcal) || 0,
      protein: Number(r.protein) || 0,
    }))
  );
}
