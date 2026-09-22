-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Session types, fixed -> clinic-configurable catalogue. Recon done and
-- confirmed first (per Daniel's own instruction, since this changes the
-- booking data model); this migration is that decision, built. Client
-- code depends on this and ships in a separate, later commit -- this
-- migration is meant to be run alone and confirmed before that lands.
--
-- DECISIONS THIS MIGRATION IMPLEMENTS, per Daniel's own confirmation:
--   1. travel_before_minutes / travel_after_minutes are two independent
--      fields -- packing up after a home visit genuinely takes longer
--      than setting out.
--   2. Every type, INCLUDING online ones, may carry travel/prep minutes
--      -- the seeded "Online" type stays at zero, matching today, but
--      nothing about the schema forces it to.
--   3. Slot step stays clinic-wide (booking_buffer_minutes' own sibling,
--      untouched) -- not a per-type field.
--   4. "Staff arrange it" = is_parent_bookable = false. No staff-side
--      booking surface exists anywhere in this codebase today (checked
--      directly) -- a non-parent-bookable type is simply invisible to
--      the parent-facing picker, exactly how school_observation already
--      behaves. Staff booking on a family's behalf is real, separate,
--      unbuilt work -- recorded, not attempted here.
--   5. bookings snapshots the type's own NAME and MODE at booking time
--      (session_type_name, session_type_mode) -- the same principle as
--      cancellation_policy_snapshot, for the same reason: a booking is
--      a record of what was agreed, not a live view of current config.
--      The FOREIGN KEY (session_type_id) is what keeps retiring a type
--      safe; the SNAPSHOT is what keeps EDITING a type from retroactively
--      relabelling history. Confirmed already-safe and left untouched:
--      the actual start/end/travel TIMESTAMPS were already concrete,
--      stored values before this migration, never derived from the type
--      at read time -- a director shortening a type's length_minutes
--      already could not and still cannot change what a booking already
--      made says its own times were.
--   6. The calendar event's own summary stays "Clinical Session -
--      [passport reference]", exactly as it is today -- deliberately
--      NEVER the type's own name. A director-authored type name ("ADHD
--      Assessment", "Autism Review") on a clinician's shared Google
--      Calendar would put a diagnosis on the calendar -- precisely what
--      the passport reference convention (PRD 9 section 6) exists to
--      prevent. Type names live in this app; nothing here touches
--      src/app/api/scheduling/book/route.ts's own summary string.
--   7. bookings_travel_paired -- the CHECK constraint that used to
--      encode "online has no travel columns, in_person/school_observation
--      both must" -- cannot survive as a CHECK once session_type is a
--      reference into an editable table (a CHECK cannot look up another
--      table's row). Per Daniel's own instruction, the guarantee moves
--      to a TRIGGER, not application code -- "everything this build has
--      learned says a rule held only by the interface is not a rule."
--      Turns out simpler than the constraint it replaces once travel is
--      genuinely independent per-column data rather than mode-derived:
--      it no longer needs to know about session_type OR the type
--      catalogue AT ALL, only that each travel column, if set, properly
--      brackets the session, and that an event id is never set without
--      the window it belongs to. Type-agnostic, so it can never drift
--      from the catalogue the way a hardcoded CHECK would.
--   8. Adversarial coverage -- ships in the SAME session as the client
--      code (Phase 2), not here. This migration is the schema; CHECK UUU
--      (the standing suite currently has none for booking at all --
--      confirmed directly, PRD 9 was proven by one-off scripts) is real
--      regression coverage for a rewritten data model, not a one-off.
--
-- Confirmed in production before writing this: exactly ONE clinic
-- (TBHCLINIC) and exactly TWO bookings exist today, both session_type
-- = 'online' (one cancelled, one active, neither touched by this
-- migration beyond the backfill below). The seeding loop below covers
-- every institution of type = 'clinic', not just this one, in case
-- more exist by the time this runs.

-- =====================================================================
-- 1. session_types -- the catalogue. Same posture as institution_tags
-- (0213): institution-scoped, director-write, broad-staff-read,
-- soft-retire via is_active. NOT the same shape as institution_tags
-- itself (a flat dimension/value pair) -- a session type is a genuinely
-- richer object, closer to this schema's own assessment_instruments/
-- clinical_artefact_types precedent (a real per-institution catalogue
-- row with its own fields other rows reference by id).
--
-- location_mode: 'online' | 'in_person' | 'elsewhere' -- exactly the
-- three-way shape bookings.session_type already had (online/in_person/
-- school_observation), confirmed by recon to be the same underlying
-- taxonomy (does this need a video link vs. does this need travel
-- blocks), now data-driven with a real name per row instead of a fixed
-- enum. 'elsewhere' is what school_observation already was -- an
-- in-person-shaped session away from the clinic itself.
--
-- No uniqueness constraint on (institution_id, name) -- a director
-- retiring "Review" and later wanting a fresh, unrelated type also
-- called "Review" should not be blocked by a name a decommissioned row
-- still holds.
-- =====================================================================

create table if not exists public.session_types (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  name text not null check (trim(name) <> ''),
  description text,
  location_mode text not null check (location_mode in ('online', 'in_person', 'elsewhere')),
  length_minutes integer not null check (length_minutes > 0),
  travel_before_minutes integer not null default 0 check (travel_before_minutes >= 0),
  travel_after_minutes integer not null default 0 check (travel_after_minutes >= 0),
  is_parent_bookable boolean not null default true,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create index if not exists session_types_institution_id_idx on public.session_types (institution_id);

drop trigger if exists set_session_types_updated_at on public.session_types;
create trigger set_session_types_updated_at
  before update on public.session_types
  for each row execute function public.set_updated_at();

alter table public.session_types enable row level security;

-- Read: broad, matching institution_tags exactly -- any active staff
-- member at the institution needs to see the catalogue to manage it or
-- (for a clinician) understand what's offered. Deliberately NOT how a
-- parent reads this -- see get_bookable_session_types() below, the
-- same "operationally sensitive clinic config needs a narrow, purpose-
-- built RPC" shape get_bookable_clinician_details() already uses,
-- because a parent's own RLS has no route into another institution's
-- staff-scoped table.
drop policy if exists "Institution staff can view their own institution's session types" on public.session_types;
create policy "Institution staff can view their own institution's session types"
  on public.session_types for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = session_types.institution_id
        and s.user_id = auth.uid()
    )
  );

