-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 5 Stage 4, Step 4 -- the thing that makes clinical_lead mean
-- something. Scope has real values to match against now (0213-0215);
-- this migration wires it into actual authority: the discharge branch
-- Stage 3 deliberately left out, plus a genuinely new read path.
--
-- WHY NOT has_child_access() -- asked explicitly, answered explicitly,
-- not assumed. has_child_access() = has_class_teacher_access() OR
-- has_sna_access() (0104) -- both entirely school-side, keyed on
-- class_children/class_teachers/child_assignments, tables a clinic
-- never touches. It backs 45 separate policy references across 11
-- migration files, INCLUDING WRITE policies (e.g. strategy_feedback's
-- own INSERT gate uses the narrower has_class_teacher_access()
-- specifically) -- CLAUDE.md's own "NOT done by widening has_child_
-- access() itself" entry (0160) already drew this exact line for the
-- SCHOOL principal's own read access, for the identical reason: widening
-- a shared read/write chokepoint to add a new role's VIEW access risks
-- granting far more than viewing, silently, in places never audited for
-- it. A lead's scoped access is a second, independent instance of the
-- same risk 0160 was written to avoid the first time -- built the same
-- way, a new dedicated SECURITY DEFINER RPC, not a widened primitive.
--
-- THE DISCHARGE BRANCH: role='clinical_lead', institutions.lead_can_
-- discharge_within_scope, and _lead_episode_in_scope() (0215) all three
-- required. Everything else about end_clinic_episode() (0211) is
-- unchanged -- same signature, CREATE OR REPLACE is sufficient.
--
-- THE READ PATH: get_child_passport_profile_for_lead() mirrors get_
-- child_passport_profile_for_principal() (0160) column for column --
-- same fields, same "same level of permissions" posture that migration
-- established -- gated on _lead_episode_in_scope() instead of a flat
-- role='principal' + passport_institution_links check, and scoped to
-- the episode's own ACTIVE state (e.ended_at is null): a lead's scope is
-- present-tense oversight ("she runs Tusla in Dublin"), not a permanent
-- grant that outlives the client's own relationship with the clinic --
-- the same reasoning Stage 3's own discharge cascade already applies to
-- clinician_access. get_institution_episode_roster_for_lead() mirrors
-- get_institution_episode_roster() (0211) the same way, scoped
-- identically -- infrastructure to reach an episode_id at all, not a
-- dashboard surface (PRD section 10 defers that, unchanged by this
-- stage).

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
  v_caller_staff_id uuid;
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

  select s.id, s.role into v_caller_staff_id, v_caller_role
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
    or (
      v_caller_role = 'clinical_lead'
      and exists (
        select 1 from public.institutions inst
        where inst.id = v_episode.institution_id
          and inst.lead_can_discharge_within_scope
      )
      and public._lead_episode_in_scope(v_caller_staff_id, p_episode_id)
    )
  ) then
    raise exception 'Only a clinical director, a practitioner discharging their own client (where enabled), or a lead discharging within their own scope (where enabled), can end an episode of care.';
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

create or replace function public.get_child_passport_profile_for_lead(
  p_passport_id uuid
)
returns table (
  child_name text,
  diagnoses text[],
  diagnosis_other text,
  section_a_complete boolean,
  hard_signals text[],
  hard_signals_other text,
  hard_triggers text[],
  hard_triggers_other text,
  communication_methods text[],
  communication_methods_other text,
  shows_happy text,
  shows_anxious text,
  phrases_to_avoid text,
  before_behaviour text[],
  before_behaviour_other text,
  during_distress text[],
  during_distress_other text,
  after_distress text[],
  after_distress_other text,
  sensory_seeks text[],
  sensory_seeks_other text,
  sensory_avoids text[],
  sensory_avoids_other text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.child_name, p.diagnoses, p.diagnosis_other, p.section_a_complete,
    sb.hard_signals, sb.hard_signals_other, sb.hard_triggers, sb.hard_triggers_other,
    sc.communication_methods, sc.communication_methods_other, sc.shows_happy, sc.shows_anxious, sc.phrases_to_avoid,
    sd.before_behaviour, sd.before_behaviour_other, sd.during_distress, sd.during_distress_other,
    sd.after_distress, sd.after_distress_other, sd.sensory_seeks, sd.sensory_seeks_other, sd.sensory_avoids, sd.sensory_avoids_other
  from public.passports p
  left join public.passport_section_b sb on sb.passport_id = p.id
  left join public.passport_section_c sc on sc.passport_id = p.id
  left join public.passport_section_d sd on sd.passport_id = p.id
  where p.id = p_passport_id
    and exists (
      select 1
      from public.institution_staff s
      join public.episodes_of_care e
        on e.institution_id = s.institution_id
        and e.passport_id = p_passport_id
        and e.ended_at is null
      where s.user_id = auth.uid()
        and s.role = 'clinical_lead'
        and s.deactivated_at is null
        and s.approved_at is not null
        and public._lead_episode_in_scope(s.id, e.id)
    );
$$;

grant execute on function public.get_child_passport_profile_for_lead(uuid) to authenticated;

create or replace function public.get_institution_episode_roster_for_lead(p_institution_id uuid)
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
        and s.role = 'clinical_lead'
        and s.approved_at is not null
        and s.deactivated_at is null
        and public._lead_episode_in_scope(s.id, e.id)
    )
  order by p.child_name;
$$;

grant execute on function public.get_institution_episode_roster_for_lead(uuid) to authenticated;
