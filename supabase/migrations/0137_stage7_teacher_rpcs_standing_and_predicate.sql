-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Two corrections, found while proving "a deactivated teacher sees
-- nothing" rather than assuming it:
--
-- 1. NONE of the four 0135 functions checked institution_staff standing
-- at all -- ownership/grantor/class-membership alone was the only gate.
-- deactivate_institution_staff() (0104) never touches incidents.
-- owning_teacher_id, class_teachers, or temporary_access -- deactivating
-- someone does not retroactively end any of these, so without an
-- explicit standing check a deactivated teacher's old incidents,
-- attestation issues, and cover grants would keep surfacing on their
-- own dashboard indefinitely. institution_staff_has_current_standing()
-- added to all four, checked against each row's own institution_id
-- (incidents.institution_id, temporary_access.institution_id, classes.
-- institution_id) -- these RPCs take no institution_id parameter
-- themselves, so standing is resolved from the row being considered,
-- not a caller-supplied value.
--
-- 2. get_my_incident_attestation_issues() had the SAME "created_by OR
-- owning_teacher_id" bug 0136 just fixed in get_my_incidents(), for the
-- identical reason -- found only by generalising Daniel's standing-
-- check requirement across all four functions rather than treating it
-- as scoped to the one already fixed. Same fix: owning_teacher_id only.
--
-- Both CREATE OR REPLACE, same signatures throughout.

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
    and public.institution_staff_has_current_standing(auth.uid(), i.institution_id)
    and (p_start is null or i.occurred_at::date >= p_start)
    and (p_end is null or i.occurred_at::date <= p_end)
  order by i.occurred_at desc;
$$;

grant execute on function public.get_my_incidents(date, date) to authenticated;

create or replace function public.get_my_incident_attestation_issues()
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
  where i.owning_teacher_id = auth.uid()
    and public.institution_staff_has_current_standing(auth.uid(), i.institution_id)
    and public.get_attestation_status(st.id) in ('withdrawn', 'stale')
  order by i.occurred_at desc;
$$;

grant execute on function public.get_my_incident_attestation_issues() to authenticated;

create or replace function public.get_my_cover_grants_expiring_today()
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
    and public.institution_staff_has_current_standing(auth.uid(), t.institution_id)
    and t.revoked_at is null
    and t.granted_for_date = (now() at time zone public.app_local_timezone())::date
  order by c.name;
$$;

grant execute on function public.get_my_cover_grants_expiring_today() to authenticated;

create or replace function public.get_my_class_sna_gaps()
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
    and public.institution_staff_has_current_standing(auth.uid(), c.institution_id)
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
