-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Found live: the Booked screen's own "Where" line was hardcoded --
-- "At the clinic -- please ask them for directions if you haven't
-- visited before" -- for EVERY in-person type, regardless of where
-- that type actually happens. Daniel booked "In-person (Home)" (a
-- real, already-created type at TBHCLINIC) and was told to go to the
-- clinic. Confirmed directly: session_types has no field distinguishing
-- "in-person at the clinic" from "in-person at the family's home" from
-- "in-person at the child's school" -- location_mode alone was never
-- meant to carry that distinction, only whether the session needs a
-- video link vs travel blocks.
--
-- location_details text, director-written, on the type -- the same
-- posture as everything else on session_types (direct client write,
-- no dedicated RPC, RLS already director-only "for all"). Shown
-- VERBATIM, never templated -- the director's own words, matching how
-- cancellation_policy_text already works.
--
-- THIS SUPERSEDES institutions.address FOR THIS PURPOSE (migration
-- 0283, this same session) -- named here plainly rather than left to
-- be silently rediscovered as dead code later. A clinic's own address
-- was always too coarse: a type held at a family's home or a child's
-- school was never "the clinic's address" to begin with. institutions
-- .address itself is left in place (not asked to be removed, harmless
-- to keep), but the booking flow stops reading it -- session_types.
-- location_details is now the one source for WHERE.
--
-- SNAPSHOT (Decision, this session): bookings.session_type_location_
-- details, written by create_pending_booking() at booking time,
-- exactly like session_type_name/session_type_mode already are -- a
-- director editing a type's own location text later must never change
-- what a PAST booking told a parent. create_pending_booking()'s own
-- signature is unchanged (only its INSERT gains one more column), so
-- this is a safe bare CREATE OR REPLACE, no DROP needed.
--
-- FALLBACK, never the clinic text for a type that isn't at the clinic:
-- blank location_details on an in_person/elsewhere type falls back to
-- a genuinely neutral sentence ("Your clinic will confirm the exact
-- location.") -- built into src/lib/scheduling/locationDetails.ts, not
-- this migration; there is no per-mode default to seed here beyond the
-- three ORIGINAL types below, which get real text because their own
-- real-world location is actually known and unambiguous.
--
-- SEEDING: matched on the EXACT original 0281 seed shape (name +
-- description + location_mode + length_minutes together), not on name
-- alone -- a director who already renamed their own "In-person" type,
-- or created an unrelated type that happens to share a name, must
-- never be silently touched by this update. TBHCLINIC's own real
-- "In-person (Home)" type (created after 0281, description "One hour,
-- in your home") does NOT match this shape and is correctly left
-- alone, starting blank until its own director writes real text --
-- exactly the case this whole migration exists to stop mishandling.
-- =====================================================================

alter table public.session_types add column if not exists location_details text;
alter table public.bookings add column if not exists session_type_location_details text;

update public.session_types st
set location_details = coalesce(
  case when inst.address is not null and trim(inst.address) <> ''
    then 'At our clinic, ' || inst.address
    else 'At the clinic -- please ask them for directions if you haven''t visited before.'
  end,
  location_details
)
from public.institutions inst
where inst.id = st.institution_id
  and st.name = 'In-person'
  and st.description = 'One hour, at the clinic'
  and st.location_mode = 'in_person'
  and st.length_minutes = 60
  and st.location_details is null;

update public.session_types
set location_details = 'At your child''s school.'
where name = 'School Observation'
  and description is null
  and location_mode = 'elsewhere'
  and length_minutes = 60
  and location_details is null;

-- create_pending_booking() -- body-only change, snapshotting
-- location_details the same way session_type_name/mode already are.
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
    session_type_id, session_type_name, session_type_mode, session_type_location_details,
    session_start_at, session_end_at,
    travel_before_start_at, travel_after_end_at,
    google_calendar_id, google_sync_status,
    cancellation_policy_snapshot, consented_at,
    created_by
  ) values (
    p_passport_id, p_clinician_id, v_institution_id,
    v_type.id, v_type.name, v_type.location_mode, v_type.location_details,
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

-- get_bookable_session_types() -- widened again (4th time this table's
-- own read RPC has grown), same DROP+CREATE discipline.
drop function if exists public.get_bookable_session_types(uuid, uuid);

create function public.get_bookable_session_types(
  p_passport_id uuid,
  p_clinician_id uuid
)
returns table (
  id uuid,
  name text,
  description text,
  location_mode text,
  length_minutes integer,
  travel_before_minutes integer,
  travel_after_minutes integer,
  location_details text
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
  select st.id, st.name, st.description, st.location_mode, st.length_minutes,
    st.travel_before_minutes, st.travel_after_minutes, st.location_details
  from public.session_types st
  where st.institution_id = v_institution_id
    and st.is_active = true
    and st.is_parent_bookable = true
  order by st.sort_order, st.name;
end;
$$;

grant execute on function public.get_bookable_session_types(uuid, uuid) to authenticated;

-- get_my_upcoming_bookings() -- widened to surface the SNAPSHOTTED
-- location text, same reasoning as cancelled_at/via/reason already
-- being included: a resolved-not-time-filtered queue and an
-- Upcoming card both need what was actually agreed, not the live type.
drop function if exists public.get_my_upcoming_bookings(uuid);

create function public.get_my_upcoming_bookings(p_passport_id uuid)
returns table (
  booking_id uuid,
  clinician_id uuid,
  clinician_name text,
  session_type_name text,
  session_type_mode text,
  session_type_location_details text,
  session_start_at timestamptz,
  session_end_at timestamptz,
  google_sync_status text,
  google_meet_link text,
  cancelled_at timestamptz,
  cancelled_via text,
  cancellation_reason text
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
    b.session_type_name, b.session_type_mode, b.session_type_location_details, b.session_start_at, b.session_end_at, b.google_sync_status, b.google_meet_link,
    b.cancelled_at, b.cancelled_via, b.cancellation_reason
  from public.bookings b
  join auth.users u on u.id = b.clinician_id
  left join public.clinicians c on c.user_id = b.clinician_id
  where b.passport_id = p_passport_id
    and b.session_end_at > now()
  order by b.session_start_at asc;
end;
$$;

grant execute on function public.get_my_upcoming_bookings(uuid) to authenticated;
