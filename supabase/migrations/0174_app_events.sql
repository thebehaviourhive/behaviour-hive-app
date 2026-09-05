-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Time-on-task instrumentation, Pass 2 of 2 -- session/navigation
-- engagement and named-event tracking. Blocked on the same Catherine +
-- DPA review as Pass 1 before any REPORT is produced from this data.
-- Nothing here is surfaced in-product; rows are read only by direct,
-- service-role query for an internal report.
--
-- WHY A SINGLE TABLE OF NAMED EVENTS, NOT A RAW CLICK STREAM: every
-- click captured answers none of the trial's actual questions (time on
-- task, session engagement, feature adoption, drop-off point) better
-- than a handful of named events, and is both more to build and more to
-- store. Named events beat exhaustive capture.
--
-- route STORES THE ROUTE PATTERN, NEVER A RESOLVED RECORD ID. This is
-- the single most important property of this table, so it's stated
-- here as a structural fact, not a style choice: with the id stripped
-- client-side before the row is ever written, this table CANNOT be
-- used to reconstruct which named child's record a member of staff was
-- viewing, or when -- not "we chose not to query it that way", but
-- there is nothing here to query. That's what makes this defensible to
-- a reviewer rather than merely disclosed. DO NOT "improve" this later
-- by adding the resolved id back in for easier analysis -- that would
-- turn an aggregate engagement table into a per-child staff-monitoring
-- log, which is exactly the shape Part 3's own constraint rules out.
--
-- role AND institution_id ARE BOTH CLIENT-REPORTED, NOT SERVER-
-- VERIFIED. Neither is used for any authorization decision -- RLS below
-- gates entirely on auth.uid() -- so a client that mis-reports either
-- one degrades a future report, nothing more; it grants nothing.
-- Recorded here so this assumption is visible to the next person who
-- queries this table, not just to whoever wrote it.
--
-- session_id is a client-generated UUID held in sessionStorage (one per
-- browser tab's lifetime, never a cookie, no cross-device or cross-site
-- correlation possible even in principle) -- session length is derived
-- at query time as max(created_at) - min(created_at) grouped by
-- session_id, not stored.
--
-- event_type is a closed, small set. task_started fires on FIRST INPUT
-- into one of the five timed forms, NOT on mount -- landing on a screen
-- by accident (a wrong tap, a bookmark, a back-navigation) must not
-- count as a started task, or the abandonment rate this table exists to
-- measure would be inflated by noise that was never really an attempt.
-- "How often people land there" is already answered by page_view alone
-- (fired on every navigation, including these five routes) -- no
-- separate "screen viewed" event type is needed to get that answer.
-- task_cancelled fires only where a flow has a real, explicit cancel/
-- back control (the incident stamp and the EOD wizard both do; the ABC
-- logger and morning check-in do not) -- it catches deliberate
-- abandonment, not silent tab-closes. The majority of abandonment is
-- inferred, not fired: a task_started row for a given task type with no
-- matching completed record (Pass 1's own columns) within a generous
-- window is treated as abandoned. search_performed is schema-ready but
-- not wired to a specific search UI in this pass -- named rather than
-- silently dropped.
--
-- RETENTION: Daniel's own proposal -- trial duration plus 90 days, then
-- deleted, with the eventual report itself retained separately as an
-- aggregate document containing no per-event rows. purge_stale_app_
-- events() below implements the deletion half of that on demand; it is
-- NOT scheduled by this migration (this project's pg_cron availability
-- hasn't been checked) -- call it periodically by hand, or wire it to
-- pg_cron / an external scheduled trigger once the exact cutoff date is
-- confirmed with Catherine and the reviewer.

create table public.app_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text,
  institution_id uuid references public.institutions (id) on delete set null,
  session_id uuid not null,
  route text not null,
  event_type text not null check (event_type in ('page_view', 'task_started', 'task_cancelled', 'search_performed')),
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index app_events_user_id_idx on public.app_events (user_id);
create index app_events_session_id_idx on public.app_events (session_id);
create index app_events_created_at_idx on public.app_events (created_at);
create index app_events_event_type_idx on public.app_events (event_type);

alter table public.app_events enable row level security;

-- Self-insert only, matching every other audit-log table's own
-- established pattern in this schema (teacher_updates, activity_log).
create policy "Users can insert their own events"
  on public.app_events for insert to authenticated
  with check (auth.uid() = user_id);

-- Deliberately NO select policy for authenticated -- nobody, not even
-- the person who generated a row, can read app_events back through the
-- client. Reporting is service-role only, matching institution_staff's
-- own "no update/delete policy" precedent for a table nothing should
-- read or write outside its one intended path. No update/delete policy
-- either -- append-only, purged only by the function below.

create or replace function public.purge_stale_app_events(p_before timestamptz)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted bigint;
begin
  delete from public.app_events where created_at < p_before;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- No grant to authenticated -- this is an operational maintenance
-- function, called with the service role (Dashboard SQL editor, a
-- scheduled job, or a trusted server-side script), never from the app.
