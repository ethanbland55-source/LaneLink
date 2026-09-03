/**
 * Staging, against a real database, including the thing that actually broke.
 *
 * The bug: `PUT /api/meals` deletes a meal's ingredient rows and inserts them
 * again, so every ingredient id changes on every save. Staging keyed on that
 * id, and the staging flow saved the meals one line before posting the ids —
 * so it posted ids that had ceased to exist a fraction of a second earlier,
 * the foreign key refused them, and the button did nothing while saying
 * nothing.
 *
 * Test 4 below is that exact sequence. It failed before the rewrite and passes
 * after it, which is the only evidence worth having.
 *
 *   PGTEST=postgres://... npx tsx bench/staging-db.ts
 */

import { check, connect, done, reset, type Sql } from "./db-harness";

const url = process.env.PGTEST;
if (!url) {
  console.log("PGTEST not set — skipping (this one needs a real Postgres).");
  process.exit(0);
}

/** Stand in for what `PUT /api/meals` does: wipe the list, write it again. */
async function saveMeal(sql: Sql, mealId: number, items: { name: string; grams: number }[]) {
  await sql`delete from ingredients where meal_id = ${mealId}`;
  for (const [n, i] of items.entries()) {
    await sql`
      insert into ingredients (meal_id, name, grams, kcal_100, protein_100, carbs_100, fat_100, sort_order)
      values (${mealId}, ${i.name}, ${i.grams}, 100, 5, 20, 1, ${n})`;
  }
}

