-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 2, Stage 7 -- the teacher's four new sources. Self-scoped
-- throughout (auth.uid() alone is the authorization -- no institution
-- id parameter anywhere in this file, matching get_my_incident_
-- attestations()'s own established shape: the WHERE clause's own
-- ownership filter IS the gate, "empty, not an error" for anyone it
-- doesn't apply to).
--
-- get_my_incidents() is the genuinely new capability, not a filter on
-- an existing one: there has been no query and no screen anywhere in
-- this codebase that lists a teacher's own incidents, ever -- only a
-- direct link to one incident's own detail page. Shaped closely on
-- get_institution_incidents() (same date-range params, same restrictive-
-- practice/child-index aggregation) minus the three fields that only
-- mean something institution-wide (owning_teacher_name, created_by_name,
-- is_inherited -- inheritance always transfers TO a principal, never to
-- another teacher, so it's not a concept this RPC needs at all), plus
-- one field get_institution_incidents() still doesn't have:
-- debrief_completed, a REAL signal (incident_debriefs.completed_at is
-- not null), not the principal dashboard's own proxy (debrief_required
-- && !teacher_signed_at). That proxy works there specifically because
-- 0077's trigger guarantees a completed debrief once teacher_signed_at
-- is set -- it says nothing about the PRE-signoff incidents this RPC's
-- own "not signed off" bucket is entirely made of, where the debrief
-- may or may not be done yet. The two are deliberately different
-- derivations for the same underlying fact, not an inconsistency.

create function public.get_my_incidents(
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
  where (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    and (p_start is null or i.occurred_at::date >= p_start)
    and (p_end is null or i.occurred_at::date <= p_end)
  order by i.occurred_at desc;
$$;

grant execute on function public.get_my_incidents(date, date) to authenticated;

-- get_my_incident_attestation_issues() -- attestations WITHDRAWN OR
-- STALE on incidents the caller owns (not what they owe others, that's
-- get_my_incident_attestations()'s own job, unchanged, folded into the
-- dashboard as its own bucket rather than duplicated). Unlike the
-- principal's get_institution_withdrawn_attestations(), staleness has
-- no "latest row" shortcut -- it depends on comparing the incident's
-- CURRENT content hash against the hash an attestation was made
-- against (compute_incident_content_hash(), 0070), logic already fully
-- encapsulated in get_attestation_status(). Called per candidate row
-- here rather than re-derived inline -- unlike the principal's
-- institution-wide version, this is inherently small-N (one teacher's
-- own incidents, not a whole school), so the efficiency argument for
-- inlining doesn't apply the same way.

create function public.get_my_incident_attestation_issues()
returns table (
  incident_id uuid,
  incident_staff_id uuid,
  occurred_at timestamptz,
  location text,
  staff_user_id uuid,
  staff_name text,
  status text,
  status_label text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    i.id as incident_id,
    st.id as incident_staff_id,
    i.occurred_at,
    loc.value as location,
    st.user_id as staff_user_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as staff_name,
    public.get_attestation_status(st.id) as status,
    case public.get_attestation_status(st.id)
      when 'stale' then 'Stale'
      when 'withdrawn' then 'Withdrawn'
      else initcap(replace(public.get_attestation_status(st.id), '_', ' '))
    end as status_label
  from public.incident_staff st
  join public.incidents i on i.id = st.incident_id
  join public.incident_locations loc on loc.id = i.location_id
  left join auth.users u on u.id = st.user_id
  where (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    and public.get_attestation_status(st.id) in ('withdrawn', 'stale')
  order by i.occurred_at desc;
$$;

grant execute on function public.get_my_incident_attestation_issues() to authenticated;

-- get_my_cover_grants_expiring_today() -- temporary_access rows THIS
-- caller granted (either authority -- class_teacher for their own
-- class, or principal for any class; the function doesn't care which,
-- granted_by is granted_by regardless), still active, dated today.
-- Revoked grants are excluded -- they're already over, not "expiring".

create function public.get_my_cover_grants_expiring_today()
returns table (
  grant_id uuid,
  class_id uuid,
  class_name text,
  granted_to uuid,
  granted_to_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    t.id as grant_id,
    t.class_id,
    c.name as class_name,
    t.granted_to,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as granted_to_name
  from public.temporary_access t
  join public.classes c on c.id = t.class_id
  left join auth.users u on u.id = t.granted_to
  where t.granted_by = auth.uid()
    and t.revoked_at is null
    and t.granted_for_date = (now() at time zone public.app_local_timezone())::date
  order by c.name;
$$;

grant execute on function public.get_my_cover_grants_expiring_today() to authenticated;

-- get_my_class_sna_gaps() -- the same three-source shape classes/
-- [classId]/page.tsx already uses to derive "No SNA assigned" per
-- child (1:1 child_assignments, then class_sna_assignments, then
-- neither), scoped to classes THIS caller currently teaches
-- (class_teachers, ended_at is null) instead of a route param classId.

create function public.get_my_class_sna_gaps()
returns table (
  passport_id uuid,
  child_name text,
  class_id uuid,
  class_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    cc.passport_id,
    p.child_name,
    cc.class_id,
    c.name as class_name
  from public.class_teachers ct
  join public.classes c on c.id = ct.class_id
  join public.class_children cc on cc.class_id = ct.class_id and cc.ended_at is null
  join public.passports p on p.id = cc.passport_id
  where ct.user_id = auth.uid()
    and ct.ended_at is null
    and not exists (
      select 1 from public.child_assignments ca
      where ca.passport_id = cc.passport_id and ca.ended_at is null
    )
    and not exists (
      select 1 from public.class_sna_assignments csa
      where csa.class_id = cc.class_id and csa.ended_at is null
    )
  order by c.name, p.child_name;
$$;

grant execute on function public.get_my_class_sna_gaps() to authenticated;
