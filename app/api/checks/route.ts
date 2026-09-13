import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { dayKey } from "@/lib/nutrition";
import { adjustStock } from "@/lib/stock";

export const dynamic = "force-dynamic";

/**
 * How long a tick counts as "this shop". A trolley ticked last Saturday is not
 * this Saturday's trolley, and treating it as one would hide this week's list
 * behind last week's ticks until someone remembered to press "New shop".
 */
const FRESH_DAYS = 4;

/**
 * Which shopping lines are already in the trolley, and how much of each went
 * in. Keyed by the same normalised ingredient key the list uses, so it survives
 * a rebuild of the list and follows you from your phone in the shop to the
 * laptop at home.
 */
export async function GET() {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const rows = (await sql`
    select key, bought_grams from shop_checks
     where user_id = ${who.id} and checked = true
       and updated_at > now() - make_interval(days => ${FRESH_DAYS})`) as any[];
  return NextResponse.json(
    rows.map((r) => ({ key: r.key, bought: r.bought_grams == null ? 0 : Number(r.bought_grams) }))
  );
}

/**
 * Tick, untick, or change how much went in.
 *
 * Ticking puts what you bought into the cupboard (lib/stock.ts), and unticking
 * takes the same amount back out — so the trolley and the cupboard can never
 * disagree about a line. `bought` defaults to what the list said to buy; send
 * a different figure when the shop only had the bigger bag.
 */
export async function PUT(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const b = await req.json();
  const k = String(b?.key ?? "").trim();
  if (!k) return NextResponse.json({ ok: false }, { status: 400 });
  const name = String(b?.name ?? "").trim();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b?.day ?? "")) ? String(b.day) : dayKey();
  const checked = !!b?.checked;
  const bought = Math.max(0, Number(b?.bought) || 0);

  // What this line had already put in the cupboard, if it's a live tick.
  const prev = (await sql`
    select checked, bought_grams,
           updated_at > now() - make_interval(days => ${FRESH_DAYS}) as fresh
      from shop_checks where user_id = ${who.id} and key = ${k}`) as any[];
  const had = prev[0]?.checked && prev[0]?.fresh ? Number(prev[0]?.bought_grams) || 0 : 0;
  const now = checked ? bought : 0;

  await sql`
    insert into shop_checks (user_id, key, checked, bought_grams, name)
    values (${who.id}, ${k}, ${checked}, ${checked ? bought : null}, ${name || null})
    on conflict (user_id, key) do update set
      checked = ${checked}, bought_grams = ${checked ? bought : null},
      name = coalesce(${name || null}, shop_checks.name), updated_at = now()`;

  if (name && now !== had) await adjustStock(who.id, name, now - had, day);

  return NextResponse.json({ ok: true, bought: now });
}

/**
 * Clear the trolley — used by "start a new shop". What was bought stays in the
 * cupboard; only the ticks go.
 */
export async function DELETE() {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  await sql`
    update shop_checks set checked = false, bought_grams = null, updated_at = now()
     where user_id = ${who.id}`;
  return NextResponse.json({ ok: true });
}
