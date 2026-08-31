-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Fixes a real bug in 0135's own get_my_incidents(), caught by Daniel's
-- own question before any adversarial coverage was written against it:
-- the WHERE clause matched "created_by = auth.uid() OR owning_teacher_
-- id = auth.uid()". After resolve_lapsed_incident_ownership() transfers
-- an incident (a supply teacher's grant lapses pre-signoff, ownership
-- moves to the principal -- 0105/0107), created_by stays the original
-- supply teacher forever (it never changes) while owning_teacher_id
-- moves to the principal. The OR meant the supply teacher would keep
-- seeing that incident on their own "not signed off" dashboard bucket
-- indefinitely, even though can_own_incident()/the edit policy/sign-
-- off itself all gate on owning_teacher_id alone -- they'd see an
-- incident on their own to-do list they have no remaining authority to
-- act on at all. This RPC exists specifically to back an ACTION-NEEDED
-- bucket, not a browsing/audit history where "I once touched this"
-- would be the right question -- so the predicate should only ever
-- have been owning_teacher_id, matching the same authority boundary
-- every write path already uses. AA-7e's own finding (visibility stays
-- unconditional on created_by even after a grant lapses) does NOT
-- apply here -- that's about being able to VIEW an incident, an
-- entirely different claim from belonging on someone's own to-do list.
--
-- CREATE OR REPLACE, same signature, only the WHERE clause changes.

create or replace function public.get_my_incidents(
  p_start date default null,
  p_end date default null
)
returns table (
  incident_id uuid,
  occurred_at timestamptz,
  recorded_at timestamptz,
  location text,
  category text,
  status text,
  child_indices text[],
  debrief_required boolean,
  debrief_completed boolean,
  teacher_signed_at timestamptz,
  countersigned_at timestamptz,
  has_restrictive_practice boolean,
  planning_status text[],
  ncse_report_complete boolean[]
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
    (select array_agg(ic.child_index order by ic.child_index) from public.incident_children ic where ic.incident_id = i.id) as child_indices,
    i.debrief_required,
    exists (select 1 from public.incident_debriefs idb where idb.incident_id = i.id and idb.completed_at is not null) as debrief_completed,
    i.teacher_signed_at,
    i.countersigned_at,
    exists (select 1 from public.restrictive_practices rp where rp.incident_id = i.id) as has_restrictive_practice,
    (select array_agg(rp.planning_status) from public.restrictive_practices rp where rp.incident_id = i.id) as planning_status,
    (select array_agg(rp.ncse_report_complete) from public.restrictive_practices rp where rp.incident_id = i.id) as ncse_report_complete
  from public.incidents i
  join public.incident_locations loc on loc.id = i.location_id
  where i.owning_teacher_id = auth.uid()
    and (p_start is null or i.occurred_at::date >= p_start)
    and (p_end is null or i.occurred_at::date <= p_end)
  order by i.occurred_at desc;
$$;

grant execute on function public.get_my_incidents(date, date) to authenticated;
