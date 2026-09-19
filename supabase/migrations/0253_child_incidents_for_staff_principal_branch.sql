-- PRD 8 Stage 2 -- a real gap, found in the live browser pass, not the
-- fixture (the fixture's own negative-only assertions were vacuously
-- true on an empty result set -- a coverage gap in the check itself,
-- not a wrong-reason pass, but the same practical effect: nothing
-- caught this before a real principal session hit an empty export).
--
-- get_child_incidents_for_staff() (0166) gates on has_child_access()
-- alone -- has_class_teacher_access() OR has_sna_access(), CLASS-DERIVED
-- access. A principal is not automatically included, the same "a
-- principal is not on their own school's team listing either, unless
-- separately a class teacher too" shape this schema already documents
-- elsewhere (PRD 5 Stage 7's own get_passport_team() finding). The
-- school-side export screen calls this RPC expecting institution-wide
-- principal read, exactly like get_abc_logs() and get_passport_
-- clinical_content() already correctly provide -- this function never
-- got the same branch.
--
-- Same pattern, added the same way: an institution-wide principal
-- branch, OR'd alongside the existing has_child_access() gate.

create or replace function public.get_child_incidents_for_staff(p_passport_id uuid)
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
  where i.status <> 'draft'
    and (
      public.has_child_access(auth.uid(), p_passport_id)
      or exists (
        select 1 from public.institution_staff s
        where s.institution_id = i.institution_id
          and s.user_id = auth.uid()
          and s.role = 'principal'
          and s.deactivated_at is null
          and s.approved_at is not null
      )
    )
  order by i.occurred_at desc;
$$;

grant execute on function public.get_child_incidents_for_staff(uuid) to authenticated;
