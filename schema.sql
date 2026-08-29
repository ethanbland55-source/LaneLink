-- Meal Hub schema. The app also creates these automatically on first load
-- (lib/db.ts -> ensureSchema), including migrating an older database, so
-- running this by hand is optional.

create table if not exists profile (
  id                int primary key default 1,
  sex               text    not null default 'male',
  dob               date,
  height_cm         numeric not null default 180,
  weight_kg         numeric not null default 75,
  body_fat_pct      numeric,                         -- optional; enables Katch-McArdle
  activity          numeric not null default 1.725,  -- baseline multiplier
  goal              text    not null default 'cut',  -- cut | maintain | bulk
  protein_per_kg    numeric not null default 2.0,
  fat_per_kg        numeric not null default 0.7,
  carb_floor_per_kg numeric not null default 1.0,    -- carbs never fall below this
  fibre_per_1000    numeric not null default 14,     -- g fibre per 1000 kcal
  calorie_override  int,                             -- manual kcal target (weekly average)
  cycling           boolean not null default false,  -- day-type calorie cycling
  day_adjust        jsonb,                           -- {"rest":-0.12,"easy":-0.04,...}
  week              jsonb,                           -- {"mon":"session","tue":...}
  shop_days         int     not null default 7,      -- days of food per shop
  shop_start_dow    int     not null default 6,      -- 0 = Sunday … 6 = Saturday
  updated_at        timestamptz not null default now(),
  constraint profile_singleton check (id = 1)
);

create table if not exists meals (
  id            serial primary key,
  name          text    not null,
  times_per_day numeric not null default 1,
  day_types     text[],                              -- null = every day type
  sort_order    int     not null default 0,
  created_at    timestamptz not null default now()
);

-- Macros are stored PER 100g so editing the gram amount rescales correctly.
create table if not exists ingredients (
  id              serial primary key,
  meal_id         int  not null references meals(id) on delete cascade,
  name            text not null,
  grams           numeric not null default 100,
  kcal_100        numeric not null default 0,
  protein_100     numeric not null default 0,
  carbs_100       numeric not null default 0,
  fat_100         numeric not null default 0,
  fibre_100       numeric not null default 0,
  fibre_estimated boolean not null default false,    -- seeded from food class, not a label
  -- Filled in by lib/foods.ts on write, so the shopping list never guesses.
  food_class      text,
  aisle           text,
  pack_grams      numeric,
  -- Portion limits for the optimiser. NULL = derive a band from the food class.
  min_grams       numeric,
  max_grams       numeric,
  locked          boolean not null default false,
  sort_order      int  not null default 0
);

-- One row per meal actually eaten on a given (3am-boundary) day.
create table if not exists log_entries (
  id         serial primary key,
  day        date not null,
  meal_id    int,
  meal_name  text not null,
  day_type   text,
  confirmed  boolean not null default false,
  kcal       numeric not null default 0,
  protein    numeric not null default 0,
  carbs      numeric not null default 0,
  fat        numeric not null default 0,
  items      jsonb   not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- What's already in the cupboard, subtracted from the shopping list.
create table if not exists pantry (
  id         serial primary key,
  name       text not null unique,
  grams      numeric not null default 0,
  updated_at timestamptz not null default now()
);

-- Which shopping lines are already in the trolley.
create table if not exists shop_checks (
  key        text primary key,
  checked    boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists log_entries_day_idx on log_entries(day);
create index if not exists ingredients_meal_idx on ingredients(meal_id);

insert into profile (id) values (1) on conflict (id) do nothing;
