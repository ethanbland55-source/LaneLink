import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  // Fail loudly at request time rather than at build time.
  console.warn("DATABASE_URL is not set — every query will throw.");
}

export const sql = neon(url ?? "postgresql://user:pass@localhost/db");

let schemaReady: Promise<void> | null = null;

/**
 * Creates the tables if they don't exist. Cheap after the first call in a warm
 * instance, and it means there is no manual migration step to forget.
 */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) schemaReady = createSchema();
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
  // Portion limits for the optimiser. Added after the first release, so they
  // go on as ALTER ... IF NOT EXISTS rather than in the CREATE above.
  await sql`alter table ingredients add column if not exists min_grams numeric`;
  await sql`alter table ingredients add column if not exists max_grams numeric`;
  await sql`alter table ingredients add column if not exists locked boolean not null default false`;

  await sql`create index if not exists log_entries_day_idx on log_entries(day)`;
  await sql`create index if not exists ingredients_meal_idx on ingredients(meal_id)`;
  await sql`insert into profile (id) values (1) on conflict (id) do nothing`;
}
