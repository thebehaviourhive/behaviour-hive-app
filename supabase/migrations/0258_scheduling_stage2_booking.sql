-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 9, STAGE 2 -- booking, the visible half. The Google connection and
-- availability (Stage 1, 0255/0256/0257) already work; this migration
-- adds everything a real booking-creation-and-cancellation flow needs
-- at the database layer. The actual Google writes (creating/deleting
-- calendar events) can only happen in a Next.js route -- a Postgres
-- function has no way to reach Google -- so every RPC here does exactly
-- the half of the work SQL can do (authorization, the row itself,
-- reconciliation state) and returns what the calling route needs to do
-- the rest.
--
-- Recon-first, per Daniel's own instruction, before any of this was
-- written -- five points answered, two more surfaced and answered in
-- the same pass. Recorded in full where each piece lands below, not
-- only here.

-- =====================================================================
-- 1. Cancellation policy source columns. bookings.cancellation_policy_
-- snapshot (Stage 1) is the destination; these are the source. Same
-- shape as clinic_hours/booking_buffer/booking_window (0255): real
-- columns with sane defaults where a default makes sense, one narrow
-- director-only RPC per setting, surfaced on /principal/clinic.
--
-- cancellation_notice_hours defaults to 24 (a real, sane starting
-- point every clinic can change) -- cancellation_policy_text has NO
-- default text invented for it, deliberately: this is the director's
-- own words, in their own clinic's voice, and a placeholder sentence
-- silently standing in for "nobody has written this yet" would be
-- worse than an honest null the booking flow can check for.
-- =====================================================================

alter table public.institutions
  add column if not exists cancellation_notice_hours integer not null default 24
    check (cancellation_notice_hours >= 0 and cancellation_notice_hours <= 720),
  add column if not exists cancellation_policy_text text;

