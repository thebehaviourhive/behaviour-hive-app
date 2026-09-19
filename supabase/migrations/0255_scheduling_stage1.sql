-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 9, STAGE 1 -- the Google connection and availability. Booking
-- itself (the actual row+event creation, cancellation, reschedule,
-- sync) is Stage 2, deliberately not built here. This migration lays
-- the ground three things depend on: a director-set Workspace email
-- per clinician, clinic-wide scheduling settings (hours/buffer/booking
-- window, same shape as the existing temporary_access precedent), and
-- the bookings table itself -- created now so Stage 2 has somewhere to
-- write, with its own reconciliation/orphan-handling machinery decided
-- and built now rather than retrofitted later.
--
-- CLINIC-ONLY, THROUGHOUT. Every new RPC below checks inst.type =
-- 'clinic' alongside the ordinary active-principal check -- PRD 9
-- section 10.4 is explicit that school-engaged clinicians never get
-- this, and a school principal must never be able to set a workspace
-- email or clinic-hours setting through these RPCs just because they
-- happen to hold the same role name.

-- =====================================================================
-- 1. clinicians.workspace_email -- DIRECTOR-SET, not self-declared.
--
-- Checked against this schema's own two live patterns for "a fact
-- about a clinician" (specialty/domain_tags: self-declared, zero
-- verification; verification_status/clinician_code: director/
-- behaviour-hive approved, no client UPDATE policy at all) before
-- picking one. A Workspace email is not like specialty -- a wrong
-- specialty costs nothing beyond a mislabelled clinician; a wrong
-- Workspace email that happens to be a REAL address belonging to a
-- different real person in the same domain means the service account
-- silently reads and writes THAT person's calendar under Domain-Wide
-- Delegation, and nothing fails to say so. A non-existent address
-- fails cleanly; a real-but-wrong one does not fail at all. Only a
-- director's own knowledge of their own roster closes that gap --
-- hence director-set, via a dedicated RPC, no client UPDATE policy on
-- this column at all (same posture as verification_status).
-- =====================================================================

alter table public.clinicians
  add column if not exists workspace_email text;

create unique index if not exists clinicians_workspace_email_unique
  on public.clinicians (workspace_email)
  where workspace_email is not null;

create or replace function public.set_clinician_workspace_email(
  p_institution_id uuid,
  p_clinician_user_id uuid,
  p_workspace_email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_principal boolean;
  v_target_is_clinician boolean;
  v_email text;
begin
  -- institution_staff_has_current_standing() is this schema's own
  -- standing helper for deactivated_at/approved_at -- never hand-write
  -- those two conditions again (CLAUDE.md: got wrong three times
  -- before this helper existed). Role and institution-type are
  -- checked separately since the helper only knows about standing.
  select exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and inst.status = 'verified'
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(auth.uid(), p_institution_id)
  ) into v_is_principal;

  if not v_is_principal then
    raise exception 'Only an active clinical director can set a clinician''s Workspace email.';
  end if;

  select exists (
    select 1 from public.institution_staff s
    where s.institution_id = p_institution_id
      and s.user_id = p_clinician_user_id
      and s.role = 'clinician'
      and public.institution_staff_has_current_standing(p_clinician_user_id, p_institution_id)
  ) into v_target_is_clinician;

  if not v_target_is_clinician then
    raise exception 'This person is not an active clinician at your clinic.';
  end if;

  v_email := lower(trim(p_workspace_email));
  if v_email is null or v_email = '' then
    raise exception 'A Workspace email is required.';
  end if;

  update public.clinicians
  set workspace_email = v_email
  where user_id = p_clinician_user_id;

  if not found then
    raise exception 'No clinician profile exists for this person yet.';
  end if;
end;
$$;

grant execute on function public.set_clinician_workspace_email(uuid, uuid, text) to authenticated;

