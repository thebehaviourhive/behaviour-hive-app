-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Found while building the client code 0281 was written for, not by
-- review: get_bookable_session_types() returned name/description/
-- location_mode/length_minutes, but NOT travel_before_minutes/
-- travel_after_minutes -- and both the availability route and the
-- booking route need those two numbers to compute the correct clear
-- window and, at booking time, the correct travel-block bounds for the
-- real Google Calendar events. Widening the one existing RPC rather
-- than adding a second lookup function -- the same authorization check
-- (owns_passport + a live institution-engaged clinician_access row) is
-- what both callers need, whether they're listing every bookable type
-- or resolving one specific id the parent already picked.
--
-- DROP+CREATE, matching this schema's own "a RETURNS TABLE shape
-- change needs a real drop" precedent (get_institution_clinicians()) --
-- a bare CREATE OR REPLACE cannot widen a RETURNS TABLE list.

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
  travel_after_minutes integer
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
    st.travel_before_minutes, st.travel_after_minutes
  from public.session_types st
  where st.institution_id = v_institution_id
    and st.is_active = true
    and st.is_parent_bookable = true
  order by st.sort_order, st.name;
end;
$$;

grant execute on function public.get_bookable_session_types(uuid, uuid) to authenticated;
