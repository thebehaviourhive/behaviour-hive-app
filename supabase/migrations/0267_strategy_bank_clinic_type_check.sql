-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- STRATEGY BANK IS CLINIC-ONLY, AND NOTHING SAID SO AT THE DATABASE
-- LAYER. Found 21 Sept 2026, same pass as the director/lead clinical-
-- work gate (0266): _is_verified_clinician_at_institution() and
-- _is_director_of_institution() (0238) both check role only, never
-- institution type -- so a school principal (role = 'principal' at
-- their own school) already satisfied _is_director_of_institution()
-- for their own school's institution_id, and any school-engaged
-- clinician (a real, existing pattern -- session_notes/assessments
-- have supported this for a long time, it is not hypothetical) already
-- satisfied _is_verified_clinician_at_institution() the same way.
--
-- The client-side gate on /clinician/strategy-bank was the only thing
-- stopping a school principal from reaching the page at all (fixed
-- separately, same commit) -- but the RLS itself never independently
-- enforced "this belongs to a clinic", which is exactly the "belt and
-- braces, two independent layers" shape Daniel named for the director/
-- lead gate, applied here to the same underlying risk: a client-side
-- fix alone is never the only thing standing between a school and a
-- table meant for clinics.
--
-- Both functions are CREATE OR REPLACE on their existing signature --
-- no DROP needed, no caller changes. _is_director_of_institution() is
-- also called from cross_organisation_grants (0245), always on a
-- GRANTING institution, which that migration's own direction trigger
-- (_validate_cross_organisation_grant_direction()) already constrains
-- to type = 'clinic' before a grant row can exist -- so this addition
-- is a genuine no-op there, and a real fix here.

create or replace function public._is_verified_clinician_at_institution(p_institution_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and s.role = 'clinician'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    );
$$;

create or replace function public._is_director_of_institution(p_institution_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  );
$$;
