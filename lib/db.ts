import { neon } from "@neondatabase/serverless";
import { profileFor } from "./foods";
import { LEGACY_DAY_TYPE_MAP, SEED_DAY_TYPES, WEEKDAYS } from "./nutrition";

const url = process.env.DATABASE_URL;
if (!url) {
  // Fail loudly at request time rather than at build time.
  console.warn("DATABASE_URL is not set — every query will throw.");
}

export let sql = neon(url ?? "postgresql://user:pass@localhost/db");

/**
 * Point the queries at a different driver. Tests only.
 *
 * The staging bug that shipped was a fact about the database — ingredient ids
 * do not survive a save — and no amount of reading the TypeScript was going to
 * find it. Anything holding SQL has to be testable against a real Postgres,
 * and Neon's driver only speaks to Neon.
 *
 * `export let` rather than a config flag on purpose: it keeps node-postgres out
 * of the import graph entirely, so nothing about this reaches the bundle. ESM
 * live bindings mean every module that imported `sql` sees the swap.
 */
export function __setSql(next: typeof sql): void {
  sql = next;
  schemaReady = null;
}

let schemaReady: Promise<void> | null = null;

/**
 * Bump this whenever the DDL below changes. Nothing else has to be updated —
 * a database stamped with an older number runs the whole migration again, and
 * every statement in it is `if not exists`, so running it again is harmless.
 */
const SCHEMA_VERSION = "2026-09-03.3";

/**
 * Creates the tables if they don't exist, adds any columns a newer version
 * needs, and brings existing rows up to date with the current model.
 *
 * The memoised promise makes this free on a *warm* instance, but serverless
 * spends much of its life cold, and the migration is 78 statements — which on
 * Neon's HTTP driver is 78 sequential round trips before the first page can
 * render. So the whole thing now sits behind one cheap version check: a
 * database already stamped with the current version costs a single query.
 *
 * The check is deliberately fail-open. If the stamp can't be read for any
 * reason — the table isn't there yet, a permission oddity — it runs the
 * migration rather than assuming the schema is fine, because a missing column
 * is a much worse failure than a slow first load.
 */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) schemaReady = run();
  return schemaReady;
}

/**
 * A failed migration must not become a permanently broken instance.
 *
 * Two things went wrong here at once and they compounded. The memoised promise
 * is what makes this free on a warm instance — but memoise a *rejected* one and
 * every later request on that instance gets the same instant rejection, for as
 * long as the instance lives. And because every route awaits this before it
 * answers, a single slow or failed migration turned into every page saying
 * "Can't reach the database", indefinitely, with a database that was fine.
 *
 * So: a failure clears the memo, and the next request tries again. And a
 * failure does not fail the request. The migration is maintenance, not a
 * precondition — the tables are almost certainly already there, and if they
 * genuinely are not then the query that follows will say so with a real error
 * instead of this one standing in front of it.
 */
async function run(): Promise<void> {
  try {
    if (await alreadyCurrent()) return;
    await createSchema();
    await backfill();
    await stamp();
  } catch (e) {
    schemaReady = null;
    console.error("schema migration failed — carrying on with the schema as it is:", e);
  }
}

async function alreadyCurrent(): Promise<boolean> {
  try {
    const rows = (await sql`
      select value from schema_meta where key = 'version' limit 1`) as any[];
    return rows[0]?.value === SCHEMA_VERSION;
  } catch {
    return false;
  }
}

async function stamp(): Promise<void> {
  try {
    await sql`
      insert into schema_meta (key, value) values ('version', ${SCHEMA_VERSION})
      on conflict (key) do update set value = ${SCHEMA_VERSION}, updated_at = now()`;
  } catch (e) {
    // Worst case the stamp doesn't stick and the next cold start migrates
    // again — slow, but correct. Never a reason to fail the request.
    console.warn("schema stamp skipped:", e);
  }
}

