-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 2, Stage 6 follow-up. Replicates the settable cut-off
-- (temporary_access_cutoff_time, 0105) with a settable start time --
-- activation was a fixed 07:30 system-wide constant everywhere it
-- appeared; it becomes a per-institution setting, principal-only, the
-- same shape as the cut-off. Every function that hardcoded '07:30'::time
-- is re-created here against the LIVE definition it currently has (has_
-- sna_access()'s live body is 0129's, not 0105's or 0104's -- read
-- accordingly), not a fresh guess at what it should say.
--
-- 1. institutions.temporary_access_start_time -- default '07:30:00', so
-- every existing institution keeps today's behaviour unchanged until a
-- principal actively changes it. Table-level check constraint added
-- alongside the two RPC-level guards below (start < cutoff, enforced at
-- write time by both set_temporary_access_start_time() and set_
-- temporary_access_cutoff()) -- defense-in-depth against any future
-- write path that isn't one of those two RPCs, matching this schema's
-- general layering elsewhere.

alter table public.institutions
  add column if not exists temporary_access_start_time time not null default '07:30:00';

alter table public.institutions
  add constraint institutions_temporary_access_window_valid
  check (temporary_access_start_time < temporary_access_cutoff_time);

-- 2. set_temporary_access_start_time() -- mirrors set_temporary_access_
-- cutoff()'s own shape exactly: principal-only, validated against the
-- INSTITUTION'S OWN current cutoff (not a fixed literal, the same way
-- the cutoff RPC below now validates against the institution's own
-- current start time instead of a fixed '07:30').

create or replace function public.set_temporary_access_start_time(
  p_institution_id uuid,
  p_start_time time
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_cutoff time;
begin
  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) then
    raise exception 'Only an active principal at this institution can set the start time.';
  end if;

  select temporary_access_cutoff_time into v_current_cutoff
  from public.institutions where id = p_institution_id;

  if p_start_time is null or p_start_time >= v_current_cutoff then
    raise exception 'The start time must be earlier than the cut-off time (%).', v_current_cutoff;
  end if;

  update public.institutions
  set temporary_access_start_time = p_start_time
  where id = p_institution_id;
end;
$$;

grant execute on function public.set_temporary_access_start_time(uuid, time) to authenticated;

-- 3. set_temporary_access_cutoff() -- CREATE OR REPLACE, same signature,
-- re-created here only to swap its fixed '07:30' guard for the
-- institution's own current start time. Nothing else about it changes.

create or replace function public.set_temporary_access_cutoff(
  p_institution_id uuid,
  p_cutoff_time time
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_start time;
begin
  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) then
    raise exception 'Only an active principal at this institution can set the cut-off time.';
  end if;

  select temporary_access_start_time into v_current_start
  from public.institutions where id = p_institution_id;

  if p_cutoff_time is null or p_cutoff_time <= v_current_start then
    raise exception 'The cut-off must be later than the start time (%).', v_current_start;
  end if;

  update public.institutions
  set temporary_access_cutoff_time = p_cutoff_time
  where id = p_institution_id;
end;
$$;

grant execute on function public.set_temporary_access_cutoff(uuid, time) to authenticated;

-- 4. has_active_temporary_grant() -- CREATE OR REPLACE, same signature.
-- Only change: '07:30'::time -> inst.temporary_access_start_time.

create or replace function public.has_active_temporary_grant(
  p_user_id uuid,
  p_institution_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.temporary_access ta
    join public.institutions inst on inst.id = ta.institution_id
    where ta.granted_to = p_user_id
      and ta.institution_id = p_institution_id
      and ta.revoked_at is null
      and ta.granted_for_date = (now() at time zone public.app_local_timezone())::date
      and (now() at time zone public.app_local_timezone())::time >= inst.temporary_access_start_time
      and (now() at time zone public.app_local_timezone())::time < inst.temporary_access_cutoff_time
  );
$$;

grant execute on function public.has_active_temporary_grant(uuid, uuid) to authenticated;

