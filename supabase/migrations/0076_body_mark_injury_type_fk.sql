/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SCHOOL INCIDENT LOG -- body-map groundwork, ahead of building the UI.

   incident_body_marks.injury_type was a nullable, unconstrained text
   column -- a marker could be saved with no type at all, and nothing
   tied its value to the seeded incident_injury_types vocabulary the way
   incident_actions.action_type_id properly FKs to
   incident_action_types.id. Both gaps close here:

     1. injury_type (text) is replaced with injury_type_id (uuid, not
        null, references incident_injury_types.id) -- the same shape
        incident_actions already uses, not a text-value FK. value has no
        unique constraint on incident_injury_types (institutions can add
        their own overrides, potentially reusing a label like "Other"),
        so a text->text FK isn't the right match here -- an id->id FK is.
     2. not null -- "a marker with no type is not valid" is now
        impossible to persist, not just discouraged by the UI.

   No ON DELETE clause, matching incident_actions' own FK and 0068's own
   reasoning for incident_injury_types (is_active, not delete, is how a
   school retires an option) -- a hard delete of a referenced vocabulary
   row should be rejected, not silently cascade into deleting a real
   incident's marker or leaving a dangling reference.

   Confirmed live before writing this: incident_body_marks has zero rows
   today (the body-map UI doesn't exist yet), so this is a straight
   column swap, not a data migration.

   compute_incident_content_hash() (0072) still references bm.injury_type
   in its body_marks aggregate -- left unfixed, that column rename would
   silently break attestation hashing the next time the function runs.
   Updated in the same migration, everything else in the function
   unchanged. */

alter table public.incident_body_marks drop column injury_type;

alter table public.incident_body_marks
  add column injury_type_id uuid not null references public.incident_injury_types (id);

create index incident_body_marks_injury_type_id_idx on public.incident_body_marks (injury_type_id);


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
        'body_marks', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'view', bm.view,
              'x', bm.x,
              'y', bm.y,
              'injury_type_id', bm.injury_type_id
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
