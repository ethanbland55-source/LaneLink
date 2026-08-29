import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Which shopping lines are already in the trolley. Keyed by the same
 * normalised ingredient key the list uses, so it survives a rebuild of the
 * list and follows you from your phone in the shop to the laptop at home.
 */
export async function GET() {
  await ensureSchema();
  const rows = await sql`select key, checked from shop_checks where checked = true`;
  return NextResponse.json(rows.map((r: any) => r.key));
}

export async function PUT(req: Request) {
  await ensureSchema();
  const { key, checked } = await req.json();
  const k = String(key ?? "").trim();
  if (!k) return NextResponse.json({ ok: false }, { status: 400 });

  await sql`
    insert into shop_checks (key, checked) values (${k}, ${!!checked})
    on conflict (key) do update set checked = ${!!checked}, updated_at = now()`;
  return NextResponse.json({ ok: true });
}

/** Clear the trolley — used by "start a new shop". */
export async function DELETE() {
  await ensureSchema();
  await sql`update shop_checks set checked = false, updated_at = now()`;
  return NextResponse.json({ ok: true });
}