create or replace function public.set_cancellation_notice_hours(
  p_institution_id uuid,
  p_hours integer
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
    raise exception 'Only an active clinical director can set the cancellation notice period.';
  end if;

  if p_hours < 0 or p_hours > 720 then
    raise exception 'Notice period must be between 0 and 720 hours (30 days).';
  end if;

  update public.institutions set cancellation_notice_hours = p_hours where id = p_institution_id;
end;
$$;

grant execute on function public.set_cancellation_notice_hours(uuid, integer) to authenticated;

create or replace function public.set_cancellation_policy_text(
  p_institution_id uuid,
  p_text text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_text text;
begin
  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id and s.user_id = auth.uid()
      and s.role = 'principal'
      and inst.status = 'verified' and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(auth.uid(), p_institution_id)
  ) then
    raise exception 'Only an active clinical director can set the cancellation policy.';
  end if;

  v_text := nullif(trim(p_text), '');
  update public.institutions set cancellation_policy_text = v_text where id = p_institution_id;
end;
$$;

grant execute on function public.set_cancellation_policy_text(uuid, text) to authenticated;

-- =====================================================================
-- 2. bookings.cancelled_via -- adds 'clinician' as its own real value.
-- Stage 1 shipped ('parent', 'clinician_google', 'director', 'discharge',
-- 'rescheduled', 'system') with no plain 'clinician' value at all --
-- found re-reading that CHECK constraint closely while scoping this
-- stage. Two genuinely different facts were at risk of being
-- conflated: 'clinician' is a real in-app cancel action (this stage);
-- 'clinician_google' is reserved for a deletion DETECTED in Google and
-- then CONFIRMED by the clinician in-app -- the same "detect, mark, a
-- human confirms" principle Stage 1 already applies to drift, extended
-- to deletion instead of assumed away. That confirmation flow is not
-- built here (it needs the sync/poll mechanism, PRD section 7, its own
-- separate piece) -- 'clinician_google' stays defined and unused for
-- now, exactly like 'rescheduled' already does.
-- =====================================================================

alter table public.bookings drop constraint if exists bookings_cancelled_via_check;
alter table public.bookings add constraint bookings_cancelled_via_check
  check (cancelled_via in ('parent', 'clinician', 'clinician_google', 'director', 'discharge', 'rescheduled', 'system'));

-- =====================================================================
-- 3. get_bookable_clinician_details() widened with the cancellation
-- policy fields -- still returns jsonb, so a bare CREATE OR REPLACE is
-- correct (the widening that needed DROP+CREATE, 0255's own
-- get_institution_clinicians(), was a RETURNS TABLE change; this
-- function's own return TYPE, jsonb, is unchanged).
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
    'cancellation_notice_hours', inst.cancellation_notice_hours,
    'cancellation_policy_text', inst.cancellation_policy_text,
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
-- 4. create_pending_booking() -- the row, written before any Google
-- call, matching bookings' own header comment exactly ("a row is
-- written before any Google API call; the calendar event is its
-- destination, not its origin"). Re-validates everything server-side
-- rather than trusting the calling route's own already-done checks --
-- this schema's own standing "validate at write time, don't trust the
-- UI" rule. The bookings_no_overlap EXCLUDE constraint is the real,
-- final backstop against a race the calling route's own fresh Freebusy
-- re-check might have missed -- this INSERT is deliberately the FIRST
-- thing that touches Google-adjacent state, precisely so that race is
-- caught here, cheaply, before any real Google API call is ever made.
-- =====================================================================

create or replace function public.create_pending_booking(
  p_passport_id uuid,
  p_clinician_id uuid,
  p_session_type text,
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
  v_booking_id uuid;
begin
  if not public.owns_passport(p_passport_id) then
    raise exception 'Only this child''s own parent or guardian can book a session.';
  end if;

  if p_session_type not in ('online', 'in_person') then
    raise exception 'This session type cannot be booked here.';
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

  insert into public.bookings (
    passport_id, clinician_id, institution_id,
    session_type, session_start_at, session_end_at,
    travel_before_start_at, travel_after_end_at,
    google_calendar_id, google_sync_status,
    cancellation_policy_snapshot, consented_at,
    created_by
  ) values (
    p_passport_id, p_clinician_id, v_institution_id,
    p_session_type, p_session_start_at, p_session_end_at,
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

grant execute on function public.create_pending_booking(uuid, uuid, text, timestamptz, timestamptz, timestamptz, timestamptz, text, text) to authenticated;

-- =====================================================================
-- 5. mark_booking_synced() -- the calling route confirms all real
-- Google events for this booking now exist. Scoped to the booking's own
-- creator, matching create_pending_booking()'s own caller.
-- =====================================================================

create or replace function public.mark_booking_synced(
  p_booking_id uuid,
  p_google_event_id text,
  p_travel_before_event_id text,
  p_travel_after_event_id text,
  p_google_etag text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bookings
  set google_event_id = p_google_event_id,
      travel_before_event_id = p_travel_before_event_id,
      travel_after_event_id = p_travel_after_event_id,
      google_etag = p_google_etag,
      google_sync_status = 'synced',
      google_last_synced_at = now()
  where id = p_booking_id
    and created_by = auth.uid()
    and google_sync_status = 'pending';

  if not found then
    raise exception 'Could not confirm this booking.';
  end if;
end;
$$;

grant execute on function public.mark_booking_synced(uuid, text, text, text, text) to authenticated;

-- =====================================================================
-- 6. mark_booking_sync_failed() -- the ONE place google_sync_status
-- flips to 'sync_failed', used for TWO distinct real situations that
-- both reduce to the identical fact ("our own database and this
-- clinician's real calendar may now disagree, a human needs to look"):
-- (a) the all-or-nothing booking-creation sequence couldn't be brought
--     fully into agreement with Google, even after a best-effort
--     rollback -- called by the SAME parent session that was mid-
--     booking, hence the created_by = auth.uid() branch;
-- (b) the discharge sweep (below) cancelled a booking correctly in our
--     own database but couldn't confirm its real Google event(s) were
--     actually deleted -- called by the sweep's own cron route, which
--     runs as service_role, hence the auth.uid() is null branch. This
--     is a DELIBERATE, explicit service-role allowance, not the
--     accidental one CLAUDE.md's own countersign-fields entry warns
--     about -- there, a trigger's role lookup silently degraded under
--     service-role writes nobody intended to trust; here, the
--     service-role path is the intended, only caller for that specific
--     situation, checked explicitly by name.
--
-- get_my_bookings_needing_attention() (0255) is widened below to
-- surface case (b) too -- its own original cancelled_at is null filter
-- would have hidden exactly the case this exists for.
-- =====================================================================

create or replace function public.mark_booking_sync_failed(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    if not exists (select 1 from public.bookings where id = p_booking_id and created_by = auth.uid()) then
      raise exception 'Could not update this booking.';
    end if;
  end if;

  update public.bookings
  set google_sync_status = 'sync_failed'
  where id = p_booking_id;
end;
$$;

revoke all on function public.mark_booking_sync_failed(uuid) from public;
grant execute on function public.mark_booking_sync_failed(uuid) to authenticated, service_role;

-- =====================================================================
-- 7. cancel_booking() -- ONE shared cancellation path for all three
-- real, in-app actors, per Daniel's own instruction. Deliberately does
-- NOT take cancelled_via as a client-supplied parameter -- the same
-- "never trust a client-supplied role/via value, derive it from who is
-- actually calling" discipline derive_countersign_fields() already
-- established (and, per this session's own earlier fix, had to have
-- restored after a rewrite silently dropped it). Returns the real
-- Google identifiers so the calling route knows exactly what to
-- delete -- this function cannot reach Google itself.
--
-- Notice-period is NOT enforced here, deliberately -- section 10.2's
-- own free-text policy plus billing being explicitly out of scope
-- means there is nothing for the database to gate; the notice check is
-- a WARNING the calling UI shows before the parent ever confirms, never
-- a blocking rule. One shared path, one set of mechanics, regardless of
-- timing.
-- =====================================================================

create or replace function public.cancel_booking(
  p_booking_id uuid,
  p_reason text default null
)
returns table (
  google_calendar_id text,
  google_event_id text,
  travel_before_event_id text,
  travel_after_event_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
  v_via text;
begin
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'Booking not found.';
  end if;

  if v_booking.cancelled_at is not null then
    raise exception 'This booking has already been cancelled.';
  end if;

  if public.owns_passport(v_booking.passport_id) then
    v_via := 'parent';
  elsif v_booking.clinician_id = auth.uid() then
    v_via := 'clinician';
  elsif exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = v_booking.institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and inst.status = 'verified'
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(auth.uid(), v_booking.institution_id)
  ) then
    v_via := 'director';
  else
    raise exception 'You do not have permission to cancel this booking.';
  end if;

  update public.bookings
  set cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancelled_via = v_via,
      cancellation_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_booking_id;

  return query
  select v_booking.google_calendar_id, v_booking.google_event_id, v_booking.travel_before_event_id, v_booking.travel_after_event_id;
end;
$$;

grant execute on function public.cancel_booking(uuid, text) to authenticated;

-- =====================================================================
-- 8. cancel_booking_for_discharge() -- service-role only, single
-- booking, used by the sweep below. Kept separate from cancel_booking()
-- rather than folded in as a fourth branch: discharge has no real
-- "caller" to derive authorization from at all (the sweep runs on a
-- schedule, nobody is present), so it doesn't belong in a function
-- whose whole design is "derive who is acting from who is calling".
-- =====================================================================

create or replace function public.cancel_booking_for_discharge(p_booking_id uuid)
returns table (
  google_calendar_id text,
  google_event_id text,
  travel_before_event_id text,
  travel_after_event_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found or v_booking.cancelled_at is not null then
    return;
  end if;

  update public.bookings
  set cancelled_at = now(),
      cancelled_via = 'discharge'
  where id = p_booking_id;

  return query
  select v_booking.google_calendar_id, v_booking.google_event_id, v_booking.travel_before_event_id, v_booking.travel_after_event_id;
end;
$$;

revoke all on function public.cancel_booking_for_discharge(uuid) from public, authenticated, anon;
grant execute on function public.cancel_booking_for_discharge(uuid) to service_role;

-- =====================================================================
-- 9. sweep_bookings_for_ended_episodes() -- discharge, as a SWEEP, not
-- a client-side cleanup step. Daniel's own instruction, and the reason
-- is the record: end_clinic_episode() is pure SQL and cannot reach
-- Google, so a client-side step only ever fires for whichever ONE path
-- happens to call it -- a sweep, same shape as fail_stale_pending_
-- bookings() (0255), survives every path a discharge can happen
-- through, present or future. Finds every future, still-active booking
-- whose own episode has already ended, cancels each via
-- cancel_booking_for_discharge() (marking the DB authoritative
-- immediately -- the episode ending IS the fact, independent of
-- whether a Google event happens to still exist), and returns what the
-- calling cron route needs to go delete from Google. A Google-delete
-- failure there gets surfaced back through mark_booking_sync_failed()
-- (above) -- the same clinician queue, not a second mechanism.
-- =====================================================================

create or replace function public.sweep_bookings_for_ended_episodes()
returns table (
  booking_id uuid,
  google_calendar_id text,
  google_event_id text,
  travel_before_event_id text,
  travel_after_event_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  for v_row in
    select b.id
    from public.bookings b
    join public.episodes_of_care e
      on e.passport_id = b.passport_id and e.institution_id = b.institution_id
    where b.cancelled_at is null
      and b.session_start_at > now()
      and e.ended_at is not null
  loop
    return query select * from public.cancel_booking_for_discharge(v_row.id);
  end loop;
end;
$$;

revoke all on function public.sweep_bookings_for_ended_episodes() from public, authenticated, anon;
grant execute on function public.sweep_bookings_for_ended_episodes() to service_role;

-- =====================================================================
-- 10 & 11. get_my_upcoming_bookings() / get_my_booking_history() --
-- Home is UPCOMING (something-is-happening, the inbox's own shape),
-- Passport is HISTORY (record material) -- Daniel's own framing,
-- answering PRD section 11's own open question. Mutually exclusive
-- split: upcoming is active and still ahead of now; history is
-- anything cancelled, or anything whose own session time has passed,
-- regardless of cancellation. No recurring-appointment concept yet
-- (out of scope, PRD section 8) -- nothing here assumes one.
-- =====================================================================

create or replace function public.get_my_upcoming_bookings(p_passport_id uuid)
returns table (
  booking_id uuid,
  clinician_id uuid,
  clinician_name text,
  session_type text,
  session_start_at timestamptz,
  session_end_at timestamptz,
  google_sync_status text
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
    b.session_type, b.session_start_at, b.session_end_at, b.google_sync_status
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

create or replace function public.get_my_booking_history(p_passport_id uuid)
returns table (
  booking_id uuid,
  clinician_id uuid,
  clinician_name text,
  session_type text,
  session_start_at timestamptz,
  session_end_at timestamptz,
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
    b.session_type, b.session_start_at, b.session_end_at,
    b.cancelled_at, b.cancelled_via, b.cancellation_reason
  from public.bookings b
  join auth.users u on u.id = b.clinician_id
  left join public.clinicians c on c.user_id = b.clinician_id
  where b.passport_id = p_passport_id
    and (b.cancelled_at is not null or b.session_end_at <= now())
  order by b.session_start_at desc;
end;
$$;

grant execute on function public.get_my_booking_history(uuid) to authenticated;

-- =====================================================================
-- 12. get_my_bookings_needing_attention() (0255) widened -- its own
-- original `cancelled_at is null` filter would have hidden the second
-- real use of mark_booking_sync_failed() above (a cancelled booking
-- whose Google cleanup didn't confirm). Same RETURNS TABLE shape, bare
-- CREATE OR REPLACE is correct.
-- =====================================================================

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
    and b.google_sync_status in ('drifted', 'sync_failed')
  order by b.session_start_at asc;
$$;

grant execute on function public.get_my_bookings_needing_attention() to authenticated;
