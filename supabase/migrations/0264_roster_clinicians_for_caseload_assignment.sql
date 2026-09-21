-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- TIER 1, ITEM 2 OF THE CLINIC UI LAYER BUILD, 21 Sept 2026.
-- ClinicianCoverageDetail's own "new" mode has always been the school's
-- own by-code lookup screen -- a clinic director assigning caseload
-- among their OWN roster of already-approved practitioners has no code
-- to enter at all, and bulk_grant_clinician_access()'s own p_roster_
-- user_id path (0224) has been reachable by RPC since PRD 5 Stage 6
-- with zero client callers.
--
-- ClinicianCoverageDetail's own "resolved" state (clinicianId, fullName,
-- specialty, code: null, workspaceEmail) is already exactly what a
-- roster-picked practitioner needs to populate to reuse the rest of
-- that component unchanged (the coverage checklist, Apply, workspace
-- email) -- the one thing missing is a way to LIST the clinic's own
-- roster with the two fields (specialty, current caseload count) the
-- component's header display needs, in one call, SECURITY DEFINER, so
-- the client never has to fall back to a raw `clinicians` select a
-- director has no RLS standing to read for someone else's row.
--
-- Caller check matches bulk_grant_clinician_access()'s own restriction
-- (principal only) -- no reason to show a picker for a caseload-
-- assignment action a caller couldn't actually perform.

create or replace function public.get_institution_roster_clinicians_for_caseload(
  p_institution_id uuid
)
returns table (
  user_id uuid,
  full_name text,
  specialty text,
  covered_child_count integer
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.user_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    coalesce(c.specialty, 'unspecified') as specialty,
    (
      select count(*)::integer from public.clinician_access ca
      where ca.clinician_id = s.user_id
        and ca.engaged_by = 'institution'
        and ca.engaged_by_institution_id = p_institution_id
        and ca.is_active = true
    ) as covered_child_count
  from public.institution_staff s
  join auth.users u on u.id = s.user_id
  join public.institutions inst on inst.id = s.institution_id
  left join public.clinicians c on c.user_id = s.user_id
  where s.institution_id = p_institution_id
    and s.role = 'clinician'
    and inst.type = 'clinic'
    and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    and exists (
      select 1 from public.institution_staff caller
      where caller.institution_id = p_institution_id
        and caller.user_id = auth.uid()
        and caller.role = 'principal'
        and public.institution_staff_has_current_standing(caller.user_id, caller.institution_id)
    )
  order by full_name;
$$;

grant execute on function public.get_institution_roster_clinicians_for_caseload(uuid) to authenticated;