-- =====================================================================
-- 2. Clinic-wide scheduling settings on institutions -- same shape
-- temporary_access_start_time/cutoff_time already take (0105/0133):
-- real columns with sane defaults (never left null forever, waiting
-- for a director who might not visit a settings screen for months),
-- one narrow RPC per setting, each re-checking active-principal-at-a-
-- clinic the same way set_clinician_workspace_email does above.
--
-- Defaults chosen deliberately, not copied from temporary_access
-- (that feature's own 07:30/15:00 defaults are a SCHOOL DAY's shape --
-- a clinic's working day is a different thing entirely): 09:00-17:00
-- ordinary business hours, 15 minute buffer, 30 day rolling booking
-- window per PRD section 10.1's own explicit default.
-- =====================================================================

alter table public.institutions
  add column if not exists clinic_hours_start_time time not null default '09:00:00',
  add column if not exists clinic_hours_end_time time not null default '17:00:00',
  add column if not exists booking_buffer_minutes integer not null default 15
    check (booking_buffer_minutes >= 0 and booking_buffer_minutes <= 120),
  add column if not exists booking_window_days integer not null default 30
    check (booking_window_days > 0 and booking_window_days <= 365);

alter table public.institutions
  drop constraint if exists institutions_clinic_hours_window_valid;
alter table public.institutions
  add constraint institutions_clinic_hours_window_valid
  check (clinic_hours_start_time < clinic_hours_end_time);

create or replace function public.set_clinic_hours(
  p_institution_id uuid,
  p_start_time time,
  p_end_time time
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id and s.user_id = auth.uid()
      and s.role = 'principal'
      and inst.status = 'verified' and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(auth.uid(), p_institution_id)
  ) then
    raise exception 'Only an active clinical director can set clinic hours.';
  end if;

  if p_start_time >= p_end_time then
    raise exception 'Clinic hours start must be before the end.';
  end if;

  update public.institutions
  set clinic_hours_start_time = p_start_time, clinic_hours_end_time = p_end_time
  where id = p_institution_id;
end;
$$;

grant execute on function public.set_clinic_hours(uuid, time, time) to authenticated;

create or replace function public.set_booking_buffer_minutes(
  p_institution_id uuid,
  p_minutes integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id and s.user_id = auth.uid()
      and s.role = 'principal'
      and inst.status = 'verified' and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(auth.uid(), p_institution_id)
  ) then
    raise exception 'Only an active clinical director can set the booking buffer.';
  end if;

  if p_minutes < 0 or p_minutes > 120 then
    raise exception 'Buffer must be between 0 and 120 minutes.';
  end if;

  update public.institutions set booking_buffer_minutes = p_minutes where id = p_institution_id;
end;
$$;

grant execute on function public.set_booking_buffer_minutes(uuid, integer) to authenticated;

create or replace function public.set_booking_window_days(
  p_institution_id uuid,
  p_days integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id and s.user_id = auth.uid()
      and s.role = 'principal'
      and inst.status = 'verified' and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(auth.uid(), p_institution_id)
  ) then
    raise exception 'Only an active clinical director can set the booking window.';
  end if;

  if p_days <= 0 or p_days > 365 then
    raise exception 'Booking window must be between 1 and 365 days.';
  end if;

  update public.institutions set booking_window_days = p_days where id = p_institution_id;
end;
$$;

grant execute on function public.set_booking_window_days(uuid, integer) to authenticated;

-- =====================================================================
-- 3. get_bookable_clinician_details() -- the one RPC the Stage 1
-- availability route needs. Resolves, in one call, whether this
-- clinician is genuinely on this child's INSTITUTION-engaged caseload
-- (engaged_by = 'institution', is_active = true -- parent-engaged
-- clinicians are never bookable this way, PRD section 3), and if so
-- their Workspace email plus their clinic's own scheduling settings.
--
-- SECURITY DEFINER and narrow, matching this schema's own established
-- reason for this shape (get_approved_institution_phone() is the
-- direct precedent): clinicians.workspace_email is operationally
-- sensitive routing data, not something to expose via a broad SELECT
-- policy just so a parent's own client can read it directly.
-- =====================================================================

create or replace function public.get_bookable_clinician_details(
  p_passport_id uuid,
  p_clinician_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_result jsonb;
begin
  if not public.owns_passport(p_passport_id) then
    raise exception 'Only this child''s own parent or guardian can check availability.';
  end if;

  select jsonb_build_object(
    'workspace_email', c.workspace_email,
    'institution_id', ca.engaged_by_institution_id,
    'clinic_hours_start_time', inst.clinic_hours_start_time,
    'clinic_hours_end_time', inst.clinic_hours_end_time,
    'booking_buffer_minutes', inst.booking_buffer_minutes,
    'booking_window_days', inst.booking_window_days,
    'full_name', c.full_name,
    'specialty', c.specialty
  )
  into v_result
  from public.clinician_access ca
  join public.clinicians c on c.user_id = ca.clinician_id
  join public.institutions inst on inst.id = ca.engaged_by_institution_id
  where ca.passport_id = p_passport_id
    and ca.clinician_id = p_clinician_id
    and ca.engaged_by = 'institution'
    and ca.is_active = true
    and inst.type = 'clinic';

  if v_result is null then
    raise exception 'This clinician is not currently assigned to this child.';
  end if;

  if v_result ->> 'workspace_email' is null then
    raise exception 'This clinician is not yet set up for scheduling. Ask your clinical director.';
  end if;

  return v_result;
end;
$$;

grant execute on function public.get_bookable_clinician_details(uuid, uuid) to authenticated;

-- =====================================================================
-- 4. The bookings table. A row first, the calendar event its
-- destination -- see the PRD 9 recon's own header comment on this
-- table for the full reasoning behind every column here. Built now,
-- in full, even though Stage 2 owns the only code path that will ever
-- INSERT into it -- the reconciliation/orphan-handling shape (sync
-- status, the exclude constraint, the two closing RPCs below) is part
-- of THIS design, decided once, not something to retrofit once Stage 2
-- discovers it's missing.
--
-- NO STATUS COLUMN, deliberately -- this schema's own standing
-- convention (passport_completion_requests, incidents' own derived
-- status) applies directly: "confirmed" is cancelled_at is null,
-- "completed" is cancelled_at is null and session_end_at < now(),
-- both computed at read time. A stored status column would just be a
-- second place the same fact could drift from the timestamps that
-- actually define it.
--
-- TRAVEL BLOCKS ARE FLAT COLUMNS, NOT A CHILD TABLE -- a travel block
-- never exists independently of its own session (created with it,
-- moves with it, deleted with it), and nothing in this PRD ever needs
-- to query "all travel blocks" as their own collection. Only the OUTER
-- bounds are stored (travel_before_start_at, travel_after_end_at) --
-- the inner bounds are already session_start_at/session_end_at, since
-- a travel block is always contiguous with its session by
-- construction; storing all four boundary timestamps would just be
-- two more places for an inconsistency to hide.
--
-- google_calendar_id IS FROZEN AT BOOKING TIME, not read live off the
-- clinician's current workspace_email -- if a director later corrects
-- a typo in that mapping, an already-written booking must still
-- resolve to the calendar it was ACTUALLY written to.
--
-- cancellation_policy_snapshot IS COPIED TEXT, not a foreign key into
-- a versioned policy table -- the requirement only ever needs to
-- answer "what did this parent agree to at the time", the same
-- narrower-than-a-full-revision-table shape session_notes' own two
-- edit-tracking columns already established for an identical kind of
-- question.
-- =====================================================================

create extension if not exists btree_gist;

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports(id) on delete cascade,
  clinician_id uuid not null references auth.users(id),
  institution_id uuid not null references public.institutions(id),

  session_type text not null check (session_type in ('online', 'in_person', 'school_observation')),
  session_start_at timestamptz not null,
  session_end_at timestamptz not null,
  travel_before_start_at timestamptz,
  travel_after_end_at timestamptz,

  -- The calendar the event(s) were actually written to -- frozen, see
  -- this migration's own header comment above.
  google_calendar_id text not null,
  google_event_id text,
  travel_before_event_id text,
  travel_after_event_id text,

  -- pending: row exists, Google write not yet confirmed (a narrow,
  --   transient state -- see fail_stale_pending_bookings() below for
  --   what happens if it never leaves this state).
  -- synced: last check confirmed the event still exists and matches.
  -- drifted: the clinician moved the event's time directly in Google.
  --   NEVER auto-resolved either direction (Daniel's own instruction):
  --   not silently adopted as a reschedule (that changes what the
  --   parent agreed to without asking them), and not auto-cancelled
  --   either (that costs the parent their slot for something nobody
  --   asked to happen). Surfaced to the CLINICIAN via
  --   get_my_bookings_needing_attention() below, left exactly as it
  --   was until a human -- the clinician -- resolves it by rescheduling
  --   or cancelling properly, in the app.
  -- sync_failed: the Google-side create/update/delete call itself
  --   failed outright (API error, quota, an invalidated workspace_email)
  --   -- distinct from drifted, since here the two were never brought
  --   into agreement in the first place. Also reaches the clinician via
  --   the same queue -- it's their calendar and their session; only
  --   they can tell whether the time is genuinely free.
  google_sync_status text not null default 'pending'
    check (google_sync_status in ('pending', 'synced', 'drifted', 'sync_failed')),
  google_last_synced_at timestamptz,
  google_etag text,

  cancellation_policy_snapshot text,
  consented_at timestamptz not null,

  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancelled_via text check (cancelled_via in ('parent', 'clinician_google', 'director', 'discharge', 'rescheduled', 'system')),
  cancellation_reason text,
  rescheduled_from_booking_id uuid references public.bookings(id),

  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),

  constraint bookings_session_times_valid check (session_end_at > session_start_at),

  -- Paired with session_type: online carries no travel columns at all;
  -- in_person/school_observation must carry both, genuinely bracketing
  -- the session.
  constraint bookings_travel_paired check (
    (
      session_type = 'online'
      and travel_before_start_at is null and travel_after_end_at is null
      and travel_before_event_id is null and travel_after_event_id is null
    )
    or
    (
      session_type in ('in_person', 'school_observation')
      and travel_before_start_at is not null and travel_after_end_at is not null
      and travel_before_start_at < session_start_at
      and travel_after_end_at > session_end_at
    )
  ),

  constraint bookings_cancelled_paired check (
    (cancelled_at is null and cancelled_by is null and cancelled_via is null)
    or (cancelled_at is not null and cancelled_via is not null)
  )
);

comment on table public.bookings is
  'A row is written before any Google API call; the calendar event is its destination, not its origin. Booking creation, cancellation, reschedule, and the actual Google sync loop are all Stage 2 -- this migration only lays the schema, so Stage 2 has nowhere new to invent. Never delete a row: cancellation is cancelled_at, not removal, matching every other clinical record in this schema.';

create unique index bookings_google_event_id_unique
  on public.bookings (google_event_id)
  where google_event_id is not null;

-- Structural backstop against double-booking, independent of and in
-- addition to Stage 2's own application-level re-check at booking
-- time -- the PRD's own "no holds, no reservations, no locking"
-- accepts a RACE at the application layer, but nothing should ever let
-- two genuinely overlapping ACTIVE bookings (session AND travel) exist
-- as rows for the same clinician even if two concurrent requests both
-- somehow passed the Freebusy check (a lagging read, a bug in Stage
-- 2's own retry logic, anything). Range includes the travel blocks --
-- coalesce falls back to the session bounds for online, where there
-- are none.
alter table public.bookings add constraint bookings_no_overlap
  exclude using gist (
    clinician_id with =,
    tstzrange(
      coalesce(travel_before_start_at, session_start_at),
      coalesce(travel_after_end_at, session_end_at)
    ) with &&
  ) where (cancelled_at is null);

create index bookings_passport_id_idx on public.bookings (passport_id);
create index bookings_clinician_id_idx on public.bookings (clinician_id);
create index bookings_institution_id_idx on public.bookings (institution_id);

alter table public.bookings enable row level security;

-- SELECT only. No INSERT/UPDATE/DELETE policy exists on this table at
-- all -- matching bsp's own "functions only" posture. Stage 2 owns
-- every mutation, through SECURITY DEFINER RPCs written when the
-- booking/cancel/reschedule/sync mechanics themselves are built; a raw
-- client write against this table should never be possible, now or
-- later.
create policy "Parent can view their own child's bookings"
  on public.bookings for select
  to authenticated
  using (public.owns_passport(passport_id));

create policy "Clinician can view their own bookings"
  on public.bookings for select
  to authenticated
  using (clinician_id = auth.uid());

create policy "Director can view their own clinic's bookings"
  on public.bookings for select
  to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = bookings.institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(auth.uid(), bookings.institution_id)
    )
  );

