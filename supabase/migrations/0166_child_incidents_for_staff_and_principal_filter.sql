-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Passport Incidents tabs -- two shape changes on EXISTING authorisation,
-- neither a widening. Every connected role should reach a child's
-- incidents from their own passport view; this is the SQL half.
--
-- =====================================================================
-- 1. get_child_incidents_for_staff() -- teacher and SNA.
-- =====================================================================
--
-- Identical shape to get_clinician_incidents() (0095) -- same columns,
-- same body, same injuries/restrictive_practice sub-selects still
-- scoped to p_passport_id -- copied deliberately rather than
-- reinvented, because the only thing that needs to change is WHO is
-- authorised, not what they see once they are.
--
-- Authorisation is has_child_access(auth.uid(), p_passport_id) AND
-- status <> 'draft' -- can_view_incident()'s own general child-access
-- branch (0104), verbatim. Nothing new granted: any teacher or SNA
-- with has_child_access() to this child can ALREADY open any of these
-- incidents directly via /teacher/incidents/[incidentId] today (that's
-- what the branch is for) -- this RPC exposes the same already-legal
-- read in list shape, for one child, so a passport's own Incidents tab
-- has something to call. A teacher merely named as staff on an
-- incident (without has_child_access() to the child) is NOT covered by
-- this RPC and correctly sees nothing extra here -- that's a narrower
-- relationship (one incident, not the child generally), already served
-- by AttestationCard/the incident detail page directly, not this tab.
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
  where public.has_child_access(auth.uid(), p_passport_id)
    and i.status <> 'draft'
  order by i.occurred_at desc;
$$;

grant execute on function public.get_child_incidents_for_staff(uuid) to authenticated;

-- =====================================================================
-- 2. get_institution_incidents() -- p_passport_id, an optional filter.
-- =====================================================================
--
-- Live definition is 0150's (confirmed by the corrected grep pattern
-- CLAUDE.md now documents -- 0075/0078/0107/0150 all used DROP + CREATE,
-- not CREATE OR REPLACE, because each widened the RETURNS TABLE column
-- list; a plain "create or replace function public.get_institution_
-- incidents" grep finds only 0068). Reproduced verbatim from that live
-- body below, with exactly one addition: p_passport_id, defaulted null
-- so every EXISTING caller (principal/dashboard, principal/incidents,
-- principal/incidents/print) is unaffected -- omitting the new param
-- keeps the institution-wide behaviour those three screens already
-- rely on, byte-for-byte. Authorisation (can_countersign_incident())
-- is untouched -- a principal who can already see every incident at
-- their institution can now also filter that same set down to one
-- child, nothing more is granted.
--
-- DROP + CREATE, matching precedent -- not because the RETURNS TABLE
-- column list changes this time (it doesn't), but because adding a new
-- PARAMETER changes the function's own argument-type signature just as
-- much as changing its return shape does: CREATE OR REPLACE cannot
-- alter a function's argument types, only its body/defaults for
-- EXISTING parameters, and Postgres would silently register a second,
-- overloaded 6-argument function alongside the untouched 5-argument
-- one rather than truly replacing it -- the exact ambiguity this
-- function's own history (0075/0078/0107/0150) has already been
-- through once for the return shape, now for the argument list.
drop function if exists public.get_institution_incidents(uuid, date, date, text, boolean);

create function public.get_institution_incidents(
  p_institution_id uuid,
  p_start date default null,
  p_end date default null,
  p_planning_status text default null,
  p_ncse_complete boolean default null,
  p_passport_id uuid default null
)
returns table (
  incident_id uuid,
  occurred_at timestamptz,
  recorded_at timestamptz,
  location text,
  category text,
  status text,
  owning_teacher_name text,
  child_indices text[],
  child_names text[],
  class_names text[],
  debrief_required boolean,
  teacher_signed_at timestamptz,
  countersigned_at timestamptz,
  has_restrictive_practice boolean,
  planning_status text[],
  ncse_report_complete boolean[],
  created_by_name text,
  is_inherited boolean,
  inherited_from_name text,
  inherited_transferred_at timestamptz,
  has_blocking_issues boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    i.id as incident_id,
    i.occurred_at,
    i.recorded_at,
    loc.value as location,
    i.category,
    i.status,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as owning_teacher_name,
    (select array_agg(ic.child_index order by ic.child_index) from public.incident_children ic where ic.incident_id = i.id) as child_indices,
    (
      select array_agg(p.child_name order by ic.child_index)
      from public.incident_children ic
      join public.passports p on p.id = ic.passport_id
      where ic.incident_id = i.id
    ) as child_names,
    (
      select array_agg(distinct coalesce(c.name, 'Unassigned') order by coalesce(c.name, 'Unassigned'))
      from public.incident_children ic
      left join public.classes c on c.id = public.class_at_time(ic.passport_id, i.occurred_at)
      where ic.incident_id = i.id
    ) as class_names,
    i.debrief_required,
    i.teacher_signed_at,
    i.countersigned_at,
    exists (select 1 from public.restrictive_practices rp where rp.incident_id = i.id) as has_restrictive_practice,
    (select array_agg(rp.planning_status) from public.restrictive_practices rp where rp.incident_id = i.id) as planning_status,
    (select array_agg(rp.ncse_report_complete) from public.restrictive_practices rp where rp.incident_id = i.id) as ncse_report_complete,
    coalesce(creator.raw_user_meta_data ->> 'full_name', creator.raw_app_meta_data ->> 'full_name') as created_by_name,
    (iot.id is not null) as is_inherited,
    coalesce(from_teacher.raw_user_meta_data ->> 'full_name', from_teacher.raw_app_meta_data ->> 'full_name') as inherited_from_name,
    iot.transferred_at as inherited_transferred_at,
    (jsonb_array_length(public.incident_signoff_issues(i)) > 0) as has_blocking_issues
  from public.incidents i
  join public.incident_locations loc on loc.id = i.location_id
  left join auth.users u on u.id = i.owning_teacher_id
  left join auth.users creator on creator.id = i.created_by
  left join public.incident_ownership_transfers iot on iot.incident_id = i.id
  left join auth.users from_teacher on from_teacher.id = iot.from_teacher_id
  where i.institution_id = p_institution_id
    and public.can_countersign_incident(auth.uid(), p_institution_id)
    and (p_start is null or i.occurred_at::date >= p_start)
    and (p_end is null or i.occurred_at::date <= p_end)
    and (
      p_planning_status is null
      or exists (select 1 from public.restrictive_practices rp where rp.incident_id = i.id and rp.planning_status = p_planning_status)
    )
    and (
      p_ncse_complete is null
      or exists (select 1 from public.restrictive_practices rp where rp.incident_id = i.id and rp.ncse_report_complete = p_ncse_complete)
    )
    and (
      p_passport_id is null
      or exists (select 1 from public.incident_children ic where ic.incident_id = i.id and ic.passport_id = p_passport_id)
    )
  order by i.occurred_at desc;
$$;

grant execute on function public.get_institution_incidents(uuid, date, date, text, boolean, uuid) to authenticated;
