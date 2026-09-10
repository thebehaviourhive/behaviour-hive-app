-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PARENT-VERSION INCIDENT PDF, per child. Decided: the school PDF
-- carries real child names and everything; a multi-child incident also
-- gets a PARENT version, per child, siloed the same way the on-screen
-- parent incident view already is. Reuses that exact redaction logic
-- (get_parent_incidents, live definition 0152) rather than re-deriving
-- what a parent may see a second time -- this is the whole reason the
-- new surface is safe.
--
-- THREE DELIBERATE WIDENINGS beyond what get_parent_incidents() already
-- returned, each a considered decision, not a side effect of adding the
-- new p_incident_id filter:
--
-- 1. restraint_used (new boolean) -- a parent whose child was physically
--    restrained must be told so, in words, even though every mechanical
--    detail (hold type/position/level, who did it) stays out. Derived
--    from whether a restrictive_practices row exists for this child on
--    this incident -- that table's own passport_id is NOT NULL (checked
--    against the live schema before writing this), so its existence for
--    this child is already an unambiguous, always-attributed fact, not
--    an inference.
--
-- 2. body_marks, added to each of this child's own injuries -- if
--    injury types and treatments are shown, where they occurred should
--    be too. Same per-mark shape get_incident_export() already uses
--    (region_value/injury_type_name resolved by name, not raw id),
--    scoped by the same injured_party_type='student' AND passport_id
--    filter the injuries array itself already carries -- never another
--    child's, never a staff member's.
--
-- 3. amendments -- a correction to this child's own record should be as
--    visible to the parent as it is to the school; the whole design of
--    amendments is that corrections are visible, not silent. NAMED RISK,
--    not solved here: incident_amendments has no per-child scoping at
--    all (incident_id only) -- on a multi-child incident, BOTH
--    children's parents see the SAME amendment text, and if a principal's
--    free-text amendment happens to name the other child, that name
--    reaches this family with nothing structural to stop it. This is a
--    content-authoring risk, not fixable by a WHERE clause -- addressed
--    with an authoring-time reminder in AddAmendmentSheet, not a
--    filter here. author_name is deliberately NOT included, consistent
--    with teacher_signed_by_name/countersigned_by_name already being
--    withheld from this same view -- staff identity stays back, the
--    correction itself doesn't.
--
-- AUTHORIZATION WIDENED, same route two entry points: a parent reaches
-- their own child's version via owns_passport() (unchanged); staff
-- reach the identical function via can_view_incident() -- the same
-- authority the school export already uses. One function, two
-- authorities, so the redaction logic itself can never drift between
-- who's allowed to call it.
--
-- New optional p_incident_id filters to a single incident (the PDF's
-- own use) while leaving every existing caller -- the on-screen list,
-- which passes only p_passport_id -- completely unchanged. DROP +
-- CREATE, not bare CREATE OR REPLACE, per the standing rule for a new
-- trailing parameter.

drop function if exists public.get_parent_incidents(uuid);

create function public.get_parent_incidents(p_passport_id uuid, p_incident_id uuid default null)
returns table (
  incident_id uuid, incident_children_id uuid, occurred_at timestamptz, recorded_at timestamptz, location text,
  status text, parent_summary text, child_index text, distress_level text,
  remained_on_site boolean, remained_detail text, recovery_methods text[],
  parent_call_required boolean, parent_called_at timestamptz, parent_notified_at timestamptz,
  parent_acknowledged_at timestamptz,
  teacher_signed_at timestamptz, countersigned_at timestamptz,
  restraint_used boolean,
  injuries jsonb, restrictive_practice jsonb, amendments jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select
    i.id as incident_id, ic.id as incident_children_id, i.occurred_at, i.recorded_at, loc.value as location,
    i.status, i.parent_summary,
    ic.child_index, ic.distress_level, ic.remained_on_site, ic.remained_detail, ic.recovery_methods,
    ic.parent_call_required, ic.parent_called_at, ic.parent_notified_at, ic.parent_acknowledged_at,
    i.teacher_signed_at, i.countersigned_at,
    exists (
      select 1 from public.restrictive_practices rp2
      where rp2.incident_id = i.id and rp2.passport_id = p_passport_id
    ) as restraint_used,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'injury_types', inj.injury_types, 'injury_notes', inj.injury_notes,
        'first_aider_called', inj.first_aider_called, 'first_aider_name', inj.first_aider_name,
        'doctor_ambulance_called', inj.doctor_ambulance_called, 'treatments', inj.treatments,
        'treatment_other', inj.treatment_other, 'remained_on_site', inj.remained_on_site, 'remained_detail', inj.remained_detail,
        'body_marks', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', bm.id, 'view', bm.view, 'x', bm.x, 'y', bm.y,
            'region_value', reg.value, 'side', bm.side,
            'injury_type_name', it.value, 'skin_broken', bm.skin_broken
          ) order by bm.created_at)
          from public.incident_body_marks bm
          join public.incident_body_regions reg on reg.id = bm.region_id
          join public.incident_injury_types it on it.id = bm.injury_type_id
          where bm.injury_id = inj.id
        ), '[]'::jsonb)
      ))
      from public.incident_injuries inj
      where inj.incident_id = i.id and inj.injured_party_type = 'student' and inj.passport_id = p_passport_id
    ), '[]'::jsonb) as injuries,
    coalesce((
      select jsonb_agg(jsonb_build_object('planning_status', rp.planning_status, 'ncse_report_complete', rp.ncse_report_complete))
      from public.restrictive_practices rp
      where rp.incident_id = i.id and rp.passport_id = p_passport_id
    ), '[]'::jsonb) as restrictive_practice,
    coalesce((
      select jsonb_agg(jsonb_build_object('reason', am.reason, 'content', am.content, 'created_at', am.created_at) order by am.created_at)
      from public.incident_amendments am
      where am.incident_id = i.id
    ), '[]'::jsonb) as amendments
  from public.incidents i
  join public.incident_children ic on ic.incident_id = i.id and ic.passport_id = p_passport_id
  join public.incident_locations loc on loc.id = i.location_id
  where (public.owns_passport(p_passport_id) or public.can_view_incident(i.id))
    and i.teacher_signed_at is not null
    and (p_incident_id is null or i.id = p_incident_id)
  order by i.occurred_at desc;
$$;

grant execute on function public.get_parent_incidents(uuid, uuid) to authenticated;
