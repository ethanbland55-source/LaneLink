import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import {
  applyPortions,
  currentPortions,
  listSnapshots,
  portionsFromLog,
  restore,
  snapshot,
} from "@/lib/history";

export const dynamic = "force-dynamic";

/**
 * The snapshots there are to go back to, and — with `from`/`to` — what a
 * restore from the log would actually do.
 *
 * The preview matters more than it looks. Restoring rewrites the plan, and the
 * last two things that rewrote the plan did it without showing their working.
 * Seeing "Rice Cakes 43 → 70 g" before you press anything is the difference
 * between a button you trust and one you have already been bitten by.
 */
export async function GET(req: Request) {
  await ensureSchema();
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const snapshots = await listSnapshots();
  if (!from || !to) return NextResponse.json({ snapshots });

  try {
    const rows = await portionsFromLog(from.slice(0, 10), to.slice(0, 10));
    const live = await currentPortions();
    const liveBy = new Map(live.map((r) => [`${r.meal_id}:${r.slot}:${r.name}`, r.grams]));
    const changes = rows
      .map((r) => ({
        ...r,
        from: liveBy.get(`${r.meal_id}:${r.slot}:${r.name}`) ?? null,
      }))
      .filter((r) => r.from != null && Math.abs((r.from as number) - r.grams) >= 0.5);

    return NextResponse.json({ snapshots, preview: changes, considered: rows.length });
  } catch (e) {
    console.warn("log preview failed:", e);
    return NextResponse.json({ snapshots, preview: [], considered: 0 });
  }
}

/**
 * Put the portions back.
 *
 * Two ways, because there are two situations. `{ id }` restores a snapshot,
 * which is the ordinary undo. `{ from, to }` rebuilds the portions from what
 * you logged over those days, which is the escape hatch for a change that
 * happened before there was any history to undo it with.
 *
 * Either way it snapshots first, so the undo is itself undoable.
 */
export async function POST(req: Request) {
  await ensureSchema();
  try {
    const b = await req.json();

    if (b?.id != null) {
      await snapshot("before undo");
      const res = await restore(Number(b.id));
      return NextResponse.json(res);
    }

    if (b?.from && b?.to) {
      const rows = await portionsFromLog(String(b.from).slice(0, 10), String(b.to).slice(0, 10));
      if (!rows.length) {
        return NextResponse.json({
          restored: 0,
          skipped: [],
          reason: "Nothing logged in those days to read the portions back out of.",
        });
      }
      await snapshot("before restore from log");
      const n = await applyPortions(rows);
      return NextResponse.json({ restored: n, skipped: [] });
    }

    return NextResponse.json({ error: "id, or from and to, required" }, { status: 400 });
  } catch (e) {
    console.error("restore failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not restore" },
      { status: 500 }
    );
  }
}