-- =====================================================================
-- 5. The two gaps closed, per Daniel's own instruction, before Stage 2
-- starts writing rows into this table.
-- =====================================================================

-- Gap 1: sync_failed (and drifted) must reach the clinician -- their
-- calendar, their session, only they can tell whether the time is
-- really free. Not a director's queue, not a log nobody reads.
create or replace function public.get_my_bookings_needing_attention()
returns table (
  booking_id uuid,
  passport_id uuid,
  session_type text,
  session_start_at timestamptz,
  session_end_at timestamptz,
  google_sync_status text
)
language sql
security definer
set search_path = public
stable
as $$
  select b.id, b.passport_id, b.session_type, b.session_start_at, b.session_end_at, b.google_sync_status
  from public.bookings b
  where b.clinician_id = auth.uid()
    and b.cancelled_at is null
    and b.google_sync_status in ('drifted', 'sync_failed')
  order by b.session_start_at asc;
$$;

grant execute on function public.get_my_bookings_needing_attention() to authenticated;

-- Gap 2: a pending row that never gets a Google response (the process
-- dies between the insert and the Google call) must not sit there
-- looking like a real booking forever. Never deleted -- a booking
-- attempt that failed is a real fact worth keeping, the same "the
-- record stays" reasoning this schema applies everywhere else -- just
-- reclassified as sync_failed once it's been pending for longer than
-- any real Google round-trip should ever take, which also means it
-- surfaces to the clinician via the exact same queue above with no
-- separate mechanism needed. service_role only -- called from a cron
-- route, matching purge_stale_app_events()'s own established shape,
-- never client-callable.
create or replace function public.fail_stale_pending_bookings(p_older_than_minutes integer default 5)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.bookings
  set google_sync_status = 'sync_failed'
  where google_sync_status = 'pending'
    and cancelled_at is null
    and created_at < now() - (p_older_than_minutes || ' minutes')::interval;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.fail_stale_pending_bookings(integer) from public, authenticated, anon;
