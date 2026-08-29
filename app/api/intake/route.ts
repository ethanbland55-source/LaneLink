import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Confirmed calories per day. Only confirmed entries count — a draft you added
 * and never ate would otherwise quietly inflate the calibration.
 */
export async function GET(req: Request) {
  await ensureSchema();
  const days = Math.min(365, Math.max(7, Number(new URL(req.url).searchParams.get("days")) || 90));
  const rows = await sql`
    select to_char(day, 'YYYY-MM-DD') as day,
           sum(kcal)    as kcal,
           sum(protein) as protein
    from log_entries
    where confirmed = true and day > current_date - ${days}::int
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
