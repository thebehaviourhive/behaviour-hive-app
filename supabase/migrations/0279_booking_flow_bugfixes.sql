-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Five correctness bugs in the parent booking flow (PRD 9), found from
-- screenshots against the design-brief-booking-flow.pdf, fixed ahead
-- of the redesign per Daniel's own instruction -- the redesign must
-- not be built on top of these.

-- =====================================================================
-- BUG 1 -- THE CLINICIAN'S NAME DOES NOT RESOLVE.
--
-- clinicians.full_name is only ever populated by the INDEPENDENT
-- verification path (submit_clinician_verification()'s own
-- p_full_name parameter). approve_staff_join()'s own organisation-
-- route branch -- the one that creates a clinicians row for every
-- clinic-engaged practitioner, the entire population this booking
-- system is built for -- never sets it:
--   insert into public.clinicians (user_id, specialty,
--     verification_status, verification_route)
--   values (v_target.user_id, 'unspecified', 'verified', 'organisation')
-- So for every real clinic practitioner, clinicians.full_name is null,
-- and get_passport_clinicians()/get_bookable_clinician_details() both
-- selected it bare, with no fallback -- Screen 1's card rendered a
-- blank name line with only the specialty visible beneath it (reading
-- as "Behavioural Psychologist", a job title standing in for a
-- person), and Screen 4's "In-person with " rendered nothing after it.
--
-- The fix already exists elsewhere in this exact file (0221) --
-- get_passport_team() does
--   coalesce(c.full_name, u.raw_user_meta_data ->> 'full_name',
--             u.raw_app_meta_data ->> 'full_name')
-- immediately above where get_passport_clinicians() was defined
-- without it. Applied here to the two functions the booking flow
-- itself depends on. get_my_upcoming_bookings()/get_my_booking_history()
-- (0258) already do this correctly -- confirmed by reading them
-- directly, not assumed -- so the Upcoming card and booking history
-- were never affected; only the booking flow's own two RPCs were.
-- =====================================================================

create or replace function public.get_passport_clinicians(p_passport_id uuid)
returns table (
  clinician_access_id uuid,
  clinician_id uuid,
  full_name text,
  specialty text,
  last_review_date date,
  linked_at timestamptz,
  engaged_by text,
  engaged_by_institution_id uuid,
  engaged_by_institution_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    ca.id, ca.clinician_id,
    coalesce(c.full_name, u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
    c.specialty, ca.last_review_date, ca.linked_at,
    ca.engaged_by, ca.engaged_by_institution_id, inst.name
  from public.clinician_access ca
  join public.clinicians c on c.user_id = ca.clinician_id
  join auth.users u on u.id = ca.clinician_id
  left join public.institutions inst on inst.id = ca.engaged_by_institution_id
  where ca.passport_id = p_passport_id
    and ca.is_active = true
    and public.is_verified_clinician(ca.clinician_id)
    and (
      public.owns_passport(p_passport_id)
      or exists (
        select 1 from public.passport_institution_links pil
        join public.institution_staff s on s.institution_id = pil.institution_id
        where pil.passport_id = p_passport_id
          and s.user_id = auth.uid()
          and s.role = 'principal'
          and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
      )
      or exists (
        select 1 from public.passport_institution_links pil
        join public.institution_staff s on s.institution_id = pil.institution_id
        join public.episodes_of_care e
          on e.institution_id = s.institution_id
          and e.passport_id = p_passport_id
          and e.ended_at is null
        where pil.passport_id = p_passport_id
          and s.user_id = auth.uid()
          and s.role = 'clinical_lead'
          and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
          and public._lead_episode_in_scope(s.id, e.id)
      )
    );
$$;

grant execute on function public.get_passport_clinicians(uuid) to authenticated;

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
    'working_days', to_jsonb(inst.working_days),
    'booking_buffer_minutes', inst.booking_buffer_minutes,
    'booking_window_days', inst.booking_window_days,
    'cancellation_notice_hours', inst.cancellation_notice_hours,
    'cancellation_policy_text', inst.cancellation_policy_text,
    'full_name', coalesce(c.full_name, u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
    'specialty', c.specialty
  )
  into v_result
  from public.clinician_access ca
  join public.clinicians c on c.user_id = ca.clinician_id
  join auth.users u on u.id = ca.clinician_id
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
-- BUG 2 -- WEEKENDS ARE BOOKABLE.
--
-- computeAvailableSlots() iterates every calendar day in the booking
-- window with no day-of-week filter at all -- clinic hours are a start
-- and end TIME only, so Saturday and Sunday get the identical treatment
-- as a Tuesday. A real gap, not a display issue, per Daniel's own
-- framing -- fixed at the settings layer here, and in
-- src/lib/scheduling/availability.ts (client-side companion commit).
--
-- Stored as JS's own Date.getDay() convention (0=Sunday..6=Saturday) --
-- the array is produced and consumed entirely in TypeScript
-- (computeAvailableSlots, the /principal/clinic settings screen), so
-- matching that convention avoids a conversion step existing nowhere
-- else in this codebase. Defaulting existing clinics to Monday-Friday,
-- per Daniel's own instruction -- the one live clinic (TBHCLINIC) picks
-- this default up with no separate backfill needed, matching how
-- clinic_hours_start_time/end_time were introduced in 0255.
-- =====================================================================

alter table public.institutions
  add column if not exists working_days smallint[] not null default '{1,2,3,4,5}';

alter table public.institutions
  drop constraint if exists institutions_working_days_valid;
alter table public.institutions
  add constraint institutions_working_days_valid
  check (
    array_length(working_days, 1) > 0
    and working_days <@ array[0,1,2,3,4,5,6]::smallint[]
  );

create or replace function public.set_clinic_working_days(
  p_institution_id uuid,
  p_working_days smallint[]
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
    raise exception 'Only an active clinical director can set working days.';
  end if;

  if array_length(p_working_days, 1) is null or array_length(p_working_days, 1) = 0 then
    raise exception 'At least one working day is required.';
  end if;

  if not (p_working_days <@ array[0,1,2,3,4,5,6]::smallint[]) then
    raise exception 'Working days must be between 0 (Sunday) and 6 (Saturday).';
  end if;

  update public.institutions set working_days = p_working_days where id = p_institution_id;
end;
$$;

grant execute on function public.set_clinic_working_days(uuid, smallint[]) to authenticated;
