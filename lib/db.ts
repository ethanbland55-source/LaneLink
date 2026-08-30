import { neon } from "@neondatabase/serverless";
import { profileFor, TYPICAL_FIBRE_100 } from "./foods";
import { LEGACY_DAY_TYPE_MAP, SEED_DAY_TYPES, WEEKDAYS } from "./nutrition";

const url = process.env.DATABASE_URL;
if (!url) {
  // Fail loudly at request time rather than at build time.
  console.warn("DATABASE_URL is not set — every query will throw.");
}

export const sql = neon(url ?? "postgresql://user:pass@localhost/db");

let schemaReady: Promise<void> | null = null;

/**
 * Creates the tables if they don't exist, adds any columns a newer version
 * needs, and brings existing rows up to date with the current model. Cheap
 * after the first call in a warm instance, so there is no migration step to
 * forget.
 */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) schemaReady = createSchema().then(() => backfill());
  return schemaReady;
}

async function createSchema() {
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

  // --- Fibre, food knowledge, shopping -----------------------------------
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

  await sql`alter table log_entries add column if not exists day_type text`; // legacy
  await sql`alter table log_entries add column if not exists day_type_id int`;

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

  await sql`create table if not exists shop_checks (
    key text primary key,
    checked boolean not null default false,
    updated_at timestamptz not null default now()
  )`;

  await sql`create index if not exists log_entries_day_idx on log_entries(day)`;
  await sql`create index if not exists ingredients_meal_idx on ingredients(meal_id)`;
  await sql`
    insert into profile (id, energy_model, cycling)
    values (1, 'sessions', true)
    on conflict (id) do nothing`;
}

/**
 * Bring rows written by an older version up to the current model.
 *
 * Every ingredient gets classified once — which aisle it's in, what size the
 * packet is, and a ballpark fibre figure if it has none. The fibre figure is
 * flagged as an estimate so the plan page can show it differently and you can
 * correct it from the packet.
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
      select id, name, kcal_100, protein_100, carbs_100, fat_100, fibre_100
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
      const hasFibre = Number(r.fibre_100) > 0;
      const seeded = hasFibre ? Number(r.fibre_100) : TYPICAL_FIBRE_100[p.cls] ?? 0;

      await sql`
        update ingredients set
          food_class = ${p.cls},
          aisle = ${p.aisle},
          pack_grams = ${p.packGrams},
          fibre_100 = ${seeded},
          fibre_estimated = ${!hasFibre && seeded > 0}
        where id = ${r.id}`;
    }
  } catch (e) {
    // A backfill failure must never take the app down — the new columns all
    // have defaults, so the worst case is a less clever shopping list.
    console.warn("ingredient backfill skipped:", e);
  }
}
