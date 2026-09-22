-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Bug 4 -- online sessions have no joining details. The request side
-- already asked Google for a Meet link on every online booking
-- (conferenceDataVersion=1, conferenceData.createRequest, in
-- createCalendarEvent() -- src/lib/google/calendarEvents.ts); this
-- keeps what Google was already generating instead of discarding it.
--
-- mark_booking_synced() has exactly one live signature (0258) and
-- exactly one caller (/api/scheduling/book/route.ts, updated in the
-- same commit as this migration) -- DROP FUNCTION IF EXISTS on the old
-- 5-arg signature before CREATE, per this schema's own standing rule
-- (send_message()'s own history): a bare CREATE OR REPLACE with a new
-- trailing parameter creates a second overload, it never collapses
-- onto the old one, even the first time a signature grows.
--
-- get_my_upcoming_bookings()/get_my_booking_history() both widen their
-- own RETURNS TABLE shape -- also DROP+CREATE, matching this schema's
-- own "a RETURNS TABLE shape change needs a real drop" precedent
-- (get_institution_clinicians(), get_institution_staff_roster()).

alter table public.bookings
  add column if not exists google_meet_link text;

drop function if exists public.mark_booking_synced(uuid, text, text, text, text);

create function public.mark_booking_synced(
  p_booking_id uuid,
  p_google_event_id text,
  p_travel_before_event_id text,
  p_travel_after_event_id text,
  p_google_etag text,
  p_google_meet_link text default null
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
      google_meet_link = p_google_meet_link,
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

grant execute on function public.mark_booking_synced(uuid, text, text, text, text, text) to authenticated;

drop function if exists public.get_my_upcoming_bookings(uuid);

create function public.get_my_upcoming_bookings(p_passport_id uuid)
returns table (
  booking_id uuid,
  clinician_id uuid,
  clinician_name text,
  session_type text,
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
    b.session_type, b.session_start_at, b.session_end_at, b.google_sync_status, b.google_meet_link
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
  session_type text,
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
    b.session_type, b.session_start_at, b.session_end_at,
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