-- Write: director-only, matching institution_tags exactly -- direct
-- action (create/edit/retire), no request queue. A hard DELETE is
-- nominally permitted by "for all" (same as institution_tags), but the
-- app itself only ever retires (is_active = false); a genuine attempt
-- to hard-delete a type already referenced by a booking is refused
-- anyway by the FK on bookings.session_type_id below (default RESTRICT,
-- deliberately -- an audit trail never silently loses its referent,
-- matching this schema's own principal_handovers precedent).
drop policy if exists "Directors can manage their own institution's session types" on public.session_types;
create policy "Directors can manage their own institution's session types"
  on public.session_types for all to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = session_types.institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  )
  with check (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = session_types.institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  );

-- =====================================================================
-- 2. Seed every clinic's catalogue with today's three shapes, so every
-- existing booking maps to a real type before bookings itself changes.
-- Travel minutes on "School Observation" (30/30) mirror what
-- bookings_travel_paired already required of it; is_parent_bookable =
-- false mirrors the API boundary that has refused it to parents since
-- the day it shipped -- this migration doesn't change who could ever
-- book one, only makes that refusal data-driven instead of hardcoded.
--
-- Guarded against a partial-then-re-run migration (this SQL editor does
-- not wrap a whole pasted script in one transaction -- CLAUDE.md's own
-- documented 0235/0236 incident): each insert only fires for a clinic
-- that has NO session_types rows at all yet, so re-running this section
-- after an earlier failure never produces duplicate seed rows. There is
-- deliberately no (institution_id, name) uniqueness constraint on the
-- table itself (see the table's own header comment -- a retired type's
-- name should be reusable), so this existence check is what keeps a
-- retry safe instead.
-- =====================================================================

insert into public.session_types
  (institution_id, name, description, location_mode, length_minutes, travel_before_minutes, travel_after_minutes, is_parent_bookable, sort_order)
select id, 'Online', 'One hour, by video call', 'online', 60, 0, 0, true, 0
from public.institutions inst
where inst.type = 'clinic'
  and not exists (
    select 1 from public.session_types st
    where st.institution_id = inst.id and st.name = 'Online'
  );

insert into public.session_types
  (institution_id, name, description, location_mode, length_minutes, travel_before_minutes, travel_after_minutes, is_parent_bookable, sort_order)
select id, 'In-person', 'One hour, at the clinic', 'in_person', 60, 30, 30, true, 1
from public.institutions inst
where inst.type = 'clinic'
  and not exists (
    select 1 from public.session_types st
    where st.institution_id = inst.id and st.name = 'In-person'
  );

