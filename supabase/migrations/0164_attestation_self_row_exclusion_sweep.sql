-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- "AN AUTHOR HAS NOTHING TO ATTEST TO" (0149) WAS ONLY EVER APPLIED TO
-- build_staff_attestations_summary(). Found sweeping every other
-- function that reads incident_staff + get_attestation_status() after
-- a teacher reported a "not attested attestation" card on the teacher
-- dashboard for their OWN incident -- the same shape 0149 fixed, on a
-- different function 0149 never touched. get_my_incident_attestations()
-- is its own, independent query (not built on
-- build_staff_attestations_summary() at all), so 0149's fix never
-- reached it. Three more functions have the identical gap, found by
-- grepping every consumer of get_attestation_status()/incident_staff,
-- per CLAUDE.md's own standing rule to sweep for the same shape rather
-- than fix the one reported instance and stop.
--
-- 1. get_my_incident_attestations() -- powers BOTH the teacher
--    dashboard's "owed" bucket (src/app/teacher/dashboard/page.tsx) and
--    the full attestations list (src/app/teacher/incidents/attestations
--    /page.tsx). Reads incident_staff filtered only on
--    st.user_id = auth.uid() -- when a teacher self-selects onto their
--    own incident's staff list at creation (the default -- see
--    src/app/teacher/incidents/new/page.tsx's own pre-selection), their
--    own row status defaults to 'not_attested' the instant the incident
--    exists, with nothing to attest to and no way it could ever become
--    anything else through the normal flow. Fixed with the exact
--    exclusion 0149 already established: i.owning_teacher_id is
--    distinct from st.user_id.
--
-- 2. get_my_incident_attestation_issues() -- the dashboard's "stale or
--    withdrawn attestations on incidents I own" bucket. Narrower
--    exposure (only reachable if the owning teacher's own row somehow
--    reaches 'stale'/'withdrawn', not merely 'not_attested'), same
--    missing exclusion. See item 4 below for why this was reachable at
--    all before this migration.
--
-- 3. get_staff_deactivation_preview()'s own outstanding_attestations
--    list (the principal's "leaving checklist", DeactivateStaffSheet.tsx)
--    -- if the departing teacher is the owning teacher of their own
--    incident and self-named as staff on it (the same default), this
--    preview would count that incident as "an attestation outstanding
--    against them" and could flip leavesNothingBehind to false for a
--    departure that genuinely leaves nothing behind. Same exclusion,
--    scoped to the target row instead of auth.uid().
--
-- 4. attest_to_incident() itself had NO server-side guard against an
--    owning teacher attesting to their own incident_staff row --
--    AttestationCard already hides the button for this case
--    client-side (0149's own comment says so), but nothing stopped a
--    direct RPC call from creating a real 'attested' event anyway,
--    which could later go 'stale' or 'withdrawn' -- the exact state
--    item 2 above is coverage for. Closing this is what makes items 1-3
--    a complete fix rather than three patches over a hole that's still
--    open: without this, a self-attested row could still reach 'stale'
--    and surface through get_my_incident_attestation_issues() (fixed in
--    item 2, but the underlying possibility would remain). Refused with
--    the same framing as 0149's own header comment: an author has
--    nothing to attest to.
--
-- Every CREATE OR REPLACE below is copied verbatim from its current
-- live definition with only the one exclusion (items 1-3) or one new
-- guard clause (item 4) added -- no other behavior changes. No
-- RETURNS TABLE shape changes anywhere, so CREATE OR REPLACE is
-- sufficient throughout.

-- ---------------------------------------------------------------------
-- 1. get_my_incident_attestations() (live definition: 0088)
-- ---------------------------------------------------------------------
create or replace function public.get_my_incident_attestations()
returns table (
  incident_id uuid,
  incident_staff_id uuid,
  occurred_at timestamptz,
  location text,
  status text,
  status_label text,
  stale_categories text[],
  is_closed boolean
)
language plpgsql
stable
as $$
begin
  return query
  select
    i.id as incident_id,
    st.id as incident_staff_id,
    i.occurred_at,
    loc.value as location,
    public.get_attestation_status(st.id) as status,
    case public.get_attestation_status(st.id)
      when 'current' then 'Current'
      when 'stale' then 'Stale'
      when 'withdrawn' then 'Withdrawn'
      when 'not_attested' then 'Not attested'
      else initcap(replace(public.get_attestation_status(st.id), '_', ' '))
    end as status_label,
    case
      when public.get_attestation_status(st.id) = 'stale' then public.get_stale_categories(st.id)
      else null
    end as stale_categories,
    i.teacher_signed_at is not null as is_closed
  from public.incident_staff st
  join public.incidents i on i.id = st.incident_id
  join public.incident_locations loc on loc.id = i.location_id
  where st.user_id = auth.uid()
    and st.user_id is distinct from i.owning_teacher_id
  order by i.occurred_at desc;
end;
$$;

grant execute on function public.get_my_incident_attestations() to authenticated;

-- ---------------------------------------------------------------------
-- 2. get_my_incident_attestation_issues() (live definition: 0137)
-- ---------------------------------------------------------------------
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
    and st.user_id is distinct from i.owning_teacher_id
    and public.institution_staff_has_current_standing(auth.uid(), i.institution_id)
    and public.get_attestation_status(st.id) in ('withdrawn', 'stale')
  order by i.occurred_at desc;
$$;

grant execute on function public.get_my_incident_attestation_issues() to authenticated;

-- ---------------------------------------------------------------------
-- 3. get_staff_deactivation_preview() (live definition: 0100)
-- ---------------------------------------------------------------------
create or replace function public.get_staff_deactivation_preview(p_institution_staff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.institution_staff;
  v_caller_is_active_principal boolean;
  v_unsigned_incidents jsonb;
  v_outstanding_attestations jsonb;
  v_active_children jsonb;
begin
  select * into v_target from public.institution_staff where id = p_institution_staff_id;
  if not found then
    raise exception 'Staff member not found.';
  end if;

  select exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.user_id = auth.uid()
      and s.institution_id = v_target.institution_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) into v_caller_is_active_principal;

  if not v_caller_is_active_principal then
    raise exception 'Only an active principal at this institution can preview this.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'incident_id', i.id, 'occurred_at', i.occurred_at, 'status', i.status
  ) order by i.occurred_at), '[]'::jsonb)
  into v_unsigned_incidents
  from public.incidents i
  where i.institution_id = v_target.institution_id
    and i.owning_teacher_id = v_target.user_id
    and i.teacher_signed_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'incident_id', i.id, 'occurred_at', i.occurred_at
  ) order by i.occurred_at), '[]'::jsonb)
  into v_outstanding_attestations
  from public.incident_staff st
  join public.incidents i on i.id = st.incident_id
  where i.institution_id = v_target.institution_id
    and st.user_id = v_target.user_id
    and st.user_id is distinct from i.owning_teacher_id
    and public.get_attestation_status(st.id) = 'not_attested';

  select coalesce(jsonb_agg(jsonb_build_object(
    'passport_id', p.id, 'child_name', p.child_name
  ) order by p.child_name), '[]'::jsonb)
  into v_active_children
  from public.passport_access pa
  join public.passports p on p.id = pa.passport_id
  where pa.institution_id = v_target.institution_id
    and pa.teacher_id = v_target.user_id
    and pa.is_active = true;

  return jsonb_build_object(
    'unsigned_incidents', v_unsigned_incidents,
    'outstanding_attestations', v_outstanding_attestations,
    'active_children', v_active_children
  );