grant execute on function public.fail_stale_pending_bookings(integer) to service_role;

-- =====================================================================
-- 6. get_institution_clinicians() widened with workspace_email -- the
-- director's own Directory > Clinicians list is the natural, existing
-- place to set/correct a clinician's Workspace email, and doing that
-- correctly means seeing the CURRENT value first (never a blind
-- overwrite). This RPC is shared across school and clinic institution
-- types (ClinicianList.tsx) -- workspace_email is simply always null
-- for a school-engaged clinician, since set_clinician_workspace_email()
-- itself refuses to write it for anything but a clinic. Widening a
-- RETURNS TABLE needs DROP FUNCTION IF EXISTS first, never a bare
-- CREATE OR REPLACE -- this schema's own standing rule (Postgres
-- refuses to change a function's return shape in place).
-- =====================================================================

drop function if exists public.get_institution_clinicians(uuid);

create function public.get_institution_clinicians(p_institution_id uuid)
returns table (
  clinician_id uuid,
  full_name text,
  specialty text,
  covered_child_count integer,
  workspace_email text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    c.user_id as clinician_id,
    c.full_name,
    c.specialty,
    count(*)::integer as covered_child_count,
    c.workspace_email
  from public.clinician_access ca
  join public.clinicians c on c.user_id = ca.clinician_id
  where ca.engaged_by = 'institution'
    and ca.engaged_by_institution_id = p_institution_id
    and ca.is_active = true
    and public.is_verified_clinician(c.user_id)
    and exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and inst.status = 'verified'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  group by c.user_id, c.full_name, c.specialty, c.workspace_email
  order by c.full_name;
$$;

grant execute on function public.get_institution_clinicians(uuid) to authenticated;