-- 5. has_sna_access() -- CREATE OR REPLACE, same signature. Re-created
-- from its LIVE body (0129, which added the class_sna_assignments
-- branch over 0105's original three) -- not 0105's superseded version.
-- Only change: the third branch's '07:30'::time -> inst.temporary_
-- access_start_time. The fourth (class_sna_assignments) branch has no
-- time window at all -- permanent assignment, untouched.

create or replace function public.has_sna_access(
  p_user_id uuid,
  p_passport_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (
      select 1 from public.passport_access pa
      where pa.passport_id = p_passport_id
        and pa.teacher_id = p_user_id
        and pa.is_active = true
        and pa.actor_role = 'sna'
    )
    or exists (
      select 1
      from public.child_assignments ca
      join public.institution_staff s on s.user_id = ca.user_id and s.institution_id = ca.institution_id
      where ca.passport_id = p_passport_id
        and ca.user_id = p_user_id
        and ca.ended_at is null
        and s.deactivated_at is null
        and s.approved_at is not null
    )
    or exists (
      select 1
      from public.temporary_access ta
      join public.class_children cc on cc.class_id = ta.class_id
      join public.institutions inst on inst.id = ta.institution_id
      join public.institution_staff s on s.user_id = ta.granted_to and s.institution_id = ta.institution_id
      where cc.passport_id = p_passport_id
        and cc.ended_at is null
        and ta.granted_to = p_user_id
        and ta.access_tier = 'sna'
        and ta.revoked_at is null
        and ta.granted_for_date = (now() at time zone public.app_local_timezone())::date
        and (now() at time zone public.app_local_timezone())::time >= inst.temporary_access_start_time
        and (now() at time zone public.app_local_timezone())::time < inst.temporary_access_cutoff_time
        and s.deactivated_at is null
        and s.approved_at is not null
    )
    or exists (
      select 1
      from public.class_children cc
      join public.classes c on c.id = cc.class_id
      join public.class_sna_assignments csa on csa.class_id = c.id
      join public.institution_staff s on s.user_id = csa.user_id and s.institution_id = c.institution_id
      where cc.passport_id = p_passport_id
        and cc.ended_at is null
        and csa.user_id = p_user_id
        and csa.ended_at is null
        and s.deactivated_at is null
        and s.approved_at is not null
    );
$$;

grant execute on function public.has_sna_access(uuid, uuid) to authenticated;

-- 6. get_temporary_access_covered_children() -- CREATE OR REPLACE, same
-- signature. Only change: '07:30'::time -> inst.temporary_access_start_
-- time.

create or replace function public.get_temporary_access_covered_children(p_class_id uuid)
returns table (
  passport_id uuid,
  child_name text,
  diagnoses text[],
  diagnosis_other text
)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.child_name, p.diagnoses, p.diagnosis_other
  from public.class_children cc
  join public.passports p on p.id = cc.passport_id
  join public.temporary_access ta on ta.class_id = cc.class_id
  join public.institutions inst on inst.id = ta.institution_id
  where cc.class_id = p_class_id
    and cc.ended_at is null
    and ta.class_id = p_class_id
    and ta.granted_to = auth.uid()
    and ta.revoked_at is null
    and ta.granted_for_date = (now() at time zone public.app_local_timezone())::date
    and (now() at time zone public.app_local_timezone())::time >= inst.temporary_access_start_time
    and (now() at time zone public.app_local_timezone())::time < inst.temporary_access_cutoff_time;
$$;

grant execute on function public.get_temporary_access_covered_children(uuid) to authenticated;

-- 7. get_institution_temporary_access() -- CREATE OR REPLACE, same
-- signature. Only change: is_currently_active's '07:30'::time -> inst.
-- temporary_access_start_time.

create or replace function public.get_institution_temporary_access(
  p_institution_id uuid,
  p_days_back integer default 30
)
returns table (
  grant_id uuid,
  class_id uuid,
  class_name text,
  granted_to uuid,
  granted_to_name text,
  granted_by uuid,
  granted_by_name text,
  granted_by_role text,
  access_tier text,
  granted_for_date date,
  reason text,
  created_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_by_name text,
  revocation_reason text,
  is_currently_active boolean
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
    coalesce(gt.raw_user_meta_data ->> 'full_name', gt.raw_app_meta_data ->> 'full_name') as granted_to_name,
    t.granted_by,
    coalesce(gb.raw_user_meta_data ->> 'full_name', gb.raw_app_meta_data ->> 'full_name') as granted_by_name,
    t.granted_by_role,
    t.access_tier,
    t.granted_for_date,
    t.reason,
    t.created_at,
    t.revoked_at,
    t.revoked_by,
    coalesce(rb.raw_user_meta_data ->> 'full_name', rb.raw_app_meta_data ->> 'full_name') as revoked_by_name,
    t.revocation_reason,
    (
      t.revoked_at is null
      and t.granted_for_date = (now() at time zone public.app_local_timezone())::date
      and (now() at time zone public.app_local_timezone())::time >= inst.temporary_access_start_time
      and (now() at time zone public.app_local_timezone())::time < inst.temporary_access_cutoff_time
    ) as is_currently_active
  from public.temporary_access t
  join public.classes c on c.id = t.class_id
  join public.institutions inst on inst.id = t.institution_id
  join auth.users gt on gt.id = t.granted_to
  join auth.users gb on gb.id = t.granted_by
  left join auth.users rb on rb.id = t.revoked_by
  where t.institution_id = p_institution_id
    and (
      t.revoked_at is null
      or t.granted_for_date >= (now() at time zone public.app_local_timezone())::date - p_days_back
    )
    and public.institution_staff_has_current_standing(auth.uid(), p_institution_id)
  order by t.granted_for_date desc, t.created_at desc;
$$;

grant execute on function public.get_institution_temporary_access(uuid, integer) to authenticated;
