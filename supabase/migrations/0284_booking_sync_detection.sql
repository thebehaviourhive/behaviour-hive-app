-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 9 section 7 -- the sync/poll mechanism, held since PRD 9 Stage 2
-- specifically until the booking-flow redesign landed (CLAUDE.md's own
-- entry: "building a sync mechanism on top of a flow that's about to
-- change is the wrong order"). The redesign is done; this is that
-- mechanism's schema half.
--
-- DECISIONS THIS MIGRATION IMPLEMENTS, per Daniel's own confirmation:
--
--   1. SEPARATE STATUSES. 'drifted' (moved) and a new
--      'deleted_in_google' (deleted) -- never one value covering both,
--      because the clinician's own two resolution actions genuinely
--      differ per status (drifted: reschedule or revert; deleted:
--      confirm or restore), and one status meaning both would mean
--      re-deriving which actually happened from live Google state
--      every time the queue is rendered. Google's own soft-delete
--      (a GET on a just-deleted event returns status: "cancelled" for
--      a period before an eventual 404/410) is treated as deletion
--      identically to a hard 404/410 -- both mean "this event no
--      longer represents a real booked session," which is what
--      actually matters here, not which HTTP shape Google happened to
--      return today.
--
--   2. THE QUEUE FILTERS ON RESOLVED, NOT ON TIME. Daniel's own
--      correction to my own first proposal (session_end_at > now()):
--      "An unresolved conflict does not become resolved because the
--      clock passed. If a clinician moved Tuesday's session to
--      Wednesday and nobody fixed it, the parent may have turned up
--      on Tuesday -- that is worse, not settled." A booking leaves
--      get_my_bookings_needing_attention() only when cancelled_at is
--      set (cancel_booking() now always clears google_sync_status back
--      to 'synced' when it cancels a flagged booking, so the row
--      itself never carries a stale 'drifted'/'deleted_in_google'
--      value after resolution) or when one of the two new resolve_*
--      functions below explicitly resolves it. Never by the clock.
--
--   3. Four pieces total, this migration is the schema/RPC layer for
--      three of them (getCalendarEvent() and the cron route itself are
--      TypeScript, built alongside this): the two cron-only marking
--      functions (mark_booking_drifted/mark_booking_deleted_in_google,
--      matching fail_stale_pending_bookings()'s own service-role-only
--      posture -- revoked from every ordinary role, only the cron's
--      own admin client can call them), and three clinician-facing
--      resolution functions matching the four named actions:
--      resolve_booking_reschedule() (drifted only -- adopt the time
--      Google now shows), resolve_booking_restore_original() (drifted
--      OR deleted_in_google -- both "put it back to what it should be"
--      are the identical DB operation: a fresh/repositioned event at
--      the ORIGINALLY BOOKED time, new event ids, back to synced --
--      merged into one function rather than two structurally identical
--      ones), and resolve_booking_confirm_deletion() (deleted_in_google
--      only -- accept it, cancel properly via cancelled_via =
--      'clinician_google', the value PRD 9 Stage 2 already reserved
--      for exactly this).
--
--   4. SCOPE, STATED PLAINLY: the cron only ever re-checks a booking's
--      own MAIN session event (google_event_id), never its travel-
--      block events. Daniel's own verification ask is specifically
--      about the main session ("move an event directly in Google,
--      delete another") and travel-block drift is a real, separate
--      question this migration does not attempt -- the resolution
--      functions below DO reposition/recreate travel blocks when
--      resolving a main-event drift/deletion (for internal
--      consistency), but nothing DETECTS a travel block moving or
--      being deleted on its own. Not a silent gap -- named here so it
--      isn't mistaken for covered.
--
--   5. THE HOBBY-PLAN CONSEQUENCE, recorded per Daniel's own explicit
--      instruction, not left implicit: this cron runs once daily
--      (vercel.json, Hobby plan's own hard cap -- matching fail-stale-
--      bookings/sweep-discharged-bookings). Daily detection catches
--      DRIFT, not SAME-DAY changes. A clinician deleting a 2pm session
--      at 10am the same day is not caught until the next morning's
--      run -- after the parent may already have turned up. Upgrading
--      to Pro is what unlocks tighter, same-day detection; staying on
--      Hobby means this is a real, known, accepted limit, not a bug to
--      "eventually fix" by itself.
-- =====================================================================

alter table public.bookings drop constraint if exists bookings_google_sync_status_check;
alter table public.bookings
  add constraint bookings_google_sync_status_check
  check (google_sync_status in ('pending', 'synced', 'drifted', 'sync_failed', 'deleted_in_google'));

-- -----------------------------------------------------------------------
-- cancel_booking() -- Decision 2's own second half. Cancelling a
-- flagged booking is itself a real resolution (the clinician is saying
-- "this session isn't happening, full stop") -- the row must not keep
-- carrying a stale drifted/deleted_in_google/sync_failed value once
-- it's cancelled. Same signature, same RETURNS TABLE shape -- only the
-- UPDATE gains one more column.
-- -----------------------------------------------------------------------

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
      cancellation_reason = nullif(trim(coalesce(p_reason, '')), ''),
      google_sync_status = 'synced'
  where id = p_booking_id;

  return query
  select v_booking.google_calendar_id, v_booking.google_event_id, v_booking.travel_before_event_id, v_booking.travel_after_event_id;
end;
$$;

-- -----------------------------------------------------------------------
-- get_my_bookings_needing_attention() -- Decision 2's own first half.
-- Resolved (cancelled_at is not null), not time, is what removes a row.
-- Same signature; RETURNS TABLE shape unchanged, bare CREATE OR REPLACE
-- (language sql, a pure query-body change).
-- -----------------------------------------------------------------------

create or replace function public.get_my_bookings_needing_attention()
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
    and b.cancelled_at is null
    and b.google_sync_status in ('drifted', 'sync_failed', 'deleted_in_google')
  order by b.session_start_at asc;
$$;

-- -----------------------------------------------------------------------
-- The two cron-only marking functions. Service-role only, matching
-- fail_stale_pending_bookings()'s own posture exactly -- the actual
-- Google comparison happens in TypeScript (a Postgres function can't
-- call Google's API), these just persist the verdict.
-- -----------------------------------------------------------------------

create or replace function public.mark_booking_drifted(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bookings
  set google_sync_status = 'drifted'
  where id = p_booking_id
    and cancelled_at is null
    and google_sync_status = 'synced';
end;
$$;

revoke all on function public.mark_booking_drifted(uuid) from public, authenticated, anon;

create or replace function public.mark_booking_deleted_in_google(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bookings
  set google_sync_status = 'deleted_in_google'
  where id = p_booking_id
    and cancelled_at is null
    and google_sync_status = 'synced';
end;
$$;

revoke all on function public.mark_booking_deleted_in_google(uuid) from public, authenticated, anon;

-- -----------------------------------------------------------------------
-- resolve_booking_reschedule() -- drifted only. The clinician accepts
-- the time Google now shows as the real one. The MAIN event's own id
-- never changes (it's the same event, already at the right time on
-- Google -- that's what "drifted" means); only the app's own stored
-- times, and the travel-block events if the booking has any (the route
-- deletes and recreates them positioned around the new time before
-- calling this, since the clinician only ever dragged the main block).
-- -----------------------------------------------------------------------

create or replace function public.resolve_booking_reschedule(
  p_booking_id uuid,
  p_new_session_start_at timestamptz,
  p_new_session_end_at timestamptz,
  p_new_travel_before_start_at timestamptz default null,
  p_new_travel_after_end_at timestamptz default null,
  p_new_travel_before_event_id text default null,
  p_new_travel_after_event_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.bookings
    where id = p_booking_id and clinician_id = auth.uid() and cancelled_at is null and google_sync_status = 'drifted'
  ) then
    raise exception 'This booking is not currently flagged as drifted.';
  end if;

  update public.bookings
  set session_start_at = p_new_session_start_at,
      session_end_at = p_new_session_end_at,
      travel_before_start_at = p_new_travel_before_start_at,
      travel_after_end_at = p_new_travel_after_end_at,
      travel_before_event_id = p_new_travel_before_event_id,
      travel_after_event_id = p_new_travel_after_event_id,
      google_sync_status = 'synced',
      google_last_synced_at = now()
  where id = p_booking_id;
end;
$$;

grant execute on function public.resolve_booking_reschedule(uuid, timestamptz, timestamptz, timestamptz, timestamptz, text, text) to authenticated;

-- -----------------------------------------------------------------------
-- resolve_booking_restore_original() -- drifted OR deleted_in_google.
-- Both are, at the database layer, the identical operation: a fresh
-- event (recreated, or repositioned via delete-then-recreate) at the
-- ORIGINALLY BOOKED time, new event ids, back to synced. The stored
-- session_start_at/session_end_at/travel_*_at are untouched -- that's
-- the point of "original".
-- -----------------------------------------------------------------------

create or replace function public.resolve_booking_restore_original(
  p_booking_id uuid,
  p_google_event_id text,
  p_travel_before_event_id text default null,
  p_travel_after_event_id text default null,
  p_google_meet_link text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.bookings
    where id = p_booking_id and clinician_id = auth.uid() and cancelled_at is null
      and google_sync_status in ('drifted', 'deleted_in_google')
  ) then
    raise exception 'This booking is not currently flagged as drifted or deleted.';
  end if;

  update public.bookings
  set google_event_id = p_google_event_id,
      travel_before_event_id = p_travel_before_event_id,
      travel_after_event_id = p_travel_after_event_id,
      google_meet_link = coalesce(p_google_meet_link, google_meet_link),
      google_sync_status = 'synced',
      google_last_synced_at = now()
  where id = p_booking_id;
end;
$$;

grant execute on function public.resolve_booking_restore_original(uuid, text, text, text, text) to authenticated;

-- -----------------------------------------------------------------------
-- resolve_booking_confirm_deletion() -- deleted_in_google only. The
-- clinician accepts the deletion as real and cancels properly, via
-- cancelled_via = 'clinician_google' -- the value PRD 9 Stage 2 already
-- reserved for exactly this ("a deletion DETECTED in Google and then
-- CONFIRMED by the clinician in-app"). Same return shape as
-- cancel_booking() minus the already-gone main event id, so the
-- calling route can best-effort clean up any travel-block events the
-- same way cancel_booking()'s own caller already does.
-- -----------------------------------------------------------------------

create or replace function public.resolve_booking_confirm_deletion(
  p_booking_id uuid,
  p_reason text default null
)
returns table (
  google_calendar_id text,
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
  select * into v_booking from public.bookings
  where id = p_booking_id and clinician_id = auth.uid() and cancelled_at is null and google_sync_status = 'deleted_in_google';
  if not found then
    raise exception 'This booking is not currently flagged as deleted in Google.';
  end if;

  update public.bookings
  set cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancelled_via = 'clinician_google',
      cancellation_reason = nullif(trim(coalesce(p_reason, '')), ''),
      google_sync_status = 'synced'
  where id = p_booking_id;

  return query select v_booking.google_calendar_id, v_booking.travel_before_event_id, v_booking.travel_after_event_id;
end;
$$;

grant execute on function public.resolve_booking_confirm_deletion(uuid, text) to authenticated;