insert into public.session_types
  (institution_id, name, description, location_mode, length_minutes, travel_before_minutes, travel_after_minutes, is_parent_bookable, sort_order)
select id, 'School Observation', null, 'elsewhere', 60, 30, 30, false, 2
from public.institutions inst
where inst.type = 'clinic'
  and not exists (
    select 1 from public.session_types st
    where st.institution_id = inst.id and st.name = 'School Observation'
  );

-- =====================================================================
-- 3. bookings -- the new reference plus the snapshot. Nullable at
-- first (existing rows need backfilling before either can be NOT
-- NULL), tightened once the backfill below has run.
-- =====================================================================

alter table public.bookings
  add column if not exists session_type_id uuid references public.session_types (id),
  add column if not exists session_type_name text,
  add column if not exists session_type_mode text;

update public.bookings b
set session_type_id = st.id,
    session_type_name = st.name,
    session_type_mode = st.location_mode
from public.session_types st
where st.institution_id = b.institution_id
  and st.location_mode = case b.session_type
        when 'online' then 'online'
        when 'in_person' then 'in_person'
        when 'school_observation' then 'elsewhere'
      end
  and b.session_type_id is null;

do $$
begin
  if exists (select 1 from public.bookings where session_type_id is null) then
    raise exception 'session_type_id backfill left rows unmapped -- a booking exists at an institution/session_type combination the seed step above did not cover. Investigate before tightening the column to NOT NULL.';
  end if;
end;
$$;

alter table public.bookings
  alter column session_type_id set not null,
  alter column session_type_name set not null,
  alter column session_type_mode set not null;

alter table public.bookings drop constraint if exists bookings_session_type_mode_valid;
alter table public.bookings
  add constraint bookings_session_type_mode_valid
  check (session_type_mode in ('online', 'in_person', 'elsewhere'));

-- =====================================================================
-- 4. bookings_travel_paired -> a trigger (Decision 7), dropped HERE,
-- before the old session_type column below -- bookings_travel_paired's
-- own CHECK expression references session_type directly, so it must be
-- gone before that column can be. Type-agnostic by construction, the
-- trigger that replaces it: it checks the record's own internal
-- consistency, never looks up session_types at all, so it can never
-- drift from the catalogue the way the old hardcoded CHECK could have.
-- Each travel column is independently either null or properly
-- bracketing the session (Decision 1 -- before and after no longer have
-- to agree); an event id is never set without the window it belongs to
-- (the window is written by create_pending_booking() at INSERT, the
-- event id only later by mark_booking_synced() -- this allows exactly
-- that sequence while still refusing a genuinely malformed row).
-- =====================================================================

alter table public.bookings drop constraint if exists bookings_travel_paired;

create or replace function public._bookings_travel_columns_valid()
returns trigger
language plpgsql
as $$
begin
  if new.travel_before_start_at is not null and new.travel_before_start_at >= new.session_start_at then
    raise exception 'travel_before_start_at must be before session_start_at.';
  end if;
  if new.travel_after_end_at is not null and new.travel_after_end_at <= new.session_end_at then
    raise exception 'travel_after_end_at must be after session_end_at.';
  end if;
  if new.travel_before_event_id is not null and new.travel_before_start_at is null then
    raise exception 'travel_before_event_id is set but there is no travel_before_start_at window for it.';
  end if;
  if new.travel_after_event_id is not null and new.travel_after_end_at is null then
    raise exception 'travel_after_event_id is set but there is no travel_after_end_at window for it.';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_travel_columns_valid on public.bookings;
create trigger bookings_travel_columns_valid
  before insert or update on public.bookings
  for each row execute function public._bookings_travel_columns_valid();

-- The old literal-value column and its CHECK are now fully superseded
-- -- session_type_id is the live reference, session_type_name/
-- session_type_mode are the frozen historical record. Safe to drop only
-- now that bookings_travel_paired (which referenced it directly) is
-- gone. Every reader is repointed at the new columns in this same
-- migration (section 8, below), so nothing is left depending on it.
alter table public.bookings drop column if exists session_type;

