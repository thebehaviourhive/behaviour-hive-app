-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Outstanding-task snoozing, 25 Sept 2026 -- get_my_bookings_needing_
-- attention() (live def: 0285) had no institution_id in its own return
-- shape, and BookingSyncQueueSection.tsx (its one real caller) has
-- never been passed one either -- a clinician's own dashboard has
-- never needed to know which clinic a given booking belongs to,
-- because the query is already scoped to b.clinician_id = auth.uid().
-- Snoozing needs it regardless: snooze_outstanding_task() takes a
-- p_institution_id, and a snooze is institution-wide shared state, so
-- it has to be the booking's own real institution, not guessed at or
-- assumed to be "whichever clinic this clinician mostly works at."
--
-- bookings.institution_id already exists (0255) -- this is purely
-- adding it to the function's own return shape, the same "RETURNS
-- TABLE shape change needs a real drop" discipline 0285 itself already
-- used for the identical reason.

drop function if exists public.get_my_bookings_needing_attention();

create function public.get_my_bookings_needing_attention()
returns table (
  booking_id uuid,
  passport_id uuid,
  child_name text,
  session_type_name text,
  session_type_mode text,
  session_start_at timestamptz,
  session_end_at timestamptz,
  google_sync_status text,
  institution_id uuid
)
language sql
security definer
set search_path = public
stable
as $$
  select b.id, b.passport_id, p.child_name, b.session_type_name, b.session_type_mode, b.session_start_at, b.session_end_at, b.google_sync_status, b.institution_id
  from public.bookings b
  join public.passports p on p.id = b.passport_id
  where b.clinician_id = auth.uid()
    and b.cancelled_at is null
    and b.google_sync_status in ('drifted', 'sync_failed', 'deleted_in_google')
  order by b.session_start_at asc;
$$;

grant execute on function public.get_my_bookings_needing_attention() to authenticated;
