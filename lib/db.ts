import { neon } from "@neondatabase/serverless";
import { profileFor, TYPICAL_FIBRE_100 } from "./foods";

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
  await sql`alter table meals add column if not exists day_types text[]`;

  await sql`alter table profile add column if not exists body_fat_pct numeric`;
  await sql`alter table profile add column if not exists fibre_per_1000 numeric not null default 14`;
  await sql`alter table profile add column if not exists carb_floor_per_kg numeric not null default 1.0`;
  await sql`alter table profile add column if not exists cycling boolean not null default false`;
  await sql`alter table profile add column if not exists day_adjust jsonb`;
  await sql`alter table profile add column if not exists week jsonb`;
  await sql`alter table profile add column if not exists shop_days int not null default 7`;
  await sql`alter table profile add column if not exists shop_start_dow int not null default 6`;

  await sql`alter table log_entries add column if not exists day_type text`;

  await sql`create table if not exists pantry (
    id serial primary key,
    name text not null unique,
    grams numeric not null default 0,
    updated_at timestamptz not null default now()
  )`;

  await sql`create table if not exists shop_checks (
    key text primary key,
    checked boolean not null default false,
    updated_at timestamptz not null default now()
  )`;

  await sql`create index if not exists log_entries_day_idx on log_entries(day)`;
  await sql`create index if not exists ingredients_meal_idx on ingredients(meal_id)`;
  await sql`insert into profile (id) values (1) on conflict (id) do nothing`;
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
async function backfill() {
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
