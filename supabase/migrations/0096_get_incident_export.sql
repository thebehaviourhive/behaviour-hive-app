-- Phase 6: the incident PDF's single data source. One comprehensive
-- SECURITY DEFINER RPC rather than a bespoke client-side join chain --
-- matches this module's own established pattern (get_institution_incidents,
-- get_countersign_summary, etc.) and avoids CLAUDE.md's own documented
-- embedded-join gotcha entirely.
--
-- Gated on can_view_incident() alone -- whoever can already see this
-- incident can export it; whether export is offered pre-signoff is a
-- client UI decision, not a new access rule invented here.
--
-- Deliberately does NOT read incident_staff.attested_at/
-- attestation_addendum -- confirmed dead via 0070's own comment ("nothing
-- in the new system reads attested_at/attestation_addendum for status any
-- more"). Attestation data comes from build_staff_attestations_summary(),
-- the same shared helper get_incident_signoff_summary()/
-- get_countersign_summary() already use -- not re-derived a third time.
--
-- Layout is the client's job; this RPC returns facts, not pre-written
-- fallback copy. Two facts the client needs to render "No CPI recorded
-- during incident" correctly: has_cpi_action (an action row flagged
-- is_restraint) and the restrictive_practice array's own length -- the
-- client decides the sentence, not this function.
create or replace function public.get_incident_export(p_incident_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident public.incidents;
  v_location text;
  v_result jsonb;
begin
  select * into v_incident from public.incidents where id = p_incident_id;
  if not found then
    raise exception 'Incident not found, or you do not have permission to view it.';
  end if;

  if not public.can_view_incident(p_incident_id) then
    raise exception 'You do not have permission to export this incident.';
  end if;

  select loc.value into v_location from public.incident_locations loc where loc.id = v_incident.location_id;

  select jsonb_build_object(
    'incident_id', v_incident.id,
    'occurred_at', v_incident.occurred_at,
    'recorded_at', v_incident.recorded_at,
    'location', v_location,
    'status', v_incident.status,
    'category', v_incident.category,
    'party', v_incident.party,
    'party_other', v_incident.party_other,
    'item_involved', v_incident.item_involved,
    'narrative', v_incident.narrative,
    'parent_summary', v_incident.parent_summary,
    'staff_count_needed', v_incident.staff_count_needed,
    'staff_distressed', v_incident.staff_distressed,
    'risk_reduction_future', v_incident.risk_reduction_future,
    'other_information', v_incident.other_information,
    'anyone_injured', v_incident.anyone_injured,
    'debrief_required', v_incident.debrief_required,

    'teacher_signed_at', v_incident.teacher_signed_at,
    'teacher_signed_by_name', (
      select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name')
      from auth.users u where u.id = v_incident.teacher_signed_by
    ),
    'countersigned_at', v_incident.countersigned_at,
    'countersigned_by_name', (
      select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name')
      from auth.users u where u.id = v_incident.countersigned_by
    ),
    'countersigned_role_at_time', v_incident.countersigned_role_at_time,
    'countersigned_via', v_incident.countersigned_via,

    'children', coalesce((
      select jsonb_agg(jsonb_build_object(
        'child_index', ic.child_index,
        'passport_id', ic.passport_id,
        'child_name', p.child_name,
        'distress_level', ic.distress_level,
        'remained_on_site', ic.remained_on_site,
        'remained_detail', ic.remained_detail,
        'recovery_methods', ic.recovery_methods
      ) order by ic.child_index)
      from public.incident_children ic
      join public.passports p on p.id = ic.passport_id
      where ic.incident_id = v_incident.id
    ), '[]'::jsonb),

    'staff_attestations', public.build_staff_attestations_summary(p_incident_id),

    'actions', coalesce((
      select jsonb_agg(jsonb_build_object('value', at.value, 'is_restraint', at.is_restraint, 'other_detail', ia.other_detail))
      from public.incident_actions ia
      join public.incident_action_types at on at.id = ia.action_type_id
      where ia.incident_id = v_incident.id
    ), '[]'::jsonb),
    'has_cpi_action', exists (
      select 1 from public.incident_actions ia
      join public.incident_action_types at on at.id = ia.action_type_id
      where ia.incident_id = v_incident.id and at.is_restraint = true
    ),

    'restrictive_practices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rp.id,
        'passport_id', rp.passport_id,
        'planning_status', rp.planning_status,
        'reason_codes', rp.reason_codes,
        'disengagement_codes', rp.disengagement_codes,
        'hold_type', rp.hold_type,
        'hold_position', rp.hold_position,
        'hold_level', rp.hold_level,
        'result_codes', rp.result_codes,
        'total_procedures', rp.total_procedures,
        'staff_initials', rp.staff_initials,
        'ncse_report_complete', rp.ncse_report_complete
      ))
      from public.restrictive_practices rp
      where rp.incident_id = v_incident.id
    ), '[]'::jsonb),

    'injuries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', inj.id,
        'injured_party_type', inj.injured_party_type,
        'passport_id', inj.passport_id,
        'party_name', coalesce(
          p.child_name,
          nullif(trim(inj.free_text_name), ''),
          coalesce(su.raw_user_meta_data ->> 'full_name', su.raw_app_meta_data ->> 'full_name'),
          'Unnamed'
        ),
        'injury_types', inj.injury_types,
        'injury_notes', inj.injury_notes,
        'first_aider_called', inj.first_aider_called,
        'first_aider_name', inj.first_aider_name,
        'doctor_ambulance_called', inj.doctor_ambulance_called,
        'treatments', inj.treatments,
        'treatment_other', inj.treatment_other,
        'remained_on_site', inj.remained_on_site,
        'remained_detail', inj.remained_detail,
        'body_marks', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', bm.id,
            'view', bm.view,
            'x', bm.x,
            'y', bm.y,
            'region_value', reg.value,
            'side', bm.side,
            'injury_type_name', it.value,
            'skin_broken', bm.skin_broken,
            'other_detail', bm.other_detail
          ) order by bm.created_at)
          from public.incident_body_marks bm
          join public.incident_body_regions reg on reg.id = bm.region_id
          join public.incident_injury_types it on it.id = bm.injury_type_id
          where bm.injury_id = inj.id
        ), '[]'::jsonb)
      ))
      from public.incident_injuries inj
      left join public.passports p on p.id = inj.passport_id
      left join auth.users su on su.id = inj.staff_user_id
      where inj.incident_id = v_incident.id
    ), '[]'::jsonb),

    'debrief', (
      select jsonb_build_object(
        'debrief_date', d.debrief_date,
        'staff_present', d.staff_present,
        'notes', d.notes,
        'actions_for_management', d.actions_for_management,
        'completed_by_name', (
          select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name')
          from auth.users u where u.id = d.completed_by
        ),
        'completed_at', d.completed_at
      )
      from public.incident_debriefs d
      where d.incident_id = v_incident.id
    ),

    'amendments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', am.id,
        'reason', am.reason,
        'content', am.content,
        'author_name', coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
        'created_at', am.created_at
      ) order by am.created_at)
      from public.incident_amendments am
      left join auth.users u on u.id = am.author_id
      where am.incident_id = v_incident.id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_incident_export(uuid) to authenticated;
