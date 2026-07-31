-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Adds the actual wizard answers to morning_checkins. The table already
-- has checked_in_at (set at row-creation time, used for the "already
-- checked in today" query on the dashboard) — submitted_at is added
-- separately so the dashboard can show the parent the exact time their
-- check-in was sent, without overloading checked_in_at's existing meaning.

alter table public.morning_checkins
  add column if not exists sleep_quality text
    check (sleep_quality in ('slept_through', 'woke_briefly', 'very_restless', 'barely_slept')),
  add column if not exists regulation_state text
    check (regulation_state in ('settled', 'unsettled', 'dysregulated')),
  add column if not exists morning_stressors text[],
  add column if not exists heads_up text,
  add column if not exists submitted_at timestamptz not null default now();
