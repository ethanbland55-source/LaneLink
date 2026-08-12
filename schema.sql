-- Meal Hub schema. The app also creates these automatically on first load
-- (lib/db.ts -> ensureSchema), so running this by hand is optional.

create table if not exists profile (
  id             int primary key default 1,
  sex            text    not null default 'male',
  dob            date,
  height_cm      numeric not null default 180,
  weight_kg      numeric not null default 75,
  activity       numeric not null default 1.725,  -- calculator.net multiplier
  goal           text    not null default 'cut',  -- cut | maintain | bulk
  protein_per_kg numeric not null default 2.0,
  fat_per_kg     numeric not null default 0.7,
  calorie_override int,                            -- optional manual kcal target
  updated_at     timestamptz not null default now(),
  constraint profile_singleton check (id = 1)
);

create table if not exists meals (
  id         serial primary key,
  name       text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

-- Macros are stored PER 100g so editing the gram amount rescales correctly.
create table if not exists ingredients (
  id           serial primary key,
  meal_id      int  not null references meals(id) on delete cascade,
  name         text not null,
  grams        numeric not null default 100,
  kcal_100     numeric not null default 0,
  protein_100  numeric not null default 0,
  carbs_100    numeric not null default 0,
  fat_100      numeric not null default 0,
  -- Portion limits for the optimiser. NULL = derive a 60%-150% band around
  -- the planned amount. locked = never change this portion.
  min_grams    numeric,
  max_grams    numeric,
  locked       boolean not null default false,
  sort_order   int  not null default 0
);

-- One row per meal actually eaten on a given (3am-boundary) day.
create table if not exists log_entries (
  id         serial primary key,
  day        date not null,
  meal_id    int,
  meal_name  text not null,
  confirmed  boolean not null default false,
  kcal       numeric not null default 0,
  protein    numeric not null default 0,
  carbs      numeric not null default 0,
  fat        numeric not null default 0,
  items      jsonb   not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists log_entries_day_idx on log_entries(day);
create index if not exists ingredients_meal_idx on ingredients(meal_id);

insert into profile (id) values (1) on conflict (id) do nothing;
