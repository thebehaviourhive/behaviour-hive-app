-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 5 Stage 3, Step 3 -- discharge, and a minimal roster to actually
-- reach an episode_id to discharge. No dashboard yet (PRD section 10:
-- that comes last, deliberately, after the clinic has been run on this
-- for a while) -- but end_clinic_episode() needs SOME way to name which
-- episode, and get_institution_child_roster() (0074/0120) returns only
-- passport_id/child_name, no episode_id. A minimal, role-agnostic
-- roster RPC, mirroring that function's own shape exactly, is
-- infrastructure this mechanism needs to be exercised at all -- not a
-- "surface" in the sense PRD section 10 is deferring.
--
-- THE CASCADE: caseload only. _close_caseload_for_episode_end() below
-- is the SAME clause _close_child_access_for_enrolment_end() (0121,
-- extended 0123) already runs for a school ending an institution-
-- engaged clinician's access -- clinician_access rows, engaged_by =
-- 'institution', engaged_by_institution_id = this clinic, closed.
-- Extracted as its own small helper rather than folded into that
-- function, since a clinic has no class_children/child_assignments/
-- passport_access-equivalent clauses to sit alongside -- reusing the
-- CLAUSE, not the function, which would otherwise need clinic-specific
-- branching bolted onto a school-shaped cascade.
--
-- MUST NOT TOUCH, confirmed during recon, restated here so the next
-- migration doesn't "fix" an absence into a regression: passport_
-- institution_links (a discharge ends ACCESS, not the record the
-- organisation authored -- exactly 0121's own reasoning for the school
-- side); clinical_lead_scope (a staff member's own authority, unrelated
-- to one client leaving); the institutions.* toggles; and any tag that
-- eventually sits on this episode row (PRD section 8: "the old one
-- stays, tagged as it was" -- discharge ends access, not history).
--
-- WHO CAN DISCHARGE: director (role='principal') always -- identical
-- shape to end_enrolment()'s own check, no new pattern. Practitioner
-- (role='clinician') only when institutions.practitioner_can_discharge_
-- own_clients is true AND the client is genuinely on their own caseload
-- (a live clinician_access row, engaged_by='institution', this
-- clinician, this institution, this passport) -- "own clients," not any
-- client at the clinic. clinical_lead is DELIBERATELY NOT a branch
-- here, on Daniel's own instruction: lead_can_discharge_within_scope
-- exists (0207) but "within scope" means matching tag values on the
-- episode, and tags don't exist until Stage 4 -- every episode Stage 3
-- creates is untagged. A toggle-plus-scope check that can only ever
-- return false is worse than no check at all (CLAUDE.md's own "a check
-- that can't prove anything" caution) -- Stage 4 adds the lead branch
-- once scope has something real to match against. admin (role=
-- 'clinic_admin') is NOT a discharger either -- PRD section 5 describes
-- admin as onboarding/records/data-sharing, never discharge, and this
-- migration doesn't invent it.
--
-- p_reason is validated against discharge_reasons (global or this
-- institution's own active rows) rather than accepted as free text --
-- same posture as end_enrolment()'s own literal-list check, just
-- resolved against the vocabulary table instead of a CHECK constraint.

create or replace function public._close_caseload_for_episode_end(
  p_passport_id uuid,
  p_institution_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grants_revoked integer := 0;
begin
  update public.clinician_access
  set is_active = false,
      revoked_at = now(),
      revoked_by = p_actor_id,
      revocation_reason = 'Episode of care ended (' || p_reason || ').'
  where passport_id = p_passport_id
    and engaged_by = 'institution'
    and engaged_by_institution_id = p_institution_id
    and is_active = true;

  get diagnostics v_grants_revoked = row_count;

  return v_grants_revoked;
end;
$$;

create or replace function public.end_clinic_episode(
  p_episode_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_episode public.episodes_of_care;
  v_caller_role text;
begin
  select * into v_episode from public.episodes_of_care where id = p_episode_id;
  if not found then
    raise exception 'Episode of care not found.';
  end if;

  if v_episode.ended_at is not null then
    raise exception 'This episode of care has already ended.';
  end if;

  if not exists (
    select 1 from public.discharge_reasons dr
    where dr.value = p_reason
      and dr.is_active = true
      and (dr.institution_id is null or dr.institution_id = v_episode.institution_id)
  ) then
    raise exception 'A valid discharge reason is required.';
  end if;

  select s.role into v_caller_role
  from public.institution_staff s
  join public.institutions inst on inst.id = s.institution_id
  where s.institution_id = v_episode.institution_id
    and s.user_id = auth.uid()
    and inst.status = 'verified'
    and inst.type = 'clinic'
    and public.institution_staff_has_current_standing(s.user_id, s.institution_id);

  if v_caller_role is null or not (
    v_caller_role = 'principal'
    or (
      v_caller_role = 'clinician'
      and exists (
        select 1 from public.institutions inst
        where inst.id = v_episode.institution_id
          and inst.practitioner_can_discharge_own_clients
      )
      and exists (
        select 1 from public.clinician_access ca
        where ca.passport_id = v_episode.passport_id
          and ca.clinician_id = auth.uid()
          and ca.engaged_by = 'institution'
          and ca.engaged_by_institution_id = v_episode.institution_id
          and ca.is_active = true
      )
    )
  ) then
    raise exception 'Only a clinical director, or (where enabled) a practitioner discharging their own client, can end an episode of care.';
  end if;

  update public.episodes_of_care
  set ended_at = now(), ended_by = auth.uid(), end_reason = p_reason
  where id = p_episode_id
    and ended_at is null;

  if not found then
    raise exception 'This episode of care has already ended.';
  end if;

  perform public._close_caseload_for_episode_end(
    v_episode.passport_id, v_episode.institution_id, auth.uid(), p_reason
  );
end;
$$;

grant execute on function public.end_clinic_episode(uuid, text) to authenticated;

create or replace function public.get_institution_episode_roster(p_institution_id uuid)
returns table (
  episode_id uuid,
  passport_id uuid,
  child_name text,
  started_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select e.id as episode_id, p.id as passport_id, p.child_name, e.started_at
  from public.episodes_of_care e
  join public.passports p on p.id = e.passport_id
  where e.institution_id = p_institution_id
    and e.ended_at is null
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and s.approved_at is not null
        and s.deactivated_at is null
    )
  order by p.child_name;
$$;

grant execute on function public.get_institution_episode_roster(uuid) to authenticated;
