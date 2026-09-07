-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- REAL BUG, FOUND DURING VERIFICATION: 0176's own
-- get_institution_incidents_signed_off_with_outstanding_attestations()
-- is 66 characters -- three over Postgres's 63-byte identifier limit.
-- CREATE FUNCTION did not error; Postgres silently truncated the name
-- to get_institution_incidents_signed_off_with_outstanding_attestati
-- (63 chars) at creation time, so the function that actually exists in
-- the database has never matched the name the client calls. Confirmed
-- directly: PGRST202, "Could not find the function
-- public.get_institution_incidents_signed_off_with_outstanding_
-- attestations(p_institution_id) in the schema cache", hint pointing
-- at the truncated name verbatim. Every other new/widened function
-- name from migrations 0176-0178 checked and confirmed well under the
-- limit (longest is 52 chars) -- this was the only one.
--
-- Fixed with a genuinely shorter name,
-- get_institution_incidents_outstanding_attestations (50 chars) --
-- drops "signed_off_with" (the fact this bucket only ever lists signed-
-- off incidents is already implicit in "outstanding_attestations"
-- meaning something survived past sign-off, not a separate word needed
-- to say so). DROP + CREATE for the old (truncated) name, since it's a
-- different identifier entirely, not a parameter-list change.

drop function if exists public.get_institution_incidents_signed_off_with_outstanding_attestati(uuid);

create or replace function public.get_institution_incidents_outstanding_attestations(p_institution_id uuid)
returns table (
  incident_id uuid,
  occurred_at timestamptz,
  location text,
  teacher_signed_at timestamptz,
  teacher_signed_by_name text,
  outstanding_count bigint,
  outstanding_names text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    i.id as incident_id,
    i.occurred_at,
    loc.value as location,
    i.teacher_signed_at,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as teacher_signed_by_name,
    (
      select count(*)
      from public.incident_staff st
      where st.incident_id = i.id
        and st.user_id is not null
        and st.user_id is distinct from i.owning_teacher_id
        and public.get_attestation_status(st.id) = 'not_attested'
    ) as outstanding_count,
    (
      select string_agg(coalesce(su.raw_user_meta_data ->> 'full_name', su.raw_app_meta_data ->> 'full_name'), ', ' order by st.id)
      from public.incident_staff st
      join auth.users su on su.id = st.user_id
      where st.incident_id = i.id
        and st.user_id is not null
        and st.user_id is distinct from i.owning_teacher_id
        and public.get_attestation_status(st.id) = 'not_attested'
    ) as outstanding_names
  from public.incidents i
  join public.incident_locations loc on loc.id = i.location_id
  left join auth.users u on u.id = i.teacher_signed_by
  where i.institution_id = p_institution_id
    and i.signed_off_with_outstanding_attestations = true
    and public.can_countersign_incident(auth.uid(), p_institution_id)
  order by i.teacher_signed_at desc;
$$;

grant execute on function public.get_institution_incidents_outstanding_attestations(uuid) to authenticated;
