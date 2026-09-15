-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Schedules purge_stale_app_events() (migration 0174) on a rolling
-- 90-day retention window -- Daniel's own instruction: long enough to
-- cover the trial and produce a report, short enough that operational
-- telemetry doesn't accumulate indefinitely. Runs daily; each run
-- deletes whatever has crossed 90 days old SINCE THAT RUN, not a fixed
-- cutoff tied to today -- so the table's oldest row never gets much
-- older than 90 days, for as long as this stays scheduled.
--
-- WHAT THIS DELETES, confirmed by reading the LIVE function body
-- (0174), not assumed: exactly one statement, `delete from public.
-- app_events where created_at < p_before`. app_events rows ONLY.
-- This function has no relationship whatsoever to any other table's
-- own timing columns (incidents.recorded_at, any updated_at, a
-- passport section's own "Updated X ago", etc.) -- those belong to the
-- records they sit on and are structurally untouched by this call;
-- there is no code path here that could reach them.
--
-- PG_CRON AVAILABILITY WAS AN OPEN QUESTION as of 0174's own comment
-- ("this project's pg_cron availability hasn't been checked"). This
-- migration is the check: `create extension if not exists pg_cron` is
-- a genuine no-op if already enabled, and fails loudly and
-- specifically (not silently, not partially) if this Supabase plan
-- doesn't support it. If it fails: tell Daniel, who will report back,
-- and the prepared alternative is a Vercel Cron hitting a dedicated
-- API route (src/app/api/cron/purge-app-events/route.ts, checked into
-- the repo but deliberately NOT wired into vercel.json yet, so exactly
-- one mechanism is ever the live source of truth for "this runs
-- daily" -- not both, to avoid ambiguity about which one to check when
-- auditing retention later).
--
-- Idempotent: unschedules any existing job of this same name first, so
-- re-running this migration (e.g. to change the schedule later) can
-- never create a duplicate.

create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'purge-stale-app-events';

select cron.schedule(
  'purge-stale-app-events',
  '0 3 * * *', -- daily, 03:00 UTC -- off-peak, well clear of school hours in Ireland
  $$ select public.purge_stale_app_events(now() - interval '90 days'); $$
);

-- Confirm it took: run this separately afterward (or just read the
-- result of the select above) --
--   select jobid, jobname, schedule, command, active from cron.job where jobname = 'purge-stale-app-events';
-- should return exactly one row, active = true.
