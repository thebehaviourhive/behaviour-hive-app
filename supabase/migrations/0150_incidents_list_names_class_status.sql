-- get_institution_incidents() widened: real child names (the
-- anonymisation was never load-bearing for the principal), each
-- incident's class(es) at the time it happened, and a reusable signal
-- for the four-state status the principal's list needs to show.
--
-- RECON, checked before writing this, not assumed:
--
-- 1. CHILD NAMES. child_index ("A"/"B") is never referenced in any
--    narrative or user-facing copy anywhere in this codebase -- it's a
--    pure internal identifier, used only for stable ordering and by
--    get_parent_incidents()'s own SEPARATE, independent redaction
--    logic (a parent must never see another child's real name on a
--    shared incident -- that boundary is untouched, lives entirely in
--    a different function, and this migration never goes near it).
--    get_institution_incidents() is called from exactly three files,
--    all principal-only (principal/dashboard, principal/incidents,
--    principal/incidents/print) -- confirmed by grep, no parent or
--    teacher path calls it. Its own live authorization gate (0107,
--    reproducing 0078's widening) is can_countersign_incident() --
--    principal, or a delegated countersign permission -- and EVERY
--    caller who satisfies that already satisfies can_view_incident()
--    for every row in the result (can_countersign_incident() is
--    literally one of that function's own OR-branches), meaning
--    real names are already one click away on each incident's own
--    detail page today. The list's anonymisation protected nothing
--    that wasn't already reachable. Today, a two-child incident's
--    Child column literally reads "A, B" -- confirmed live, no name
--    at all.
--
-- 2. CLASS. Resolved historically -- class_at_time(passport_id,
--    occurred_at), the same primitive Term Overview (0147) built and
--    already established this exact precedent for: the class a child
--    was actually in on the day, not their class today. Applied here
--    for consistency, not re-litigated -- flagged in the accompanying
--    report in case an operational list (rather than a term report)
--    should reasonably prefer current class instead.
--
-- 3. STATUS. has_blocking_issues reuses incident_signoff_issues() --
--    the SAME function the sign-off summary and the database's own
--    guard triggers already use -- rather than a second definition of
--    "what's outstanding". Combined client-side with the existing
--    teacher_signed_at/countersigned_at timestamps (no new derivation
--    of those) into the four states.
--
-- child_indices, and every existing column, are left untouched --
-- purely additive. IncidentCard.tsx and the print route both still
-- read child_indices exactly as before; nothing about them changes or
-- breaks. child_names/class_names/has_blocking_issues are new columns
-- consumed only by the client change that follows this migration.
--
-- CREATE OR REPLACE cannot change a RETURNS TABLE column list -- drop
-- first, matching 0075/0078/0107's own established precedent for this
-- exact function.

drop function if exists public.get_institution_incidents(uuid, date, date, text, boolean);

create function public.get_institution_incidents(
  p_institution_id uuid,
  p_start date default null,
  p_end date default null,
  p_planning_status text default null,
  p_ncse_complete boolean default null
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
  order by i.occurred_at desc;
$$;

grant execute on function public.get_institution_incidents(uuid, date, date, text, boolean) to authenticated;
