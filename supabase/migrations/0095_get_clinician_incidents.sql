-- Phase 5: clinician incident view. Gated on status <> 'draft' (not
-- teacher_signed_at is not null) -- matches can_view_incident()'s own
-- clinician branch exactly, confirmed correct and deliberately left
-- untouched during 0089's redesign. Clinicians see earlier than
-- parents by design; this RPC's gate must agree with that, not with
-- get_parent_incidents()'s own (deliberately different) gate.
--
-- "Full" means everything clinically relevant -- narrative included,
-- unlike get_parent_incidents(). Reuses that RPC's own already-verified
-- injuries/restrictive_practice jsonb sub-selects (still scoped to
-- p_passport_id, so cross-child leakage is prevented by the same
-- construction regardless of caller). Deliberately excludes governance/
-- administrative fields -- attestation chain, amendments, countersign
-- metadata, parent_called_at/parent_notified_at -- those are staff
-- operations, not clinical content.
create or replace function public.get_clinician_incidents(p_passport_id uuid)
returns table (
  incident_id uuid, occurred_at timestamptz, recorded_at timestamptz, location text,
  status text, category text, party text[], party_other text, item_involved text,
  narrative text, parent_summary text, staff_count_needed text, staff_distressed text,
  risk_reduction_future text, other_information text, anyone_injured boolean,
  debrief_required boolean, teacher_signed_at timestamptz, countersigned_at timestamptz,
  child_index text, distress_level text, remained_on_site boolean, remained_detail text,
  recovery_methods text[], actions jsonb, injuries jsonb, restrictive_practice jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select
    i.id as incident_id, i.occurred_at, i.recorded_at, loc.value as location, i.status,
    i.category, i.party, i.party_other, i.item_involved, i.narrative, i.parent_summary,
    i.staff_count_needed, i.staff_distressed, i.risk_reduction_future, i.other_information,
    i.anyone_injured, i.debrief_required, i.teacher_signed_at, i.countersigned_at,
    ic.child_index, ic.distress_level, ic.remained_on_site, ic.remained_detail, ic.recovery_methods,
    coalesce((
      select jsonb_agg(jsonb_build_object('value', at.value, 'other_detail', ia.other_detail))
      from public.incident_actions ia
      join public.incident_action_types at on at.id = ia.action_type_id
      where ia.incident_id = i.id
    ), '[]'::jsonb) as actions,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'injury_types', inj.injury_types, 'injury_notes', inj.injury_notes,
        'first_aider_called', inj.first_aider_called, 'first_aider_name', inj.first_aider_name,
        'doctor_ambulance_called', inj.doctor_ambulance_called, 'treatments', inj.treatments,
        'treatment_other', inj.treatment_other, 'remained_on_site', inj.remained_on_site, 'remained_detail', inj.remained_detail
      ))
      from public.incident_injuries inj
      where inj.incident_id = i.id and inj.injured_party_type = 'student' and inj.passport_id = p_passport_id
    ), '[]'::jsonb) as injuries,
    coalesce((
      select jsonb_agg(jsonb_build_object('planning_status', rp.planning_status, 'ncse_report_complete', rp.ncse_report_complete))
      from public.restrictive_practices rp
      where rp.incident_id = i.id and rp.passport_id = p_passport_id
    ), '[]'::jsonb) as restrictive_practice
  from public.incidents i
  join public.incident_children ic on ic.incident_id = i.id and ic.passport_id = p_passport_id
  join public.incident_locations loc on loc.id = i.location_id
  where public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = p_passport_id and ca.clinician_id = auth.uid() and ca.is_active = true
    )
    and i.status <> 'draft'
  order by i.occurred_at desc;
$$;

grant execute on function public.get_clinician_incidents(uuid) to authenticated;
