-- Meal Hub schema. The app also creates these automatically on first load
-- (lib/db.ts -> ensureSchema), including migrating an older database, so
-- running this by hand is optional.

-- Stamped with the migration version so a cold start costs one query
-- instead of replaying every statement below.
create table if not exists schema_meta (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

create table if not exists profile (
  id                int primary key default 1,
  sex               text    not null default 'male',
  dob               date,
  height_cm         numeric not null default 180,
  weight_kg         numeric not null default 75,
  body_fat_pct      numeric,                         -- optional; enables Katch-McArdle
  bf_source         text    not null default 'none', -- none | manual | tape
  neck_cm           numeric,                         -- one-off, for the Navy tape estimate
  hip_cm            numeric,                         -- one-off, women only
  waist_cm          numeric,                         -- mirrored from the latest weigh-in
  activity          numeric not null default 1.725,  -- legacy all-in-one multiplier
  base_activity     numeric not null default 1.3,     -- everything that isn't a session
  energy_model      text    not null default 'flat',  -- sessions | flat
  goal              text    not null default 'cut',  -- cut | maintain | recomp | bulk
  protein_basis     text    not null default 'bodyweight', -- bodyweight | lean
  protein_per_kg    numeric not null default 2.0,
  fat_per_kg        numeric not null default 0.7,
  carb_floor_per_kg numeric not null default 1.0,    -- carbs never fall below this
  fibre_per_1000    numeric not null default 14,     -- legacy, unused
  calorie_override  int,                             -- manual kcal target (weekly average)
  -- A block: a start, a length, and a target that drifts across it.
  phase_name        text,
  phase_start       date,
  phase_weeks       int     not null default 0,      -- 0 = open-ended
  phase_start_adjust numeric,                        -- e.g. 0.00
  phase_end_adjust   numeric,                        -- e.g. -0.08
  -- Expenditure worked out from your own intake and weight trend.
  calibrated_tdee   numeric,
  use_calibration   boolean not null default false,
  cycling           boolean not null default false,  -- day-type calorie cycling
  day_adjust        jsonb,                           -- legacy
  week              jsonb,                           -- legacy {"mon":"session",...}
  week_ids          jsonb,                           -- {"mon": 3, "tue": 4, ...} -> day_types.id
  shop_days         int     not null default 7,      -- days of food per shop
  shop_start_dow    int     not null default 6,      -- 0 = Sunday … 6 = Saturday
  plan_roll_dow     int     not null default 1,      -- the plan rolls Monday, not on shopping day
  -- The figures this week's targets are built on, snapshotted on shopping day.
  -- Deliberately separate from weight_kg: the plan must not move under you
  -- every time you stand on the scale, only once a week, so that what you buy
  -- and what you eat agree all week. See lib/weekly.ts.
  plan_weight_kg    numeric,
  plan_bf_pct       numeric,
  plan_updated_on   date,
  auto_roll         boolean not null default true,
  updated_at        timestamptz not null default now(),
  constraint profile_singleton check (id = 1)
);

-- A day type is a name and a list of sessions. Which meals appear, what the day
-- costs and which weekdays use it all hang off these rows.
create table if not exists day_types (
  id         serial primary key,
  name       text not null,
  sort_order int  not null default 0,
  -- [{"activity":"swim","level":"moderate","met":8.3,"minutes":90}, ...]
  sessions   jsonb not null default '[]'::jsonb,
  fixed_kcal numeric,                                -- pin this day, opt it out of balancing
  percent    numeric,                                -- nudge, used by the flat energy model
  created_at timestamptz not null default now()
);

create table if not exists meals (
  id            serial primary key,
  name          text    not null,
  times_per_day numeric not null default 1,
  day_types     text[],                              -- legacy
  day_type_ids  int[],                               -- null = every day type
  -- Cooked ahead in one go and served by weight. The optimiser may resize the
  -- serving but never the ratio inside it, because you can't once it's cooked.
  batch         boolean not null default false,
  -- Share of this meal's group of the day's calories, 0-100. Only meaningful
  -- where two or more meals appear on exactly the same day types: they move
  -- together, so nothing in the targets can decide how to split them.
  share_pct     numeric,
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
  -- Legacy: created for older databases, but nothing reads them. The app
  -- tracks four macros.
  fibre_100       numeric not null default 0,
  fibre_estimated boolean not null default false,
  -- Filled in by lib/foods.ts on write, so the shopping list never guesses.
  food_class      text,
  aisle           text,
  pack_grams      numeric,
  -- Portion limits for the optimiser. NULL = derive a band from the food class.
  min_grams       numeric,
  max_grams       numeric,
  locked          boolean not null default false,
  -- Share of this ingredient's meal, by calories, 0-100. The same idea as
  -- meals.share_pct one level down.
  share_pct       numeric,
  sort_order      int  not null default 0
);

-- One row per meal actually eaten on a given (3am-boundary) day.
create table if not exists log_entries (
  id         serial primary key,
  day        date not null,
  meal_id    int,
  meal_name  text not null,
  day_type     text,                                 -- legacy
  day_type_id  int,
  at_time      text,                                 -- 'HH:MM' it was eaten
  confirmed  boolean not null default false,
  kcal       numeric not null default 0,
  protein    numeric not null default 0,
  carbs      numeric not null default 0,
  fat        numeric not null default 0,
  items      jsonb   not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Supplements are a fixed dose you tick off, not an ingredient the optimiser
-- may resize. Modelling them as ingredients would let the fit shrink your
-- creatine to help hit a carb target, and make the shopping list try to buy 5 g
-- of it. Macros are per dose and usually all zero.
create table if not exists supplements (
  id            serial primary key,
  name          text    not null,
  dose          numeric not null default 0,
  unit          text    not null default 'g',      -- g | mg | mcg | IU | capsule | scoop | ml
  timing        text    not null default 'anytime',
  meal_id       int references meals(id) on delete set null,  -- taken with this meal
  day_type_ids  int[],                             -- null = every day type
  times_per_day numeric not null default 1,
  kcal          numeric not null default 0,
  protein       numeric not null default 0,
  carbs         numeric not null default 0,
  fat           numeric not null default 0,
  note          text,
  sort_order    int     not null default 0,
  created_at    timestamptz not null default now()
);

-- One row per supplement actually taken on a day.
create table if not exists supplement_log (
  day           date not null,
  supplement_id int  not null references supplements(id) on delete cascade,
  taken         int  not null default 1,
  at_time       text,
  created_at    timestamptz not null default now(),
  primary key (day, supplement_id)
);

-- What's already in the cupboard, subtracted from the shopping list.
create table if not exists pantry (
  id         serial primary key,
  name       text not null unique,
  grams      numeric not null default 0,
  updated_at timestamptz not null default now()
);

-- One row per time you stood on the scale. Waist is optional and weekly is
-- plenty — in a recomposition it is the number that actually moves. The tag
-- records when in the day it was taken: that is a systematic offset rather
-- than noise, and is corrected out before anything reads the trend.
create table if not exists weigh_ins (
  day        date primary key,
  weight_kg  numeric,
  waist_cm   numeric,
  tag        text not null default 'morning',   -- morning | other | evening
  at_time    text,                              -- 'HH:MM'; beats the tag when set
  note       text,
  -- Measurements taken alongside, so body fat can trend rather than being a
  -- figure typed in once months ago. Tape in cm, skinfolds in mm.
  neck_cm       numeric,
  hip_cm        numeric,
  sf_chest      numeric,
  sf_abdomen    numeric,
  sf_thigh      numeric,
  sf_tricep     numeric,
  sf_suprailiac numeric,
  bf_pct        numeric,                        -- worked out on write
  bf_method     text,                           -- tape | skinfold | manual
  created_at timestamptz not null default now()
);

-- Which shopping lines are already in the trolley.
create table if not exists shop_checks (
  key        text primary key,
  checked    boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Portions that have been agreed but are not in force yet. Recalculate writes
-- here rather than straight to `ingredients`, so the shopping list can buy for
-- next week while the plan still describes the food in this week's containers.
-- They swap in on the first page load on or after apply_on. See lib/pending.ts.
create table if not exists pending_portions (
  ingredient_id int primary key references ingredients(id) on delete cascade,
  grams      numeric not null,
  was_grams  numeric,                             -- for the "70 -> 56 g" line
  staged_on  date not null default current_date,
  apply_on   date not null,                       -- roll day, not shopping day
  note       text,
  created_at timestamptz not null default now()
);

-- One meal out a week, entered as macros because that is all a menu gives you.
-- The optimiser never resizes it and it is never written back into the plan:
-- it is a fact about one day. lib/cheat.ts works out what the rest of that day
-- and the days after it should do about it.
create table if not exists cheat_meals (
  id         serial primary key,
  day        date not null unique,
  meal_id    int references meals(id) on delete set null,  -- the meal it swaps for
  name       text not null default 'Cheat meal',
  kcal       numeric not null default 0,
  protein    numeric not null default 0,
  carbs      numeric not null default 0,
  fat        numeric not null default 0,
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists pending_apply_idx on pending_portions(apply_on);
create index if not exists log_entries_day_idx on log_entries(day);
create index if not exists ingredients_meal_idx on ingredients(meal_id);

insert into profile (id) values (1) on conflict (id) do nothing;