/**
 * Collects the statements instead of running them one at a time.
 *
 * `createSchema` is 75-odd `await sql\`...\`` lines of pure DDL, and Neon's
 * HTTP driver makes every one of them a separate round trip. Measured, that is
 * 87 requests for a full migration — a quarter of a second against a local
 * socket, but five to ten seconds from a Vercel function to a Neon compute, and
 * every route in the app awaits `ensureSchema()` before it answers. Bump
 * SCHEMA_VERSION and the next cold start runs all 87 again; do it while seven
 * page fetches are in flight and seven cold functions each start their own.
 * That is a schema bump taking the site down, which is what happened.
 *
 * The driver can send a whole array in one request (`sql.transaction`), so the
 * statements are gathered and flushed in batches. The shape of the collector is
 * the point: it is itself a tagged template, so `createSchema` shadows `sql`
 * with it and not one of those 75 lines has to change. Awaiting a collected
 * query resolves immediately, because nothing has run yet.
 */
function collector() {
  const queued: unknown[] = [];
  const tag = (strings: TemplateStringsArray, ...vals: unknown[]) => {
    queued.push((sql as any)(strings, ...vals));
    return Promise.resolve([] as any[]);
  };
  return {
    tag: tag as unknown as typeof sql,
    /**
     * Flushed in chunks rather than as one giant transaction. A chunk that
     * fails rolls back only itself, which keeps the blast radius of a bad
     * statement where it was before — and Neon has a limit on how much it will
     * take in a single request anyway.
     */
    async flush(size = 25) {
      for (let i = 0; i < queued.length; i += size) {
        await (sql as any).transaction(queued.slice(i, i + size));
      }
      return queued.length;
    },
  };
}

