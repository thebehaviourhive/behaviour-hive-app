-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Found while building the clinician dashboard section 0284 was
-- written for, not by review: get_my_bookings_needing_attention()
-- returns passport_id but not the child's own name, and this schema's
-- own standing dashboard principle (ClinicDirectorDashboard.tsx's own
-- header: "ORGANISED BY CLIENT... every bucket's own Entity column is
-- the CHILD") means a work-queue row needs a real name to show, not a
-- raw id. SECURITY DEFINER already means this function runs under its
-- own privileges, not the caller's -- joining passports here doesn't
-- need or bypass anything RLS wouldn't already have permitted, since
-- the function's own WHERE clause (b.clinician_id = auth.uid()) is
-- what actually scopes visibility, unchanged.
--
-- DROP+CREATE -- a RETURNS TABLE shape change needs a real drop
-- regardless of language (sql here, not plpgsql); this schema's own
-- standing precedent (get_institution_clinicians()).

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
  google_sync_status text
)
language sql
security definer
set search_path = public
stable
as $$
  select b.id, b.passport_id, p.child_name, b.session_type_name, b.session_type_mode, b.session_start_at, b.session_end_at, b.google_sync_status
  from public.bookings b
  join public.passports p on p.id = b.passport_id
  where b.clinician_id = auth.uid()
    and b.cancelled_at is null
    and b.google_sync_status in ('drifted', 'sync_failed', 'deleted_in_google')
  order by b.session_start_at asc;
$$;

grant execute on function public.get_my_bookings_needing_attention() to authenticated;
