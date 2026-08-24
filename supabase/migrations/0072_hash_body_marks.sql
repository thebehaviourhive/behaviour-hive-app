/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SCHOOL INCIDENT LOG -- reverses one judgment call from 0070/0071:
   compute_incident_content_hash() now includes body-map markers.

   Explicit decision: a marker moving from a forearm to a throat is a
   change to the single most contested fact an incident record can
   contain -- an attestation that survives that move silently isn't
   worth anything. Hashes view, x, y, injury_type per marker (not note --
   not asked for, and it's a free-text annotation layered on a fact
   already captured by the other three fields, same category as
   injury_notes already sitting outside incident_injuries' own hashed
   fields... except injury_notes IS already hashed. Kept narrowly to
   exactly what was specified: view/position/injury_type). Excluding
   ncse_report_complete and its timestamp/actor remains correct and
   unchanged -- that's paperwork state, not a fact about the incident,
   and nothing about this change touches that reasoning.

   This is the ONLY change: compute_incident_content_hash() gains one
   more key in the jsonb object it hashes. get_attestation_status(),
   attest_to_incident(), the sign-off trigger, and everything else that
   calls this function needs no change at all -- exactly the point of
   having one function be the single definition of "the account
   changed": widening what counts as the account is a change to this
   one function body, nothing downstream has to know. */

create or replace function public.compute_incident_content_hash(p_incident_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select md5(
    coalesce((
      select jsonb_build_object(
        'narrative', coalesce(i.narrative, ''),
        'children', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'child_index', ic.child_index,
              'distress_level', ic.distress_level,
              'remained_on_site', ic.remained_on_site
            ) order by ic.child_index
          )
          from public.incident_children ic
          where ic.incident_id = i.id
        ), '[]'::jsonb),
        'actions', coalesce((
          select jsonb_agg(ia.action_type_id order by ia.action_type_id)
          from public.incident_actions ia
          where ia.incident_id = i.id
        ), '[]'::jsonb),
        'restrictive_practices', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'passport_id', rp.passport_id,
              'planning_status', rp.planning_status,
              'reason_codes', rp.reason_codes,
              'disengagement_codes', rp.disengagement_codes,
              'hold_type', rp.hold_type,
              'hold_position', rp.hold_position,
              'hold_level', rp.hold_level,
              'result_codes', rp.result_codes,
              'total_procedures', rp.total_procedures,
              'staff_initials', rp.staff_initials
            ) order by rp.id
          )
          from public.restrictive_practices rp
          where rp.incident_id = i.id
        ), '[]'::jsonb),
        'injuries', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'injured_party_type', inj.injured_party_type,
              'passport_id', inj.passport_id,
              'staff_user_id', inj.staff_user_id,
              'free_text_name', inj.free_text_name,
              'injury_types', inj.injury_types,
              'injury_notes', inj.injury_notes,
              'first_aider_called', inj.first_aider_called,
              'first_aider_name', inj.first_aider_name,
              'doctor_ambulance_called', inj.doctor_ambulance_called,
              'treatments', inj.treatments,
              'treatment_other', inj.treatment_other,
              'remained_on_site', inj.remained_on_site,
              'remained_detail', inj.remained_detail
            ) order by inj.id
          )
          from public.incident_injuries inj
          where inj.incident_id = i.id
        ), '[]'::jsonb),
        -- NEW: body-map markers -- view, position, injury_type. Scoped
        -- through incident_injuries (body marks have no direct
        -- incident_id column of their own, see 0068 Part 9).
        'body_marks', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'view', bm.view,
              'x', bm.x,
              'y', bm.y,
              'injury_type', bm.injury_type
            ) order by bm.id
          )
          from public.incident_body_marks bm
          join public.incident_injuries bmi on bmi.id = bm.injury_id
          where bmi.incident_id = i.id
        ), '[]'::jsonb)
      )::text
      from public.incidents i
      where i.id = p_incident_id
    ), '')
  );
$$;

-- No grant to authenticated -- unchanged, still internal-only.
