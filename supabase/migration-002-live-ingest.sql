-- =============================================================================
-- Migration 002 — live results ingest
--
-- Run this in the Supabase SQL Editor after schema.sql. Safe to re-run.
--
-- What it adds: the plumbing so Meet Organisation can publish to the site by
-- itself during a gala, the way ResPost currently FTPs files to the old host.
-- =============================================================================

-- Per-gala upload token. The poster script on the meet laptop sends this, so a
-- token can only ever affect the one gala it belongs to — and can be rotated
-- after the meet without touching anything else.
alter table galas add column if not exists ingest_token text;
create unique index if not exists galas_ingest_token_idx on galas (ingest_token)
  where ingest_token is not null;

-- The rolling "last race" panel Meet Organisation maintains during a session.
alter table galas add column if not exists live_html text;
alter table galas add column if not exists live_updated_at timestamptz;

-- When the last file of any kind arrived — drives "updated 2 minutes ago".
alter table galas add column if not exists last_file_at timestamptz;

-- Where a row came from, so a post-meet Lenex import can cleanly supersede the
-- rows that were parsed live from the HTML files.
alter table gala_results add column if not exists source text not null default 'lenex';

-- Start lists live in the same table as results, flagged by kind.
alter table gala_results add column if not exists kind text not null default 'result';
create index if not exists gala_results_kind_idx on gala_results (event_id, kind, sort_order);

-- Entry/seed time for start-list rows (the result columns stay null until the
-- race is swum).
alter table gala_results add column if not exists seed_time text;

-- Per-event publication state, so the programme can say "start lists at warm-up"
-- rather than showing a dead dash.
alter table gala_events add column if not exists has_start_list boolean not null default false;
alter table gala_events add column if not exists results_at timestamptz;

-- Sessions get a published flag driven by what has actually arrived.
alter table gala_sessions add column if not exists start_lists_at timestamptz;
alter table gala_sessions add column if not exists completed_at timestamptz;

-- Give every existing gala a token so nothing needs configuring by hand later.
update galas
   set ingest_token = encode(gen_random_bytes(24), 'hex')
 where ingest_token is null;
