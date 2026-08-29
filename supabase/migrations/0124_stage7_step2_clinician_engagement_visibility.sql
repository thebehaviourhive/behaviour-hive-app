-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 1, Stage 7, Step 2 -- the client work needs two things from the
-- SQL layer first: the clinician_access row id itself (so a client can
-- actually call revoke_clinician_access(), which 0123 made the only
-- write path -- neither existing RPC returned it before), and
-- engaged_by/the engaging institution's name, so every screen that
-- lists clinicians can show which authority connected them.
--
-- get_passport_clinicians(p_passport_id) -- was parent-only
-- (owns_passport() the sole gate), extended to also authorize a
-- principal at an institution the child is linked to, mirroring 0123's
-- own SELECT policy exactly (both authorities see everything, revoke
-- authority is separately scoped inside the RPC that does the write).
-- This is the ONE function passport/dashboard/page.tsx (parent) and the
-- new principal Clinical Team section both call -- one source of truth
-- for "who's connected", not two independent queries that could drift.
--
-- get_clinician_passports() -- the clinician's own caseload list, same
-- addition (clinician_access_id + engaged_by + institution name), no
-- authorization change (still clinician_id = auth.uid() only).
--
-- CREATE OR REPLACE cannot change a RETURNS TABLE column list -- DROP +
-- CREATE for both, matching 0113/0122's own precedent for the identical
-- constraint.

drop function if exists public.get_passport_clinicians(uuid);

create function public.get_passport_clinicians(p_passport_id uuid)
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
    ca.id, ca.clinician_id, c.full_name, c.specialty, ca.last_review_date, ca.linked_at,
    ca.engaged_by, ca.engaged_by_institution_id, inst.name
  from public.clinician_access ca
  join public.clinicians c on c.user_id = ca.clinician_id
  left join public.institutions inst on inst.id = ca.engaged_by_institution_id
  where ca.passport_id = p_passport_id
    and ca.is_active = true
    and c.verification_status = 'verified'
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
    );
$$;

grant execute on function public.get_passport_clinicians(uuid) to authenticated;

drop function if exists public.get_clinician_passports();

create function public.get_clinician_passports()
returns table (
  clinician_access_id uuid,
  passport_id uuid,
  child_name text,
  date_of_birth date,
  diagnoses text[],
  diagnosis_other text,
  last_review_date date,
  linked_at timestamptz,
  engaged_by text,
  engaged_by_institution_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    ca.id, p.id, p.child_name, p.date_of_birth, p.diagnoses, p.diagnosis_other, ca.last_review_date, ca.linked_at,
    ca.engaged_by, inst.name
  from public.clinician_access ca
  join public.passports p on p.id = ca.passport_id
  left join public.institutions inst on inst.id = ca.engaged_by_institution_id
  where ca.clinician_id = auth.uid()
    and ca.is_active = true
    and public.is_verified_clinician(auth.uid())
  order by ca.linked_at desc;
$$;

grant execute on function public.get_clinician_passports() to authenticated;
