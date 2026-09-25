-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Found by clinician-role-target-scan.mjs the moment 0308 re-created
-- this function (that scanner resolves every `role = 'clinician'` hit
-- to its own LIVE, highest-numbered definition on every run -- it
-- isn't incremental, so this was a real, pre-existing, unaudited
-- instance of this session's own already-documented bug class
-- (CLAUDE.md's "QUEUED: A FULL SWEEP FOR role = 'clinician' LITERAL
-- CHECKS..." entry), not something 0308 introduced -- 0308 copied this
-- exact clause verbatim from the live 0227 definition, and it had
-- simply never been swept.
--
-- get_institution_draft_fbas()'s own TARGET check -- "is the FBA's
-- author a clinician at this clinic" -- required s.role = 'clinician'
-- literally, which silently excludes a clinical director or
-- clinical_lead authoring their OWN FBA (a real, supported capability
-- since PRD 10 section 4a: "every clinical role is a genuine
-- practitioner... a director or clinical_lead can author their own
-- FBAs"). A director's or lead's own draft FBA would never have
-- surfaced in this bucket for anyone, including a colleague director,
-- to ever see as outstanding. Widened to role in ('clinician',
-- 'clinical_lead', 'principal'), matching 0275/0276/0277's own fix for
-- the identical shape on other functions.
--
-- Nothing else about the function changes -- same signature, same
-- content_data = '{}' filter from 0308, same caller gate.

create or replace function public.get_institution_draft_fbas(p_institution_id uuid)
returns table (
  fba_id uuid,
  passport_id uuid,
  child_name text,
  clinician_id uuid,
  clinician_name text,
  status text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select f.id, f.passport_id, p.child_name, f.clinician_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'), f.status, f.created_at
  from public.fba_reports f
  join public.passports p on p.id = f.passport_id
  join auth.users u on u.id = f.clinician_id
  where f.status <> 'completed'
    and f.content_data = '{}'::jsonb
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = p_institution_id
        and s.user_id = f.clinician_id
        and s.role in ('clinician', 'clinical_lead', 'principal')
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
    and exists (
      select 1 from public.institution_staff caller
      join public.institutions inst on inst.id = caller.institution_id
      where caller.institution_id = p_institution_id
        and caller.user_id = auth.uid()
        and caller.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(caller.user_id, caller.institution_id)
    )
  order by f.created_at;
$$;

grant execute on function public.get_institution_draft_fbas(uuid) to authenticated;
