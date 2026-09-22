-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Two small, additive pieces the booking-flow redesign (design brief,
-- Sept 2026) needs and the schema doesn't have yet. The booking LOGIC
-- itself does not change (brief section 9) -- both of these are data
-- the new screens need to render, not new booking mechanics.
--
-- 1. institutions.address -- the brief's step 4 confirm screen wants
--    "the clinic's address for in-person" (section 5, step 4). No
--    location field of any kind exists on institutions today (checked
--    directly, every column back to 0009). Nullable, director-set,
--    same posture and RPC shape as clinic_hours/booking_buffer/
--    cancellation_policy_text -- set_clinic_address(), matching
--    set_clinic_hours()'s own auth check verbatim.
--
-- 2. get_my_upcoming_bookings() -- today's WHERE clause is
--    `cancelled_at is null and session_end_at > now()`, so a booking
--    the clinic (or the parent) cancels vanishes from the Upcoming
--    card the instant it's cancelled. The brief's own section 7 is
--    explicit: "An upcoming booking the clinic has cancelled shows as
--    cancelled, clearly, with an explanation -- not quietly removed."
--    and asks for THREE Upcoming-card states (booked / cancelled by
--    parent / cancelled by clinic), not two. Fixed by dropping the
--    cancelled_at is null half of the filter -- ANY booking whose
--    ORIGINAL scheduled end time hasn't passed yet counts as
--    "upcoming" for display, cancelled or not; the client renders the
--    cancelled state from the now-included cancelled_at/cancelled_via/
--    cancellation_reason columns. Once the original time passes, it
--    ages out to get_my_booking_history() exactly as before (that
--    function's own WHERE clause -- cancelled_at is not null or
--    session_end_at <= now() -- already covers a cancelled-and-now-
--    past booking, so nothing there needs to change). DROP+CREATE,
--    matching this schema's own "a RETURNS TABLE shape change needs a
--    real drop" precedent.
-- =====================================================================

alter table public.institutions add column if not exists address text;

create or replace function public.set_clinic_address(
  p_institution_id uuid,
  p_address text
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
    raise exception 'Only an active clinical director can set the clinic address.';
  end if;

  update public.institutions
  set address = nullif(trim(p_address), '')
  where id = p_institution_id;
end;
$$;

grant execute on function public.set_clinic_address(uuid, text) to authenticated;

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
    b.session_type_name, b.session_type_mode, b.session_start_at, b.session_end_at, b.google_sync_status, b.google_meet_link,
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