-- =====================================================================
-- 5. create_pending_booking() -- p_session_type text -> p_session_type_id
-- uuid, a parameter TYPE change, not a new trailing one -- DROP FUNCTION
-- IF EXISTS on the old full signature first, per this schema's own
-- standing rule (send_message()'s own history): a bare CREATE OR
-- REPLACE across a parameter type change creates a second overload, it
-- never collapses onto the old one.
--
-- Resolves the session_type row itself, from p_session_type_id, rather
-- than trusting a name/mode passed in by the caller -- "validate at
-- write time, don't trust the caller" applies to the calling ROUTE just
-- as much as to a client UI, since this is a SECURITY DEFINER RPC a
-- crafted request could call directly. Refuses a type that is retired,
-- not parent-bookable, or belongs to a different institution than the
-- one this clinician is actually engaged through -- the same
-- authorization shape the old bare `not in ('online', 'in_person')`
-- check used to provide, now against real per-clinic configuration
-- instead of two hardcoded literals.
-- =====================================================================

drop function if exists public.create_pending_booking(uuid, uuid, text, timestamptz, timestamptz, timestamptz, timestamptz, text, text);

create or replace function public.create_pending_booking(
  p_passport_id uuid,
  p_clinician_id uuid,
  p_session_type_id uuid,
  p_session_start_at timestamptz,
  p_session_end_at timestamptz,
  p_travel_before_start_at timestamptz,
  p_travel_after_end_at timestamptz,
  p_google_calendar_id text,
  p_cancellation_policy_snapshot text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_institution_id uuid;
  v_type public.session_types;
  v_booking_id uuid;
begin
  if not public.owns_passport(p_passport_id) then
    raise exception 'Only this child''s own parent or guardian can book a session.';
  end if;

  select ca.engaged_by_institution_id into v_institution_id
  from public.clinician_access ca
  where ca.passport_id = p_passport_id
    and ca.clinician_id = p_clinician_id
    and ca.engaged_by = 'institution'
    and ca.is_active = true;

  if v_institution_id is null then
    raise exception 'This clinician is not currently assigned to this child.';
  end if;

  select * into v_type
  from public.session_types
  where id = p_session_type_id
    and institution_id = v_institution_id
    and is_active = true
    and is_parent_bookable = true;

  if not found then
    raise exception 'This session type cannot be booked here.';
  end if;

  insert into public.bookings (
    passport_id, clinician_id, institution_id,
    session_type_id, session_type_name, session_type_mode,
    session_start_at, session_end_at,
    travel_before_start_at, travel_after_end_at,
    google_calendar_id, google_sync_status,
    cancellation_policy_snapshot, consented_at,
    created_by
  ) values (
    p_passport_id, p_clinician_id, v_institution_id,
    v_type.id, v_type.name, v_type.location_mode,
    p_session_start_at, p_session_end_at,
    p_travel_before_start_at, p_travel_after_end_at,
    p_google_calendar_id, 'pending',
    p_cancellation_policy_snapshot, now(),
    auth.uid()
  )
  returning id into v_booking_id;

  return v_booking_id;
exception
  when exclusion_violation then
    raise exception 'This time is no longer available. Please choose another slot.';
end;
$$;

grant execute on function public.create_pending_booking(uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz, text, text) to authenticated;

-- =====================================================================
-- 6. get_bookable_session_types() -- the new parent-facing read, same
-- shape and same reasoning as get_bookable_clinician_details(): a
-- parent's own RLS has no route into another institution's
-- session_types rows, so a SECURITY DEFINER function is what bridges
-- it, re-deriving the institution from the SAME clinician_access join
-- every other booking RPC uses rather than trusting a client-supplied
-- institution id directly. Returns only what the type-selection screen
-- needs to render a card and, on selection, carry forward as this
-- booking's own snapshot-to-be.
-- =====================================================================

create or replace function public.get_bookable_session_types(
  p_passport_id uuid,
  p_clinician_id uuid
)
returns table (
  id uuid,
  name text,
  description text,
  location_mode text,
  length_minutes integer
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_institution_id uuid;
begin
  if not public.owns_passport(p_passport_id) then
    raise exception 'Only this child''s own parent or guardian can check session types.';
  end if;

  select ca.engaged_by_institution_id into v_institution_id
  from public.clinician_access ca
  where ca.passport_id = p_passport_id
    and ca.clinician_id = p_clinician_id
    and ca.engaged_by = 'institution'
    and ca.is_active = true;

  if v_institution_id is null then
    raise exception 'This clinician is not currently assigned to this child.';
  end if;

  return query
  select st.id, st.name, st.description, st.location_mode, st.length_minutes
  from public.session_types st
  where st.institution_id = v_institution_id
    and st.is_active = true
    and st.is_parent_bookable = true
  order by st.sort_order, st.name;
end;
$$;

grant execute on function public.get_bookable_session_types(uuid, uuid) to authenticated;

-- =====================================================================
-- 7. get_institution_has_no_bookable_session_types() -- Item 5 of the
-- recon: a clinic with zero active, parent-bookable types means a
-- parent cannot book at all. A single fact, not a list -- boolean,
-- matching the shape the ClinicDirectorDashboard.tsx client side will
-- render as one WorkQueueRow when true, not a row-per-something bucket
-- like its seven siblings.
-- =====================================================================

create or replace function public.get_institution_has_no_bookable_session_types(p_institution_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and inst.status = 'verified' and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(auth.uid(), p_institution_id)
  ) then
    raise exception 'Only an active clinical director can check this.';
  end if;

  return not exists (
    select 1 from public.session_types
    where institution_id = p_institution_id
      and is_active = true
      and is_parent_bookable = true
  );
end;
$$;

grant execute on function public.get_institution_has_no_bookable_session_types(uuid) to authenticated;

-- =====================================================================
-- 8. Every remaining reader of the old bare session_type column,
-- repointed at session_type_name/session_type_mode. All three widen
-- their own RETURNS TABLE shape -- DROP+CREATE, matching this schema's
-- own "a RETURNS TABLE shape change needs a real drop" precedent.
-- get_my_bookings_needing_attention() has no live caller yet (the sync-
-- drift mechanism it's built for isn't wired up -- lands with the
-- redesign, per Daniel's own note) -- updated anyway, so it isn't the
-- one place quietly left assuming the old column when its caller does
-- arrive.
-- =====================================================================

drop function if exists public.get_my_upcoming_bookings(uuid);

create function public.get_my_upcoming_bookings(p_passport_id uuid)
returns table (
  booking_id uuid,
  clinician_id uuid,
  clinician_name text,
  session_type_name text,
  session_type_mode text,
  session_start_at timestamptz,
  session_end_at timestamptz,
  google_sync_status text,
  google_meet_link text
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.owns_passport(p_passport_id) then
    raise exception 'Only this child''s own parent or guardian can view their bookings.';
  end if;

  return query
  select b.id, b.clinician_id,
    coalesce(c.full_name, u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
    b.session_type_name, b.session_type_mode, b.session_start_at, b.session_end_at, b.google_sync_status, b.google_meet_link
  from public.bookings b
  join auth.users u on u.id = b.clinician_id
  left join public.clinicians c on c.user_id = b.clinician_id
  where b.passport_id = p_passport_id
    and b.cancelled_at is null
    and b.session_end_at > now()
  order by b.session_start_at asc;
end;
$$;

grant execute on function public.get_my_upcoming_bookings(uuid) to authenticated;

drop function if exists public.get_my_booking_history(uuid);

create function public.get_my_booking_history(p_passport_id uuid)
returns table (
  booking_id uuid,
  clinician_id uuid,
  clinician_name text,
  session_type_name text,
  session_type_mode text,
  session_start_at timestamptz,
  session_end_at timestamptz,
  cancelled_at timestamptz,
  cancelled_via text,
  cancellation_reason text,
  google_meet_link text
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.owns_passport(p_passport_id) then
    raise exception 'Only this child''s own parent or guardian can view their bookings.';
  end if;

  return query
  select b.id, b.clinician_id,
    coalesce(c.full_name, u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
    b.session_type_name, b.session_type_mode, b.session_start_at, b.session_end_at,
    b.cancelled_at, b.cancelled_via, b.cancellation_reason, b.google_meet_link
  from public.bookings b
  join auth.users u on u.id = b.clinician_id
  left join public.clinicians c on c.user_id = b.clinician_id
  where b.passport_id = p_passport_id
    and (b.cancelled_at is not null or b.session_end_at <= now())
  order by b.session_start_at desc;
end;
$$;

grant execute on function public.get_my_booking_history(uuid) to authenticated;

drop function if exists public.get_my_bookings_needing_attention();

create function public.get_my_bookings_needing_attention()
returns table (
  booking_id uuid,
  passport_id uuid,
  session_type_name text,
  session_type_mode text,
  session_start_at timestamptz,
  session_end_at timestamptz,
  google_sync_status text
)
language sql
security definer
set search_path = public
stable
as $$
  select b.id, b.passport_id, b.session_type_name, b.session_type_mode, b.session_start_at, b.session_end_at, b.google_sync_status
  from public.bookings b
  where b.clinician_id = auth.uid()
    and b.google_sync_status in ('drifted', 'sync_failed')
  order by b.session_start_at asc;
$$;

grant execute on function public.get_my_bookings_needing_attention() to authenticated;