async function createSchema() {
  // Every statement below is collected, then sent in a handful of requests
  // rather than 87. See collector().
  const batch = collector();
  const sql = batch.tag;

  // Created first so the version stamp has somewhere to live.
  await sql`create table if not exists schema_meta (
    key        text primary key,
    value      text not null,
    updated_at timestamptz not null default now()
  )`;
  await sql`create table if not exists profile (
    id int primary key default 1,
    sex text not null default 'male',
    dob date,
    height_cm numeric not null default 180,
    weight_kg numeric not null default 75,
    activity numeric not null default 1.725,
    goal text not null default 'cut',
    protein_per_kg numeric not null default 2.0,
    fat_per_kg numeric not null default 0.7,
    calorie_override int,
    updated_at timestamptz not null default now()
  )`;
  await sql`create table if not exists meals (
    id serial primary key,
    name text not null,
    sort_order int not null default 0,
    created_at timestamptz not null default now()
  )`;
  await sql`create table if not exists ingredients (
    id serial primary key,
    meal_id int not null references meals(id) on delete cascade,
    name text not null,
    grams numeric not null default 100,
    kcal_100 numeric not null default 0,
    protein_100 numeric not null default 0,
    carbs_100 numeric not null default 0,
    fat_100 numeric not null default 0,
    sort_order int not null default 0
  )`;
  await sql`create table if not exists log_entries (
    id serial primary key,
    day date not null,
    meal_id int,
    meal_name text not null,
    confirmed boolean not null default false,
    kcal numeric not null default 0,
    protein numeric not null default 0,
    carbs numeric not null default 0,
    fat numeric not null default 0,
    items jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now()
  )`;

  // --- Portion limits for the optimiser (first release) -------------------
  await sql`alter table ingredients add column if not exists min_grams numeric`;
  await sql`alter table ingredients add column if not exists max_grams numeric`;
  await sql`alter table ingredients add column if not exists locked boolean not null default false`;
  // Share of this ingredient's meal, by calories. Same idea as meals.share_pct
  // one level down: half the yoghurt bowl's calories in the yoghurt.
  await sql`alter table ingredients add column if not exists share_pct numeric`;

  // --- Food knowledge, shopping ------------------------------------------
  // fibre_100 / fibre_estimated are still created for databases that predate
  // this version, but nothing reads them: the app tracks four macros.
  await sql`alter table ingredients add column if not exists fibre_100 numeric not null default 0`;
  await sql`alter table ingredients add column if not exists fibre_estimated boolean not null default false`;
  await sql`alter table ingredients add column if not exists food_class text`;
  await sql`alter table ingredients add column if not exists aisle text`;
  await sql`alter table ingredients add column if not exists pack_grams numeric`;

  await sql`alter table meals add column if not exists times_per_day numeric not null default 1`;
  await sql`alter table meals add column if not exists day_types text[]`; // legacy
  await sql`alter table meals add column if not exists day_type_ids int[]`;
  // Cooked ahead in one go and served by weight, rather than plated fresh.
  await sql`alter table meals add column if not exists batch boolean not null default false`;
  // Share of its group's calories, where several meals appear on the same days.
  await sql`alter table meals add column if not exists share_pct numeric`;

  await sql`alter table profile add column if not exists body_fat_pct numeric`;
  await sql`alter table profile add column if not exists fibre_per_1000 numeric not null default 14`;
  await sql`alter table profile add column if not exists carb_floor_per_kg numeric not null default 1.0`;
  await sql`alter table profile add column if not exists cycling boolean not null default false`;
  await sql`alter table profile add column if not exists day_adjust jsonb`; // legacy
  await sql`alter table profile add column if not exists week jsonb`; // legacy
  await sql`alter table profile add column if not exists week_ids jsonb`;
  await sql`alter table profile add column if not exists base_activity numeric not null default 1.3`;
  // Deliberately defaulted to the old model: an existing profile keeps the
  // numbers it had, and opts in to session-based energy from the Plan page.
  // A brand-new profile is inserted as 'sessions' below.
  await sql`alter table profile add column if not exists energy_model text not null default 'flat'`;
  await sql`alter table profile add column if not exists protein_basis text not null default 'bodyweight'`;
  // Body fat: typed in, or estimated from a tape. neck/hip are one-offs; waist
  // is mirrored here from the latest weigh-in so the estimate stays current.
  await sql`alter table profile add column if not exists bf_source text not null default 'none'`;
  await sql`alter table profile add column if not exists neck_cm numeric`;
  await sql`alter table profile add column if not exists hip_cm numeric`;
  await sql`alter table profile add column if not exists waist_cm numeric`;
  await sql`alter table profile add column if not exists phase_name text`;
  await sql`alter table profile add column if not exists phase_start date`;
  await sql`alter table profile add column if not exists phase_weeks int not null default 0`;
  await sql`alter table profile add column if not exists phase_start_adjust numeric`;
  await sql`alter table profile add column if not exists phase_end_adjust numeric`;
  await sql`alter table profile add column if not exists calibrated_tdee numeric`;
  await sql`alter table profile add column if not exists use_calibration boolean not null default false`;
  await sql`alter table profile add column if not exists shop_days int not null default 7`;
  await sql`alter table profile add column if not exists shop_start_dow int not null default 6`;
  await sql`alter table profile add column if not exists plan_roll_dow int not null default 1`;
  // The figures this week's targets are built on, and when they were last
  // rolled forward. Deliberately separate from weight_kg: the plan must not
  // move under you every time you stand on the scale, only once a week on
  // shopping day, so what you buy and what you eat agree all week.
  await sql`alter table profile add column if not exists plan_weight_kg numeric`;
  await sql`alter table profile add column if not exists plan_bf_pct numeric`;
  await sql`alter table profile add column if not exists plan_updated_on date`;
  await sql`alter table profile add column if not exists auto_roll boolean not null default true`;
  // Lean protein and fat toward the days with training in them.
  await sql`alter table profile add column if not exists periodise boolean not null default true`;

  await sql`alter table log_entries add column if not exists day_type text`; // legacy
  await sql`alter table log_entries add column if not exists day_type_id int`;
  // Clock time the meal was actually eaten, 'HH:MM'. Null on anything logged
  // before the app asked, which is why nothing may assume it is there.
  await sql`alter table log_entries add column if not exists at_time text`;

  // A day type is a name and a list of sessions. Everything else — which meals
  // appear, what the day costs, which weekdays use it — hangs off these rows.
  await sql`create table if not exists day_types (
    id          serial primary key,
    name        text not null,
    sort_order  int  not null default 0,
    sessions    jsonb not null default '[]'::jsonb,
    fixed_kcal  numeric,
    percent     numeric,
    created_at  timestamptz not null default now()
  )`;

  // Supplements are a fixed dose you tick off, not an ingredient the fit can
  // resize. Kept in their own table for exactly that reason.
  await sql`create table if not exists supplements (
    id            serial primary key,
    name          text    not null,
    dose          numeric not null default 0,
    unit          text    not null default 'g',
    timing        text    not null default 'anytime',
    meal_id       int references meals(id) on delete set null,
    day_type_ids  int[],
    times_per_day numeric not null default 1,
    kcal          numeric not null default 0,
    protein       numeric not null default 0,
    carbs         numeric not null default 0,
    fat           numeric not null default 0,
    note          text,
    sort_order    int     not null default 0,
    created_at    timestamptz not null default now()
  )`;

  // One row per supplement actually taken on a day.
  await sql`create table if not exists supplement_log (
    day           date not null,
    supplement_id int  not null references supplements(id) on delete cascade,
    taken         int  not null default 1,
    at_time       text,
    created_at    timestamptz not null default now(),
    primary key (day, supplement_id)
  )`;

  await sql`create table if not exists pantry (
    id serial primary key,
    name text not null unique,
    grams numeric not null default 0,
    updated_at timestamptz not null default now()
  )`;

  // One row per time you stood on the scale. Waist is optional and weekly is
  // plenty — in a recomposition it's the number that actually moves. The tag
  // records when in the day it was taken, because that's a systematic offset
  // rather than noise and has to be corrected before anything reads the trend.
  await sql`create table if not exists weigh_ins (
    day        date primary key,
    weight_kg  numeric,
    waist_cm   numeric,
    tag        text not null default 'morning',
    note       text,
    created_at timestamptz not null default now()
  )`;
  await sql`alter table weigh_ins add column if not exists tag text not null default 'morning'`;
  // The clock time you actually stood on the scale. Strictly better than the
  // three-bucket tag it replaces — the correction can be a curve rather than
  // a step — but the tag stays for readings taken before this existed.
  await sql`alter table weigh_ins add column if not exists at_time text`;
  // Measurements taken alongside the weigh-in, so body fat can trend rather
  // than being a single figure typed in months ago.
  await sql`alter table weigh_ins add column if not exists neck_cm numeric`;
  await sql`alter table weigh_ins add column if not exists hip_cm numeric`;
  await sql`alter table weigh_ins add column if not exists sf_chest numeric`;
  await sql`alter table weigh_ins add column if not exists sf_abdomen numeric`;
  await sql`alter table weigh_ins add column if not exists sf_thigh numeric`;
  await sql`alter table weigh_ins add column if not exists sf_tricep numeric`;
  await sql`alter table weigh_ins add column if not exists sf_suprailiac numeric`;
  await sql`alter table weigh_ins add column if not exists bf_pct numeric`;
  await sql`alter table weigh_ins add column if not exists bf_method text`;

  await sql`create table if not exists shop_checks (
    key text primary key,
    checked boolean not null default false,
    updated_at timestamptz not null default now()
  )`;

  // Portions agreed but not yet in force.
  //
  // Keyed by (meal, position, name) and NOT by ingredient id, because
  // ingredient ids are not stable: saving a meal deletes its ingredient rows
  // and inserts fresh ones, so every id changes. Keying on the id meant a
  // staged change was dead the moment anything touched that meal — which
  // included the save the staging flow itself did one line earlier.
  // Only the old id-keyed table goes; a correctly-shaped one keeps whatever is
  // staged in it, because dropping that on every migration would silently
  // throw away a change someone was relying on.
  await sql`do $$ begin
    if exists (select 1 from information_schema.columns
               where table_name = 'pending_portions' and column_name = 'ingredient_id')
    then drop table pending_portions; end if;
  end $$`;
  await sql`create table if not exists pending_portions (
    meal_id    int  not null references meals(id) on delete cascade,
    slot       int  not null,
    name       text not null,
    grams      numeric not null,
    was_grams  numeric,
    staged_on  date not null default current_date,
    apply_on   date not null,
    note       text,
    created_at timestamptz not null default now(),
    primary key (meal_id, slot)
  )`;

  // What the portions were before the last bulk change, so any of them can be
  // undone. Written by the weekly re-fit, by a staged change coming into
  // force, and by Recalculate. See lib/history.ts.
  await sql`create table if not exists portion_history (
    id         serial primary key,
    changed_on date not null default current_date,
    reason     text not null,
    rows       jsonb not null,
    created_at timestamptz not null default now()
  )`;

  // One meal out, entered as macros because that is all a menu tells you.
  // Never resized by the optimiser and never written back into the plan — it
  // is a fact about one day, not a change to the week. See lib/cheat.ts.
  await sql`create table if not exists cheat_meals (
    id         serial primary key,
    day        date not null unique,
    meal_id    int references meals(id) on delete set null,
    name       text not null default 'Cheat meal',
    kcal       numeric not null default 0,
    protein    numeric not null default 0,
    carbs      numeric not null default 0,
    fat        numeric not null default 0,
    note       text,
    created_at timestamptz not null default now()
  )`;

  await sql`create index if not exists pending_apply_idx on pending_portions(apply_on)`;
  await sql`create index if not exists portion_history_idx on portion_history(changed_on desc)`;
  await sql`create index if not exists log_entries_day_idx on log_entries(day)`;
  await sql`create index if not exists ingredients_meal_idx on ingredients(meal_id)`;
  await sql`
    insert into profile (id, energy_model, cycling)
    values (1, 'sessions', true)
    on conflict (id) do nothing`;

  await batch.flush();
}

