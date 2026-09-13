import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { dayKey } from "@/lib/nutrition";
import { adjustStock, listStock, setStock } from "@/lib/stock";

export const dynamic = "force-dynamic";

/**
 * What's in the cupboard right now — the last count, less everything logged
 * since. See lib/stock.ts. `grams` is the figure the shopping list subtracts.
 */
export async function GET() {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  return NextResponse.json(await listStock(who.id));
}

/**
 * `{ name, grams }` replaces the count; `{ name, add }` adds to what's there
 * (negative takes away). `day` is the client's logging day, so a meal from
 * earlier in the week logged late isn't taken off a count made after it.
 */
export async function PUT(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const b = await req.json();
  const clean = String(b?.name ?? "").trim();
  if (!clean) return NextResponse.json({ ok: false }, { status: 400 });
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b?.day ?? "")) ? String(b.day) : dayKey();

  if (b?.add != null) {
    await adjustStock(who.id, clean, Number(b.add), day);
  } else {
    const g = Number(b?.grams);
    await setStock(who.id, clean, Number.isFinite(g) ? g : 0, day);
  }
  return NextResponse.json({ ok: true, stock: await listStock(who.id) });
}

export async function DELETE(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const name = new URL(req.url).searchParams.get("name") ?? "";
  await sql`delete from pantry where user_id = ${who.id} and name = ${name}`;
  return NextResponse.json({ ok: true });
}