async function main() {
  const { sql, client } = await connect(url!);
  await reset(sql);

  const { ensureSchema } = await import("../lib/db");
  const { applyDayFor, applyDuePortions, discardPending, listPending, overlayPending, stagePortions } =
    await import("../lib/pending");
  const { listSnapshots, restore, portionsFromLog, applyPortions, snapshot } = await import(
    "../lib/history"
  );

  console.log("=== Migration ===\n");
  await ensureSchema();
  const tables = (await sql`
    select table_name from information_schema.tables
     where table_schema = 'public' order by table_name`) as any[];
  const names = tables.map((t) => t.table_name);
  check("pending_portions exists", names.includes("pending_portions"));
  check("portion_history exists", names.includes("portion_history"));
  check("cheat_meals exists", names.includes("cheat_meals"));

  const cols = (await sql`
    select column_name from information_schema.columns
     where table_name = 'pending_portions'`) as any[];
  check(
    "pending_portions is keyed on meal + slot, not ingredient id",
    !cols.some((c) => c.column_name === "ingredient_id") &&
      cols.some((c) => c.column_name === "slot")
  );

  console.log("\n=== Migrating a database that has the OLD table ===\n");
  await sql`drop table if exists pending_portions`;
  await sql`create table pending_portions (
    ingredient_id int primary key references ingredients(id) on delete cascade,
    grams numeric not null, was_grams numeric,
    staged_on date not null default current_date, apply_on date not null,
    note text, created_at timestamptz not null default now())`;
  await sql`delete from schema_meta`;
  // __setSql clears the memoised promise, so this replays the migration the
  // way a cold serverless instance meeting an old database would.
  const { __setSql } = await import("../lib/db");
  __setSql(sql as any);
  await ensureSchema();

  const cols2 = (await sql`
    select column_name from information_schema.columns
     where table_name = 'pending_portions'`) as any[];
  check(
    "the old id-keyed table is replaced, not left in place",
    !cols2.some((c) => c.column_name === "ingredient_id") &&
      cols2.some((c) => c.column_name === "slot")
  );

  /* ---- a plan to work on ---------------------------------------------- */

  await sql`insert into meals (id, name, sort_order) values (1, 'Breakfast', 0), (2, 'Dinner', 1)
            on conflict (id) do nothing`;
  await sql`select setval('meals_id_seq', 2)`;
  await saveMeal(sql, 1, [
    { name: "Rice Cakes", grams: 70 },
    { name: "Banana", grams: 210 },
  ]);
  await saveMeal(sql, 2, [{ name: "Chicken Breast", grams: 190 }]);

  console.log("\n=== 1. Staging, plainly ===\n");
  const n1 = await stagePortions(
    [
      { meal_id: 1, slot: 0, name: "Rice Cakes", grams: 56 },
      { meal_id: 1, slot: 1, name: "Banana", grams: 210 }, // unchanged
      { meal_id: 2, slot: 0, name: "Chicken Breast", grams: 180 },
    ],
    "2099-01-01",
    "Rebalanced"
  );
  check("only the portions that really move are staged", n1 === 2, `${n1} staged`);

  const listed = await listPending();
  check("they come back with their meal names", listed.length === 2 && !!listed[0].meal_name);
  check(
    "and with what they were, for the 70 → 56 line",
    listed.find((p) => p.name === "Rice Cakes")?.was_grams === 70
  );

  const liveNow = (await sql`select grams from ingredients where meal_id = 1 and sort_order = 0`) as any[];
  check("the live plan has not moved", Number(liveNow[0].grams) === 70, `${liveNow[0].grams} g`);

  console.log("\n=== 2. Not due yet ===\n");
  const applied0 = await applyDuePortions("2026-09-03");
  check("nothing applies before its day", applied0 === 0);

  console.log("\n=== 3. THE BUG: saving the meals first ===\n");
  const idsBefore = (await sql`select id from ingredients where meal_id = 1 order by sort_order`) as any[];
  await saveMeal(sql, 1, [
    { name: "Rice Cakes", grams: 70 },
    { name: "Banana", grams: 210 },
  ]);
  const idsAfter = (await sql`select id from ingredients where meal_id = 1 order by sort_order`) as any[];
  check(
    "saving a meal really does change every ingredient id",
    idsBefore[0].id !== idsAfter[0].id,
    `${idsBefore[0].id} → ${idsAfter[0].id}`
  );

  const stillThere = await listPending();
  check(
    "the staged change survives that save",
    stillThere.length === 2,
    `${stillThere.length} still staged`
  );

  console.log("\n=== 4. The whole flow, in the order the button does it ===\n");
  await discardPending();
  // Exactly what applyRecalc does: persist every meal, THEN post the portions.
  await saveMeal(sql, 1, [
    { name: "Rice Cakes", grams: 70 },
    { name: "Banana", grams: 210 },
  ]);
  await saveMeal(sql, 2, [{ name: "Chicken Breast", grams: 190 }]);
  const n2 = await stagePortions(
    [
      { meal_id: 1, slot: 0, name: "Rice Cakes", grams: 56 },
      { meal_id: 2, slot: 0, name: "Chicken Breast", grams: 175 },
    ],
    "2026-09-07"
  );
  check("Stage works after the meals were saved", n2 === 2, `${n2} staged`);

  console.log("\n=== 5. Roll day ===\n");
  const applied = await applyDuePortions("2026-09-07");
  check("both come into force", applied === 2, `${applied} applied`);
  const after = (await sql`
    select name, grams from ingredients order by meal_id, sort_order`) as any[];
  check(
    "the plan now says the new numbers",
    Number(after.find((r) => r.name === "Rice Cakes").grams) === 56 &&
      Number(after.find((r) => r.name === "Chicken Breast").grams) === 175
  );
  check("and the queue is empty", (await listPending()).length === 0);
  check("applying twice is harmless", (await applyDuePortions("2026-09-07")) === 0);

  console.log("\n=== 6. Undo ===\n");
  const snaps = await listSnapshots();
  check("applying took a snapshot first", snaps.length >= 1, snaps[0]?.reason ?? "none");
  const res = await restore(snaps[0].id);
  check("restoring puts the portions back", res.restored === 2, `${res.restored} restored`);
  const back = (await sql`select name, grams from ingredients order by meal_id, sort_order`) as any[];
  check(
    "rice cakes are 70 g again",
    Number(back.find((r) => r.name === "Rice Cakes").grams) === 70,
    `${back.find((r: any) => r.name === "Rice Cakes").grams} g`
  );

  console.log("\n=== 7. A renamed ingredient is skipped, not guessed at ===\n");
  await snapshot("test");
  const s2 = (await listSnapshots())[0];
  await saveMeal(sql, 1, [
    { name: "Oatcakes", grams: 70 }, // renamed in place
    { name: "Banana", grams: 210 },
  ]);
  await sql`update ingredients set grams = 40 where meal_id = 1 and sort_order = 0`;
  const r2 = await restore(s2.id);
  check("the renamed one is reported as skipped", r2.skipped.includes("Rice Cakes"));
  const oat = (await sql`select grams from ingredients where meal_id = 1 and sort_order = 0`) as any[];
  check(
    "and is NOT resized onto the wrong food",
    Number(oat[0].grams) === 40,
    `${oat[0].grams} g`
  );

  console.log("\n=== 8. Reading the portions back out of the log ===\n");
  await saveMeal(sql, 1, [
    { name: "Rice Cakes", grams: 43 },
    { name: "Banana", grams: 105 },
  ]);
  await sql`
    insert into log_entries (day, meal_id, meal_name, confirmed, items)
    values ('2026-09-01'::date, 1, 'Breakfast', true,
            ${JSON.stringify([
              { name: "Rice Cakes", grams: 70, kcal_100: 100, protein_100: 5, carbs_100: 20, fat_100: 1 },
              { name: "Banana", grams: 210, kcal_100: 100, protein_100: 5, carbs_100: 20, fat_100: 1 },
            ])}::jsonb)`;
  const fromLog = await portionsFromLog("2026-08-31", "2026-09-06");
  check("the log remembers what the portions were", fromLog.length === 2);
  const n3 = await applyPortions(fromLog);
  check("and they can be put back", n3 === 2);
  const restored = (await sql`
    select name, grams from ingredients where meal_id = 1 order by sort_order`) as any[];
  check(
    "rice cakes back to 70 g, banana back to 210 g",
    Number(restored[0].grams) === 70 && Number(restored[1].grams) === 210,
    `${restored[0].grams} / ${restored[1].grams}`
  );

  console.log("\n=== 9. The shop overlay ===\n");
  await stagePortions([{ meal_id: 1, slot: 0, name: "Rice Cakes", grams: 56 }], "2099-01-01");
  const pend = await listPending();
  const overlaid = overlayPending(1, [{ name: "Rice Cakes", grams: 70 }, { name: "Banana", grams: 210 }], pend);
  check("the shop buys the staged number", overlaid[0].grams === 56, `${overlaid[0].grams} g`);
  check("and leaves the rest alone", overlaid[1].grams === 210);
  const otherMeal = overlayPending(2, [{ name: "Chicken Breast", grams: 190 }], pend);
  check("a different meal is untouched", otherMeal[0].grams === 190);

  console.log("\n=== 10. applyDayFor ===\n");
  check("Thursday stages for the next Monday", applyDayFor(1, "2026-09-03") === "2026-09-07");
  check("Saturday stages for the next Monday", applyDayFor(1, "2026-09-05") === "2026-09-07");
  check("Monday stages for today", applyDayFor(1, "2026-09-07") === "2026-09-07");
  check("Sunday stages for tomorrow", applyDayFor(1, "2026-09-06") === "2026-09-07");

  await client.end();
  done();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
