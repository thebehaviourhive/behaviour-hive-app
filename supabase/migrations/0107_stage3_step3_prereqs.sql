-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 1, Stage 3, Step 3 prerequisites. Found while wiring the client
-- code, before writing any of it -- two real gaps in 0105's own SQL,
-- and one genuinely new field the principal's incident queue needs
-- that no existing RPC exposes.

-- =====================================================================
-- 1. resolve_lapsed_incident_ownership() had NO caller-authorization
-- check at all. Any authenticated user could call it for ANY
-- p_institution_id and trigger real ownership transfers there, with
-- zero relationship to that institution -- it only ever looked up "the"
-- principal at the given institution_id and acted, never checked who
-- was asking. Found while deciding where in the client to call this
-- from: the incident detail page is shared across every role, so it
-- had to be safe to call from any signed-in viewer's session -- which
-- surfaced that it was never safe for ANYONE to call, related or not.
--
-- Fixed: restricted to active, approved institution_staff at that
-- institution -- not principal-only. The action itself is safe for any
-- genuine member of that institution to trigger (it grants the caller
-- nothing; it only corrects stale ownership to point at the real
-- principal), but must exclude a stranger. Everything else in this
-- function is byte-identical to its 0105 body.
-- =====================================================================

create or replace function public.resolve_lapsed_incident_ownership(p_institution_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_principal_id uuid;
  v_resolved integer := 0;
  v_incident record;
begin
  if not exists (
    select 1 from public.institution_staff s
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.deactivated_at is null
      and s.approved_at is not null
  ) then
    raise exception 'Only active staff at this institution can resolve incident ownership here.';
  end if;

  select user_id into v_principal_id
  from public.institution_staff
  where institution_id = p_institution_id
    and role = 'principal'
    and deactivated_at is null
    and approved_at is not null
  limit 1;

  if v_principal_id is null then
    return 0;
  end if;

  for v_incident in
    select distinct i.id, i.owning_teacher_id
    from public.incidents i
    join public.incident_children ic on ic.incident_id = i.id
    where i.institution_id = p_institution_id
      and i.teacher_signed_at is null
      and i.owning_teacher_id is not null
      and i.owning_teacher_id <> v_principal_id
      and not public.can_own_incident(i.owning_teacher_id, p_institution_id)
  loop
    update public.incidents set owning_teacher_id = v_principal_id where id = v_incident.id;

    insert into public.incident_ownership_transfers (incident_id, from_teacher_id, to_principal_id, reason)
    values (v_incident.id, v_incident.owning_teacher_id, v_principal_id, 'Temporary access ended before this incident was signed off.');

    v_resolved := v_resolved + 1;
  end loop;

  return v_resolved;
end;
$$;

grant execute on function public.resolve_lapsed_incident_ownership(uuid) to authenticated;

-- =====================================================================
-- 2. can_own_incident() never recognised a PRINCIPAL as eligible --
-- only role='class_teacher' or an active temporary grant. This means
-- once resolve_lapsed_incident_ownership() transfers an incident to the
-- principal, the principal themselves could not satisfy "Owning teacher
-- can edit before teacher sign-off" (which requires can_own_incident())
-- -- they'd receive ownership of an incident they could neither edit
-- nor sign off, defeating the entire point of the transfer. Caught by
-- reasoning through the end-to-end flow while planning the UI, not by
-- the adversarial suite -- AA-8's own checks proved the TRANSFER
-- RECORD was created correctly but never asked whether the recipient
-- could subsequently act on it. A coverage gap, not a wrong-reason
-- pass, per CLAUDE.md's own distinction -- named as such, not
-- conflated with the has_child_access() overreach two migrations ago.
--
-- Fixed: an active, approved principal at the institution is now a
-- third eligible branch. This also means a principal who creates an
-- incident themselves now auto-owns it too (create_incident_stamp()'s
-- assignment is keyed off this same function) -- previously, matching
-- 0069's own original behaviour, a principal creator got owning_
-- teacher_id = null, the same as an SNA. A deliberate, connected
-- consequence of the same fix, not a separate decision -- a principal
-- editing their own draft incident pre-signoff is the same class of
-- case this whole function exists to allow, and there is no reason a
-- principal specifically should be the one role excluded from it.
-- =====================================================================

create or replace function public.can_own_incident(
  p_user_id uuid,
  p_institution_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = p_institution_id
        and s.user_id = p_user_id
        and s.role in ('class_teacher', 'principal')
        and s.deactivated_at is null
        and s.approved_at is not null
    )
    or public.has_active_temporary_grant(p_user_id, p_institution_id);
$$;

grant execute on function public.can_own_incident(uuid, uuid) to authenticated;

-- =====================================================================
-- 3. get_institution_incidents() -- extended with the fields the
-- principal's incident queue needs to show an inherited incident as
-- visibly inherited, not silently theirs: who created it, and (via a
-- LEFT JOIN to incident_ownership_transfers) who it transferred from
-- and when. is_inherited is simply "does a transfer row exist for this
-- incident" -- there is at most one per incident by construction
-- (resolve_lapsed_incident_ownership() only ever transfers TO the
-- institution's principal, and once there, can_own_incident() is now
-- permanently true for them via the principal branch above, so the
-- same incident can never lapse and re-transfer a second time). Every
-- other line of this function, including its own caller-authorization
-- EXISTS clause, is unchanged, verbatim from its live (0068) body.
-- =====================================================================

-- CREATE OR REPLACE cannot change a RETURNS TABLE column list -- the
-- exact same rule this codebase already hit in 0067, 0075, 0078, and
-- 0099/0100. Drop first, then recreate with the widened return shape.
--
-- REPRODUCED FROM THE ACTUAL LIVE BODY, RE-VERIFIED AFTER GETTING IT
-- WRONG ONCE: my first draft of this section was written from memory
-- of reading 0068 earlier in this session, not from a fresh read right
-- before writing it -- CLAUDE.md's own standing rule, broken and then
-- immediately re-caught. Two real errors that produced: (1)
-- principal_signed_at, renamed to countersigned_at by 0075, three
-- migrations before this one; (2) the caller-authorization clause,
-- narrowed back to 0068's own inline role='principal' EXISTS check,
-- when 0078 later widened it to can_countersign_incident() (principal
-- OR a delegated countersign permission via institution_permissions).
-- A grep for "create or replace function public.get_institution_
-- incidents" alone missed BOTH later redefinitions, because 0075 and
-- 0078 both use plain "create function" (matching their own DROP-first
-- requirement) -- re-run as "function public.get_institution_incidents"
-- without the "or replace" qualifier, which is what actually found
-- 0078 as the true live definition. Everything below this point now
-- matches 0078's live body exactly, with only the four new columns and
-- their two LEFT JOINs added on top.
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
  ncse_report_complete boolean[],
  created_by_name text,
  is_inherited boolean,
  inherited_from_name text,
  inherited_transferred_at timestamptz
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
    (select array_agg(rp.ncse_report_complete) from public.restrictive_practices rp where rp.incident_id = i.id) as ncse_report_complete,
    coalesce(creator.raw_user_meta_data ->> 'full_name', creator.raw_app_meta_data ->> 'full_name') as created_by_name,
    (iot.id is not null) as is_inherited,
    coalesce(from_teacher.raw_user_meta_data ->> 'full_name', from_teacher.raw_app_meta_data ->> 'full_name') as inherited_from_name,
    iot.transferred_at as inherited_transferred_at
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
