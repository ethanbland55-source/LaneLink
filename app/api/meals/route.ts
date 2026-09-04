import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { profileFor } from "@/lib/foods";
import { applyDuePortions } from "@/lib/pending";

export const dynamic = "force-dynamic";

/**
 * All meals with their ingredients, ordered.
 *
 * This is the only place portions are read from, which makes it the right and
 * only place to swap in a staged change that has come due. One statement,
 * whether or not anything is waiting — see lib/pending.ts.
 */
export async function GET() {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  await applyDuePortions(who.id);
  const meals = await sql`
    select * from meals where user_id = ${who.id} order by sort_order, id`;
  const ings = await sql`
    select * from ingredients where user_id = ${who.id} order by sort_order, id`;
  return NextResponse.json(
    meals.map((m: any) => ({
      ...m,
      times_per_day: Number(m.times_per_day ?? 1),
      day_type_ids: (m.day_type_ids ?? null) as number[] | null,
      batch: !!m.batch,
      share_pct: m.share_pct == null ? null : Number(m.share_pct),
      ingredients: ings
        .filter((i: any) => i.meal_id === m.id)
        .map((i: any) => ({
          ...i,
          grams: Number(i.grams),
          kcal_100: Number(i.kcal_100),
          protein_100: Number(i.protein_100),
          carbs_100: Number(i.carbs_100),
          fat_100: Number(i.fat_100),
          min_grams: i.min_grams == null ? null : Number(i.min_grams),
          max_grams: i.max_grams == null ? null : Number(i.max_grams),
          share_pct: i.share_pct == null ? null : Number(i.share_pct),
          locked: !!i.locked,
          prepped: !!i.prepped,
        })),
    }))
  );
}

export async function POST(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const { name } = await req.json();
  const rows = await sql`
    insert into meals (user_id, name, sort_order)
    values (${who.id},
            ${name || "New meal"},
            coalesce((select max(sort_order) + 1 from meals where user_id = ${who.id}), 0))
    returning *`;
  return NextResponse.json({
    ...rows[0],
    times_per_day: 1,
    day_type_ids: null,
    batch: false,
    share_pct: null,
    ingredients: [],
  });
}

/** Replaces a meal's name and its whole ingredient list in one go. */
export async function PUT(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const { id, name, ingredients, times_per_day, day_type_ids, batch, share_pct } =
    await req.json();

  const reps = Number(times_per_day);

  // A share is a percentage or nothing at all; anything else is a typo, and a
  // typo here would quietly reshape the whole week.
  const shareRaw = Number(share_pct);
  const share =
    share_pct == null || share_pct === "" || !Number.isFinite(shareRaw)
      ? null
      : Math.min(100, Math.max(0, shareRaw));

  // null means "every day type". Anything pointing at a day type that no
  // longer exists is dropped here rather than left to rot in the array.
  const live = (await sql`select id from day_types where user_id = ${who.id}`) as any[];
  const liveIds = new Set(live.map((r) => Number(r.id)));
  const picked: number[] = Array.isArray(day_type_ids)
    ? [...new Set(day_type_ids.map(Number).filter((n: number) => liveIds.has(n)))]
    : [];
  // Sent as an explicit array literal and cast, rather than relying on the
  // driver to infer int[] from a JS array.
  const types: string | null =
    picked.length > 0 && picked.length < liveIds.size ? `{${picked.join(",")}}` : null;

  /**
   * The update is filtered by owner, so a meal that isn't yours doesn't move.
   * That is not enough on its own: the insert below is keyed on the id you
   * sent, so a request naming someone else's meal used to leave a row tagged
   * to you and pointing at their breakfast. Nobody could read it, but "nobody
   * can read the mess" is not the same as not making one.
   *
   * So the write is refused outright unless the meal is yours.
   */
  const owned = (await sql`
    update meals set
      name = ${name},
      times_per_day = ${Number.isFinite(reps) && reps > 0 ? reps : 1},
      day_type_ids = ${types}::int[],
      batch = ${!!batch},
      share_pct = ${share == null ? null : share}
    where id = ${id} and user_id = ${who.id}
    returning id`) as any[];
  if (!owned.length) return NextResponse.json({ error: "No such meal" }, { status: 404 });

  await sql`delete from ingredients where meal_id = ${id} and user_id = ${who.id}`;

  /**
   * One insert, not one per ingredient.
   *
   * This route is called once per meal when a plan is saved, and it used to
   * issue a separate `insert` for every ingredient. Neon's HTTP driver makes
   * each of those a round trip, so saving eight meals of five ingredients was
   * sixty-odd sequential requests — which is what the Stage button spent its
   * several frozen seconds doing.
   */
  const rows = (ingredients ?? []).map((i: any, n: number) => {
    // Classify on write so the shopping list never has to guess later.
    const cls = profileFor(i.name ?? "", {
      kcal_100: num(i.kcal_100),
      protein_100: num(i.protein_100),
      carbs_100: num(i.carbs_100),
      fat_100: num(i.fat_100),
    });
    return {
      user_id: who.id,
      meal_id: id,
      name: i.name || "Ingredient",
      grams: num(i.grams),
      kcal_100: num(i.kcal_100),
      protein_100: num(i.protein_100),
      carbs_100: num(i.carbs_100),
      fat_100: num(i.fat_100),
      food_class: cls.cls,
      aisle: cls.aisle,
      pack_grams: cls.packGrams,
      min_grams: i.min_grams == null ? null : num(i.min_grams),
      max_grams: i.max_grams == null ? null : num(i.max_grams),
      locked: !!i.locked,
      // Cooked and boxed on prep day. Free to the fit, fixed on the day.
      prepped: !!i.prepped,
      share_pct: sharePct(i.share_pct),
      sort_order: n,
    };
  });

  if (rows.length) {
    await sql`
      insert into ingredients
        (user_id, meal_id, name, grams, kcal_100, protein_100, carbs_100, fat_100,
         food_class, aisle, pack_grams, min_grams, max_grams, locked,
         prepped, share_pct, sort_order)
      select user_id, meal_id, name, grams, kcal_100, protein_100, carbs_100, fat_100,
             food_class, aisle, pack_grams, min_grams, max_grams, locked,
             prepped, share_pct, sort_order
        from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
          as t(user_id int, meal_id int, name text, grams numeric, kcal_100 numeric,
               protein_100 numeric, carbs_100 numeric, fat_100 numeric,
               food_class text, aisle text, pack_grams numeric,
               min_grams numeric, max_grams numeric, locked boolean,
               prepped boolean, share_pct numeric, sort_order int)`;
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  await ensureSchema();
  const who = await requireUser();
  if ("res" in who) return who.res;

  const id = Number(new URL(req.url).searchParams.get("id"));
  await sql`delete from meals where id = ${id} and user_id = ${who.id}`;
  return NextResponse.json({ ok: true });
}

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** A share is a percentage or nothing; anything else is a typo. */
function sharePct(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
}
