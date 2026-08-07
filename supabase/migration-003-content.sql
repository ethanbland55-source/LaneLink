-- =============================================================================
-- Migration 003 — newsletters that span months, and Who's Who grouping
--
-- Run in the Supabase SQL Editor after migration-002. Safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Newsletters
--
-- Issues often cover two months ("July / August"), and a July/August issue only
-- appears in August — so a single date can't describe one. Two dates can: the
-- period it covers, and the archive stops showing phantom gaps for months that
-- never had an issue of their own.
-- ---------------------------------------------------------------------------

alter table newsletters add column if not exists period_start date;
alter table newsletters add column if not exists period_end date;
alter table newsletters add column if not exists page_count int;

-- Backfill from the single date these used to have.
update newsletters
   set period_start = coalesce(period_start, issue_date),
       period_end   = coalesce(period_end, issue_date)
 where period_start is null or period_end is null;

-- Keep issue_date in step as the sort key: an issue is "current" from the
-- month it covers up to. Without this trigger, saving a newsletter fails on
-- issue_date's not-null constraint, because the admin form only asks for the
-- months the issue covers.
create or replace function newsletters_sync_dates() returns trigger as $$
begin
  if new.period_start is null then
    new.period_start := coalesce(new.issue_date, current_date);
  end if;
  if new.period_end is null then new.period_end := new.period_start; end if;
  new.issue_date := new.period_end;
  return new;
end $$ language plpgsql;

drop trigger if exists newsletters_sync_dates_trg on newsletters;
create trigger newsletters_sync_dates_trg
  before insert or update on newsletters
  for each row execute function newsletters_sync_dates();

create index if not exists newsletters_period_idx on newsletters (period_end desc);

-- ---------------------------------------------------------------------------
-- Who's Who
--
-- Someone can genuinely be a coach and a committee member. Rather than printing
-- their card twice, the first section listed is their "home" — full card there,
-- a compact cross-reference everywhere else.
-- ---------------------------------------------------------------------------

alter table people add column if not exists primary_section text;
alter table people add column if not exists phone text;

-- Default the home section to the first one they were given.
update people
   set primary_section = sections[1]
 where primary_section is null and array_length(sections, 1) >= 1;