end;
$$;

grant execute on function public.get_staff_deactivation_preview(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. attest_to_incident() (live definition: 0088) -- ONE new guard
--    clause, everything else unchanged.
-- ---------------------------------------------------------------------
create or replace function public.attest_to_incident(p_incident_staff_id uuid, p_addendum text default null::text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_incident_id uuid;
  v_attestation_id uuid;
  v_owning_teacher_id uuid;
begin
  select st.incident_id, i.owning_teacher_id
  into v_incident_id, v_owning_teacher_id
  from public.incident_staff st
  join public.incidents i on i.id = st.incident_id
  where st.id = p_incident_staff_id
    and st.user_id = auth.uid()
    and i.teacher_signed_at is null;

  if v_incident_id is null then
    raise exception 'You cannot attest to this incident -- you may not be the named staff member, or it may already be signed off.';
  end if;

  -- NEW: an author has nothing to attest to (0149's own framing). The
  -- client already hides this action for the incident's own owning
  -- teacher; this closes the same gap at the data layer so a direct
  -- RPC call can't create a self-attestation the rest of the app then
  -- has to treat as meaningful.
  if v_owning_teacher_id is not null and v_owning_teacher_id = auth.uid() then
    raise exception 'You own this incident -- there is nothing for you to attest to on your own record.';
  end if;

  insert into public.incident_attestations (incident_id, incident_staff_id, action, content_hash, category_hashes, addendum, created_by)
  values (
    v_incident_id,
    p_incident_staff_id,
    'attested',
    public.compute_incident_content_hash(v_incident_id),
    public.compute_incident_category_hashes(v_incident_id),
    p_addendum,
    auth.uid()
  )
  returning id into v_attestation_id;

  return v_attestation_id;
end;
$function$;

grant execute on function public.attest_to_incident(uuid, text) to authenticated;
