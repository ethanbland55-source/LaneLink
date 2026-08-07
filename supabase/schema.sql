-- =============================================================================
-- Carnforth & District Otters ASC — database schema
-- Run this once in the Supabase SQL Editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: everything is IF NOT EXISTS / ON CONFLICT DO NOTHING.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SITE CONTENT
-- -----------------------------------------------------------------------------

-- Free-form editable settings (hero text, contact details, social links…).
create table if not exists site_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Editable long-form pages. Body is markdown.
create table if not exists pages (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title       text not null,
  intro       text,
  body        text,
  section     text,                       -- about | training | competing | join | policies
  sort_order  int not null default 0,
  published   boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- Club news / announcements.
create table if not exists news (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  title        text not null,
  excerpt      text,
  body         text,
  image_url    text,
  published_at timestamptz not null default now(),
  published    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- Newsletter archive (PDFs in Supabase Storage).
create table if not exists newsletters (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  issue_date   date not null,
  summary      text,
  file_url     text not null,
  file_size    bigint,
  cover_url    text,
  published    boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists newsletters_date_idx on newsletters (issue_date desc);

-- Who's Who: committee, coaches, team managers, officials.
create table if not exists people (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  roles       text[] not null default '{}',   -- badges, most important first
  sections    text[] not null default '{}',   -- committee | coaches | managers | officials
  bio         text,
  email       text,
  photo_url   text,
  sort_order  int not null default 0,
  published   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists people_sections_idx on people using gin (sections);

-- Training squads and their weekly sessions.
create table if not exists squads (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  name         text not null,
  tagline      text,
  description  text,
  hours_guide  text,                        -- "4 hrs", "7.5 + hrs"
  sort_order   int not null default 0,
  published    boolean not null default true
);

create table if not exists training_sessions (
  id          uuid primary key default gen_random_uuid(),
  squad_id    uuid references squads(id) on delete cascade,
  day_of_week int not null,                 -- 1 = Monday … 7 = Sunday
  venue       text not null,
  starts_at   text not null,                -- "19:00"
  ends_at     text not null,                -- "20:00"
  note        text,                         -- "Invite only", "Land training 19:15"
  sort_order  int not null default 0
);
create index if not exists training_sessions_squad_idx on training_sessions (squad_id, day_of_week);

create table if not exists venues (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,
  name       text not null,
  address    text,
  postcode   text,
  lanes      int,
  length_m   int,
  notes      text,
  map_url    text,
  sort_order int not null default 0
);

create table if not exists sponsors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  url        text,
  logo_url   text,
  blurb      text,
  tier       text default 'supporter',      -- headline | supporter | accreditation
  sort_order int not null default 0,
  published  boolean not null default true
);

-- Policies, safeguarding docs, team protocol, entry packs not tied to a gala.
create table if not exists documents (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  category   text not null default 'policies',
  file_url   text not null,
  file_size  bigint,
  updated_on date,
  sort_order int not null default 0,
  published  boolean not null default true
);

-- -----------------------------------------------------------------------------
-- GALAS & RESULTS
--
-- A "series" is the recurring competition (Winter Gala, Summer Gala, Club
-- Championships…). Each running of it is a gala row with its own permanent
-- slug — so last year's Winter Gala stays live and browsable forever while this
-- year's Summer Gala is running. Nothing is ever overwritten.
-- -----------------------------------------------------------------------------

create table if not exists gala_series (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,          -- winter-gala | summer-gala | club-champs
  name        text not null,                 -- "Winter Gala"
  blurb       text,
  accent      text default 'purple',         -- purple | gold | teal — tints the results header
  sort_order  int not null default 0,
  published   boolean not null default true
);

create table if not exists galas (
  id           uuid primary key default gen_random_uuid(),
  series_id    uuid references gala_series(id) on delete set null,
  slug         text unique not null,         -- winter-gala-2026
  name         text not null,                -- "Carnforth Otters Winter Gala 2026"
  edition_year int,
  start_date   date,
  end_date     date,
  venue        text,
  course       text default 'SC',            -- SC (25m) | LC (50m)
  meet_type    text default 'club-gala',     -- club-gala | open-meet | league | other
  licence      text,                         -- "Level 3 — 3ER260123"
  is_home      boolean not null default true,-- we host it → gets live + results
  entry_status text,                         -- open | soon | closed
  entry_url    text,
  stream_url   text,
  promoter     text,
  contact_email text,
  description  text,
  results_note text,
  published    boolean not null default false,
  is_live      boolean not null default false, -- manual override for the Live page
  imported_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists galas_series_idx on galas (series_id, start_date desc);
create index if not exists galas_date_idx on galas (start_date desc);

create table if not exists gala_sessions (
  id             uuid primary key default gen_random_uuid(),
  gala_id        uuid not null references galas(id) on delete cascade,
  number         int not null,
  name           text,
  session_date   date,
  warmup_time    text,
  start_time     text,
  start_list_url text,                       -- session-wide PDF
  results_url    text,                       -- session-wide PDF
  sort_order     int not null default 0
);
create index if not exists gala_sessions_gala_idx on gala_sessions (gala_id, number);

create table if not exists gala_events (
  id            uuid primary key default gen_random_uuid(),
  gala_id       uuid not null references galas(id) on delete cascade,
  session_id    uuid references gala_sessions(id) on delete cascade,
  number        int not null,                -- 101, 202 …
  name          text not null,               -- "Women's 200m Freestyle"
  distance      int,                         -- 200
  stroke        text,                        -- FREE | BACK | BREAST | FLY | IM | RELAY
  gender        text,                        -- M | F | X
  age_group     text,                        -- "13/14 Yrs", "Open"
  round         text default 'TIMEDFINAL',   -- HEATS | FINAL | TIMEDFINAL | SEMI
  is_relay      boolean not null default false,
  scheduled_at  text,
  start_list_url text,                       -- per-event PDF (optional)
  results_url    text,
  has_results   boolean not null default false,
  sort_order    int not null default 0
);
create index if not exists gala_events_gala_idx on gala_events (gala_id, number);
create index if not exists gala_events_session_idx on gala_events (session_id, sort_order);

create table if not exists gala_results (
  id            uuid primary key default gen_random_uuid(),
  gala_id       uuid not null references galas(id) on delete cascade,
  event_id      uuid not null references gala_events(id) on delete cascade,
  heat_number   int,
  lane          int,
  place         int,                          -- null when DQ/DNS
  swimmer_name  text not null,
  birth_year    int,
  age           int,
  club          text,
  club_code     text,
  swim_time     text,                         -- "1:04.57" — display form
  swim_time_cs  int,                          -- centiseconds, for sorting/PBs
  reaction_time text,
  points        int,                          -- WA / FINA points
  status        text,                         -- '' | DQ | DNS | DNF | WDR
  dq_code       text,
  splits        jsonb not null default '[]'::jsonb,  -- [{distance:50, time:"29.11"}, …]
  relay_members jsonb,
  is_home_club  boolean not null default false,
  is_final      boolean not null default false,
  sort_order    int not null default 0
);
create index if not exists gala_results_event_idx on gala_results (event_id, sort_order);
create index if not exists gala_results_gala_idx on gala_results (gala_id);
create index if not exists gala_results_home_idx on gala_results (gala_id, is_home_club);
create index if not exists gala_results_name_idx on gala_results (gala_id, swimmer_name);

-- Grouped downloads for a gala: conditions, programme, entry files, warm-ups…
create table if not exists gala_files (
  id          uuid primary key default gen_random_uuid(),
  gala_id     uuid not null references galas(id) on delete cascade,
  group_key   text not null default 'other', -- conditions|programme|entry|accepted|warmup|results|other
  label       text not null,
  file_url    text not null,
  file_size   bigint,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists gala_files_gala_idx on gala_files (gala_id, group_key, sort_order);

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- Everything published is world-readable. All writes go through the Next.js
-- server using the service-role key, which bypasses RLS — so the anon key that
-- ships to the browser can never modify anything.
-- -----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'site_settings','pages','news','newsletters','people','squads',
    'training_sessions','venues','sponsors','documents','gala_series','galas',
    'gala_sessions','gala_events','gala_results','gala_files'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "public read" on %I', t);
    execute format('create policy "public read" on %I for select using (true)', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- STORAGE
-- One public bucket holds newsletters, gala PDFs, photos and logos.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('otters', 'otters', true)
on conflict (id) do nothing;

drop policy if exists "otters public read" on storage.objects;
create policy "otters public read" on storage.objects
  for select using (bucket_id = 'otters');

-- =============================================================================
-- SEED DATA — the content worth keeping from the current site.
-- =============================================================================

insert into site_settings (key, value) values
  ('club', '{
     "name": "Carnforth & District Otters ASC",
     "shortName": "Carnforth Otters",
     "tagline": "Lancaster''s competitive swimming club",
     "strapline": "SwimMark accredited. Volunteer run. Swimmers aged 4 to masters.",
     "email": "info@carnforthotters.co.uk",
     "facebook": "https://www.facebook.com/CARNFORTHOTTERS/",
     "youtube": "https://www.youtube.com/@carnforth_otters",
     "swimManager": "https://carnforth.swimmanager.co.uk",
     "primaryVenue": "Salt Ayre Leisure Centre, Lancaster"
   }'::jsonb)
on conflict (key) do nothing;

insert into gala_series (slug, name, blurb, accent, sort_order) values
  ('winter-gala', 'Winter Gala', 'Our short-course winter meet at Salt Ayre — heats and finals across two days.', 'purple', 1),
  ('summer-gala', 'Summer Gala', 'The end-of-season summer meet, open to visiting clubs.', 'teal', 2),
  ('club-champs', 'Club Championships', 'Otters-only championships deciding the club titles and trophies.', 'gold', 3),
  ('time-trials', 'Time Trials', 'Low-pressure internal time trials for qualifying times and PBs.', 'purple', 4)
on conflict (slug) do nothing;

insert into squads (slug, name, tagline, hours_guide, description, sort_order) values
  ('development', 'Development', 'First steps into club swimming', '1-1.5 hrs', 'Entry level for young swimmers, moving from two to three sessions a week. Lessons follow the National Plan for Teaching Swimming.', 1),
  ('cubs', 'Cubs', 'Learning to train', '1-1.5 hrs', 'Entry level for young swimmers building towards full club training.', 2),
  ('otters-1', 'Otters 1', 'Ready for full lengths', '2.5-3 hrs', 'Almost ready for the main 25m pool and training full lengths at Carnforth.', 3),
  ('otters-2', 'Otters 2', 'Building stroke range', '2.5-3 hrs', 'Developing all four strokes and racing skills ahead of the Junior squads.', 4),
  ('j-squad', 'J-Squad', 'Junior competitive squad', '4-6 hrs', 'Junior Lower, Middle and Top groups — from first 25m races through to Cumbrian League age group swimming.', 5),
  ('t-squad', 'T-Squad', 'Senior performance squad', '6-7.5+ hrs', 'Older swimmers training towards regional and national qualification, with land training alongside pool sessions.', 6),
  ('masters', 'Masters', 'Adult swimming', '2-3 hrs', 'Adults training to take their best times to the next level, from fitness swimmers to Masters competitors.', 7)
on conflict (slug) do nothing;

insert into venues (slug, name, address, length_m, lanes, notes, sort_order) values
  ('salt-ayre', 'Salt Ayre Leisure Centre', 'Salt Ayre Lane, Lancaster', 25, 8, 'Our main pool and the home of our galas. Electronic timing installed.', 1),
  ('salt-ayre-tank', 'Salt Ayre Training Tank', 'Salt Ayre Lane, Lancaster', 20, 4, 'Smaller teaching pool used by Development, Cubs and Otters squads.', 2),
  ('carnforth', 'Carnforth Pool', 'Carnforth High School, Carnforth', 20, 4, 'Friday evening sessions.', 3),
  ('heysham', 'Heysham Pool', 'Heysham High School, Morecambe', 25, 6, 'Additional lane time for J-Squad and T-Squad.', 4)
on conflict (slug) do nothing;

insert into pages (slug, title, section, intro, body, sort_order) values
  ('about', 'About the Otters', 'about',
   'A Lancaster based, SwimMark accredited competitive swimming club — and home to a world record holder and a 2012 Olympic finalist.',
   E'We are an extremely friendly club with swimmers aged 4 to masters, training to compete at club, regional and national level.\n\nWhether you want to be an Olympic champion or simply swim better than you did last month, our qualified coaches work to a structured performance programme built for long-term athletic development, backed by continuous professional development and direct coaching input from Ian Ingman.\n\nThe club is run and coached **entirely by volunteers**, who give their time, knowledge and experience for the benefit of every swimmer in the club.\n\n## What a year looks like\n\nTwo main social events, including the Presentation Evening where our long-standing trophies are awarded. Several galas for our younger and older swimmers, plus time trials through the season. A yearly training camp abroad with week-long 50m pool sessions. And Masters sessions for adults who want to keep racing.\n\n## Investing in the club\n\nWe have installed a full **electronic timing system**, so our home galas run with accurate, instant timing and live results. We have also moved to an online management system that improves communication, simplifies competition entries and makes payments easier.',
   1),
  ('policies', 'Policies & Safeguarding', 'policies',
   'Everything that governs how the club is run, and how we keep swimmers safe.',
   E'Carnforth Otters is affiliated to Swim England and operates under **Wavepower**, Swim England''s child safeguarding policy and procedures for clubs.\n\nIf you have a concern about the welfare of a child at the club, speak to our Welfare Officer. You will find their contact details on the Who''s Who page. Concerns are always taken seriously and handled confidentially.\n\nOur published club documents are listed below.',
   2),
  ('team-protocol', 'Team Protocol', 'competing',
   'What is expected of swimmers, parents and team managers at a gala.',
   E'## Before the gala\n\nArrive in good time for warm-up. Team kit should be worn poolside. Swimmers report to the team manager on arrival and stay in the team area unless racing or warming down.\n\n## During the gala\n\nSwimmers report to marshalling when their event is called. Parents stay in the spectator area — poolside is for swimmers, coaches, team managers and licensed officials only.\n\n## Withdrawals\n\nIf a swimmer cannot race, tell the team manager as early as possible so the withdrawal can be processed before the session starts.',
   3),
  ('competition-faqs', 'Competition FAQs', 'competing',
   'The questions new gala families ask most often.',
   E'## What do the times on the entry form mean?\n\nMost open meets have qualifying times — a swimmer must be faster than the slower cut and slower than the faster cut. Your coach will tell you which meets to enter.\n\n## What is a licensed meet?\n\nLicensed meets (Levels 1–4) produce times that count for rankings and for qualification to county, regional and national championships. Unlicensed meets are for racing experience only.\n\n## What is short course and long course?\n\nShort course is a 25m pool, long course is 50m. Times are not directly comparable — rankings list them separately.\n\n## What should we bring?\n\nTwo pairs of goggles, club hat, club kit, a large towel, drink and snacks, and something to sit on. Galas are long days.',
   4)
on conflict (slug) do nothing;
