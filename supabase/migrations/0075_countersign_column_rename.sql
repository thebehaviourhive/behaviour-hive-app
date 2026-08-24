/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SCHOOL INCIDENT LOG -- countersign columns, renamed per an amendment
   that hadn't reached this build: principal_signed_at/principal_signed_by
   become countersigned_at/countersigned_by, plus a new
   countersigned_role_at_time -- the institution_staff.role the
   countersigning account actually held at the moment of countersign,
   captured then and frozen, not derived later. Once the real
   institution_permissions grant model lands (can_countersign_incident()
   is already the one function that decides "can this person
   countersign" -- migration 0073), the role that satisfied the grant
   might not always be 'principal' -- this column records what it
   actually was for THIS signature, regardless of what the rules say
   later.

   guard_incident_immutability() (0068) needs NO change -- it already
   works by OMISSION, not by naming the countersign columns explicitly:
   the post-signoff exception list simply never included
   principal_signed_at/principal_signed_by, so after this rename it
   still doesn't mention the (renamed, and one new) columns, which is
   exactly the correct behaviour carried forward automatically.

   The countersign policy (0073) and the two RPCs that expose this
   column (get_institution_incidents, get_parent_incidents) DO need
   updating -- done below. countersigned_role_at_time is verified
   server-side against the caller's actual institution_staff.role at
   write time, not trusted from client input -- the same posture as
   everywhere else in this module that records a fact rather than a
   claim. */


-- =====================================================================
-- 1. Rename, add the new column.
-- =====================================================================

alter table public.incidents rename column principal_signed_at to countersigned_at;
alter table public.incidents rename column principal_signed_by to countersigned_by;
alter table public.incidents add column countersigned_role_at_time text;


-- =====================================================================
-- 2. Countersign policy -- renamed columns, plus verifying
-- countersigned_role_at_time actually matches the caller's real role
-- rather than trusting whatever string the client sends.
-- =====================================================================

alter policy "Principal can countersign after teacher sign-off"
  on public.incidents
  using (
    teacher_signed_at is not null
    and countersigned_at is null
    and public.can_countersign_incident(auth.uid(), incidents.institution_id)
  )
  with check (
    countersigned_by = auth.uid()
    and countersigned_role_at_time = (
      select s.role from public.institution_staff s
      where s.institution_id = incidents.institution_id and s.user_id = auth.uid()
    )
  );


-- =====================================================================
-- 3. The two RPCs that expose this column -- rename only. Both need an
-- explicit DROP first: CREATE OR REPLACE cannot change a RETURNS TABLE
-- column's name (Postgres error 42P13, "cannot change return type of
-- existing function" -- the row type is defined by the OUT parameters,
-- and a rename changes that type even though every other column is
-- identical).
-- =====================================================================

drop function if exists public.get_parent_incidents(uuid);

create function public.get_parent_incidents(p_passport_id uuid)
returns table (
  incident_id uuid,
  occurred_at timestamptz,
  recorded_at timestamptz,
  location text,
  status text,
  parent_summary text,
  child_index text,
  distress_level text,
  remained_on_site boolean,
  remained_detail text,
  recovery_methods text[],
  parent_call_required boolean,
  parent_called_at timestamptz,
  parent_notified_at timestamptz,
  teacher_signed_at timestamptz,
  countersigned_at timestamptz,
  injuries jsonb,
  restrictive_practice jsonb
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
    i.status,
    i.parent_summary,
    ic.child_index,
    ic.distress_level,
    ic.remained_on_site,
    ic.remained_detail,
    ic.recovery_methods,
    ic.parent_call_required,
    ic.parent_called_at,
    ic.parent_notified_at,
    i.teacher_signed_at,
    i.countersigned_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'injury_types', inj.injury_types,
        'injury_notes', inj.injury_notes,
        'first_aider_called', inj.first_aider_called,
        'first_aider_name', inj.first_aider_name,
        'doctor_ambulance_called', inj.doctor_ambulance_called,
        'treatments', inj.treatments,
        'treatment_other', inj.treatment_other,
        'remained_on_site', inj.remained_on_site,
        'remained_detail', inj.remained_detail
      ))
      from public.incident_injuries inj
      where inj.incident_id = i.id
        and inj.injured_party_type = 'student'
        and inj.passport_id = p_passport_id
    ), '[]'::jsonb) as injuries,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'planning_status', rp.planning_status,
        'ncse_report_complete', rp.ncse_report_complete
      ))
      from public.restrictive_practices rp
      where rp.incident_id = i.id
        and rp.passport_id = p_passport_id
    ), '[]'::jsonb) as restrictive_practice
  from public.incidents i
  join public.incident_children ic on ic.incident_id = i.id and ic.passport_id = p_passport_id
  join public.incident_locations loc on loc.id = i.location_id
  where public.owns_passport(p_passport_id)
    and i.status <> 'draft'
  order by i.occurred_at desc;
$$;

grant execute on function public.get_parent_incidents(uuid) to authenticated;


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
  debrief_required boolean,
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
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as owning_teacher_name,
    (select array_agg(ic.child_index order by ic.child_index) from public.incident_children ic where ic.incident_id = i.id) as child_indices,
    i.debrief_required,
    i.teacher_signed_at,
    i.countersigned_at,
    exists (select 1 from public.restrictive_practices rp where rp.incident_id = i.id) as has_restrictive_practice,
    (select array_agg(rp.planning_status) from public.restrictive_practices rp where rp.incident_id = i.id) as planning_status,
    (select array_agg(rp.ncse_report_complete) from public.restrictive_practices rp where rp.incident_id = i.id) as ncse_report_complete
  from public.incidents i
  join public.incident_locations loc on loc.id = i.location_id
  left join auth.users u on u.id = i.owning_teacher_id
  where i.institution_id = p_institution_id
    and exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and inst.status = 'verified'
    )
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