/**
 * Bring rows written by an older version up to the current model.
 *
 * Every ingredient gets classified once — which aisle it's in and what size
 * the packet is — so the shopping list never has to guess.
 *
 * It only ever touches rows that haven't been classified yet, so it costs one
 * query on a warm instance and never overwrites anything you've typed.
 */
/**
 * Seed the day types, then move anything written against the old fixed
 * rest/easy/session/double model onto them.
 */
async function migrateDayTypes() {
  const existing = await sql`select id, name from day_types order by sort_order, id`;
  let rows = existing as any[];

  if (rows.length === 0) {
    for (const [i, seed] of SEED_DAY_TYPES.entries()) {
      await sql`
        insert into day_types (name, sort_order, sessions)
        values (${seed.name}, ${i}, ${JSON.stringify(seed.sessions)}::jsonb)`;
    }
    rows = (await sql`select id, name from day_types order by sort_order, id`) as any[];
  }

  const idByName = new Map<string, number>(rows.map((r) => [String(r.name), Number(r.id)]));
  const legacyId = (label: string): number | null =>
    idByName.get(LEGACY_DAY_TYPE_MAP[label] ?? "") ?? null;

  // --- the week -----------------------------------------------------------
  const prof = (await sql`select week, week_ids from profile where id = 1`) as any[];
  const p = prof[0];
  if (p && !p.week_ids) {
    const old = (p.week ?? {}) as Record<string, string>;
    const week: Record<string, number> = {};
    for (const d of WEEKDAYS) {
      const mapped = old[d] ? legacyId(old[d]) : null;
      // No previous week to convert: a sensible swim week to start from.
      week[d] =
        mapped ??
        idByName.get(
          d === "sun"
            ? "Rest"
            : d === "sat"
              ? "Double swim"
              : d === "wed"
                ? "Gym only"
                : d === "tue" || d === "fri"
                  ? "Swim + gym"
                  : "Swim only"
        ) ??
        Number(rows[0]?.id ?? 0);
    }
    await sql`update profile set week_ids = ${JSON.stringify(week)}::jsonb where id = 1`;
  }

  // --- meals --------------------------------------------------------------
  const meals = (await sql`
    select id, day_types from meals
    where day_type_ids is null and day_types is not null`) as any[];
  for (const m of meals) {
    const ids = (m.day_types as string[])
      .map(legacyId)
      .filter((x): x is number => typeof x === "number");
    if (!ids.length) continue;
    await sql`update meals set day_type_ids = ${`{${ids.join(",")}}`}::int[] where id = ${m.id}`;
  }
}

async function backfill() {
  try {
    await migrateDayTypes();
  } catch (e) {
    console.warn("day type migration skipped:", e);
  }
  try {
    const rows = await sql`
      select id, name, kcal_100, protein_100, carbs_100, fat_100
      from ingredients
      where food_class is null`;
    if (!rows.length) return;

    for (const r of rows as any[]) {
      const p = profileFor(r.name, {
        kcal_100: Number(r.kcal_100) || 0,
        protein_100: Number(r.protein_100) || 0,
        carbs_100: Number(r.carbs_100) || 0,
        fat_100: Number(r.fat_100) || 0,
      });
      await sql`
        update ingredients set
          food_class = ${p.cls},
          aisle = ${p.aisle},
          pack_grams = ${p.packGrams}
        where id = ${r.id}`;
    }
  } catch (e) {
    // A backfill failure must never take the app down — the new columns all
    // have defaults, so the worst case is a less clever shopping list.
    console.warn("ingredient backfill skipped:", e);
  }
}
