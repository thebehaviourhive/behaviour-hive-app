-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 1, Stage 4, Step 2: the institution-side passport_access write
-- path. Named before written, per instruction, so the RPCs are designed
-- against a real destination rather than a guess:
--
-- THE SCREEN: /principal/passports (list) and /principal/passports/
-- [passportId] (detail) -- a new pair, mirroring the established
-- /principal/classes + /principal/classes/[classId] split, client code
-- for a LATER step. The list page needs no new RPC at all -- it's
-- get_institution_child_roster() (0074/0100, already confirmed correct
-- and unchanged in Step 1), same as every other principal roster
-- screen. The detail page needs three things this migration provides:
-- grant, revoke, and a read of one child's current + past access, so it
-- can show an active/past split client-side the same way /teacher/class
-- and /principal/classes/[classId] already do for temporary cover
-- (Stage 3, CHECK BB's own proven pattern). Staff-picking for the grant
-- sheet reuses get_institution_staff_roster() (0074/0097), already
-- existing.
--
-- AUTHORIZATION MODEL, deliberately narrow: an active, approved
-- principal at p_institution_id, institution status = 'verified' --
-- identical shape to every other principal-only RPC in this schema
-- (add_class_child, assign_sna_to_child, grant_temporary_access). The
-- grant itself requires THREE things, all independently checked: (1)
-- the principal's own standing, (2) the RECIPIENT's own active,
-- approved institution_staff row at the SAME institution, role in
-- ('class_teacher', 'sna') -- actor_role is DERIVED from this, not
-- taken as a caller-supplied parameter, so a principal can't misdeclare
-- someone's tier, and (3) a passport_institution_links row must EXIST
-- for (passport, institution) -- Stage 4 Step 0's own decision 4:
-- existence, not approval, is the interim boundary until Stage 6's
-- enrolment exists to do the job properly. Revoke is scoped to the
-- principal's own institution via the target row's own institution_id,
-- not passport-wide -- a principal cannot revoke another institution's
-- grant just because they can name its id.
--
-- REACTIVATION IS SCOPED TO THE SAME INSTITUTION -- caught in review,
-- not shipped: passport_access_passport_teacher_unique is (passport_id,
-- teacher_id) ONLY, no institution_id, a shape inherited from when
-- every row was self-service and one person could only ever hold one
-- institution's worth of standing over a child in practice. Now that
-- two institutions can genuinely both hold a link to the same child
-- (proven live, Step 1's own CHECK DD), the naive version of this
-- function -- match on (passport_id, teacher_id), reactivate, and set
-- institution_id = p_institution_id -- would silently RELOCATE a
-- revoked grant out from under a different institution's own history
-- the moment a second institution ever granted the same person access
-- to the same child: that institution's own granted_by/revoked_at/
-- revocation_reason overwritten, not just superseded. Refused instead,
-- deliberately: a grant at another institution is not this principal's
-- to reactivate. If the existing row's institution_id doesn't match
-- p_institution_id, this function raises rather than reactivating.
--
-- SCHEMA: passport_access gains granted_by, revoked_by, revoked_at,
-- revocation_reason -- the same audit shape temporary_access (0105) has
-- and passport_access never did, because until now every row was
-- self-evidently "granted by the person it names" (teacher_id ==
-- granter). granted_by defaults to auth.uid() at the COLUMN level, not
-- via a trigger or a policy change -- this means the untouched
-- self-service INSERT/reactivate policies (Stage 4 Step 1's own
-- decision 1, still deliberately unmodified) get it filled in
-- automatically and correctly (a self-grant's auth.uid() IS teacher_id,
-- enforced by that policy's own WITH CHECK, unrelated to anything in
-- this migration) without touching those two policies at all. Existing
-- rows are backfilled to granted_by = teacher_id, the same true fact.

-- =====================================================================
-- 1. passport_access -- new audit columns.
-- =====================================================================

alter table public.passport_access
  add column if not exists granted_by uuid references auth.users (id) default auth.uid(),
  add column if not exists revoked_by uuid references auth.users (id),
  add column if not exists revoked_at timestamptz,
  add column if not exists revocation_reason text;

update public.passport_access
set granted_by = teacher_id
where granted_by is null;

-- =====================================================================
-- 2. grant_passport_access() -- the write path itself.
-- =====================================================================

create or replace function public.grant_passport_access(
  p_passport_id uuid,
  p_user_id uuid,
  p_institution_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_existing_id uuid;
  v_existing_active boolean;
  v_existing_institution_id uuid;
  v_row_id uuid;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required.';
  end if;

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
    raise exception 'Only an active principal at this institution can grant passport access.';
  end if;

  -- actor_role is DERIVED, never caller-supplied -- matches the
  -- recipient's own current institution_staff.role, the same way a
  -- self-service grant's actor_role has always matched the granter's
  -- own role. institution_admin/principal are deliberately excluded
  -- (passport_access has never represented either).
  select role into v_actor_role
  from public.institution_staff
  where institution_id = p_institution_id
    and user_id = p_user_id
    and deactivated_at is null
    and approved_at is not null;

  if v_actor_role is null then
    raise exception 'This person is not an active member of this institution.';
  end if;

  if v_actor_role not in ('class_teacher', 'sna') then
    raise exception 'Passport access can only be granted to a class teacher or SNA.';
  end if;

  if not exists (
    select 1 from public.passport_institution_links pil
    where pil.passport_id = p_passport_id
      and pil.institution_id = p_institution_id
  ) then
    raise exception 'This child has no link to your institution.';
  end if;

  select id, is_active, institution_id into v_existing_id, v_existing_active, v_existing_institution_id
  from public.passport_access
  where passport_id = p_passport_id and teacher_id = p_user_id;

  if v_existing_id is not null and v_existing_active then
    raise exception 'This person already has active passport access to this child.';
  end if;

  -- passport_access_passport_teacher_unique is (passport_id, teacher_id)
  -- ONLY -- it says nothing about institution_id, a shape nobody chose
  -- for this case, just inherited from when passport_access was purely
  -- self-service and a person could only ever hold one institution's
  -- worth of standing over a child at a time in practice. Now that two
  -- institutions can genuinely both hold a link to the same child
  -- (proven live, Step 1's own CHECK DD), a revoked row from a
  -- DIFFERENT institution must never be silently reactivated AND
  -- relocated out from under its own history -- refuse instead. A grant
  -- at another institution is not this principal's to reactivate.
  if v_existing_id is not null and v_existing_institution_id <> p_institution_id then
    raise exception 'This person has a revoked passport access grant for this child at a different institution. It cannot be reactivated here.';
  end if;

  if v_existing_id is not null then
    -- Reactivating a previously-revoked row (self-revoked, parent-
    -- revoked, or principal-revoked) at the SAME institution, rather
    -- than inserting a duplicate the unique constraint would refuse
    -- anyway -- same reasoning as the existing "Teachers can reactivate
    -- their own revoked access" policy this mirrors for the
    -- principal-initiated case.
    update public.passport_access
    set is_active = true,
        actor_role = v_actor_role,
        linked_at = now(),
        granted_by = auth.uid(),
        revoked_at = null,
        revoked_by = null,
        revocation_reason = null
    where id = v_existing_id
    returning id into v_row_id;
  else
    insert into public.passport_access (
      passport_id, teacher_id, institution_id, actor_role, is_active, granted_by
    ) values (
      p_passport_id, p_user_id, p_institution_id, v_actor_role, true, auth.uid()
    )
    returning id into v_row_id;
  end if;

  return v_row_id;
end;
$$;

grant execute on function public.grant_passport_access(uuid, uuid, uuid, text) to authenticated;

-- =====================================================================
-- 3. revoke_passport_access() -- works on ANY active row at the
--    principal's own institution, not just ones they personally
--    granted -- "revoke for children enrolled at their institution"
--    (Step 0's own wording) covers a self-service grant too, the same
--    way a principal can already deactivate a staff member regardless
--    of who approved their join.
-- =====================================================================

create or replace function public.revoke_passport_access(
  p_passport_access_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.passport_access;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required.';
  end if;

  select * into v_row from public.passport_access where id = p_passport_access_id;
  if not found then
    raise exception 'Grant not found.';
  end if;

  if not v_row.is_active then
    raise exception 'This access has already been revoked.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = v_row.institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) then
    raise exception 'Only an active principal at this institution can revoke passport access.';
  end if;

  update public.passport_access
  set is_active = false,
      revoked_at = now(),
      revoked_by = auth.uid(),
      revocation_reason = p_reason
  where id = p_passport_access_id;
end;
$$;

grant execute on function public.revoke_passport_access(uuid, text) to authenticated;

-- =====================================================================
-- 4. get_passport_access_for_child() -- feeds /principal/passports/
--    [passportId]'s own active/past split, client-side, the same
--    pattern CHECK BB already proved for temporary cover (Stage 3).
--    Returns every row, active and revoked -- the split is the
--    client's job, not this RPC's, matching the established precedent.
-- =====================================================================

create or replace function public.get_passport_access_for_child(
  p_passport_id uuid,
  p_institution_id uuid
)
returns table (
  id uuid,
  user_id uuid,
  full_name text,
  actor_role text,
  is_active boolean,
  linked_at timestamptz,
  granted_by uuid,
  granted_by_name text,
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_by_name text,
  revocation_reason text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    pa.id,
    pa.teacher_id as user_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    pa.actor_role,
    pa.is_active,
    pa.linked_at,
    pa.granted_by,
    coalesce(gu.raw_user_meta_data ->> 'full_name', gu.raw_app_meta_data ->> 'full_name') as granted_by_name,
    pa.revoked_at,
    pa.revoked_by,
    coalesce(ru.raw_user_meta_data ->> 'full_name', ru.raw_app_meta_data ->> 'full_name') as revoked_by_name,
    pa.revocation_reason
  from public.passport_access pa
  join auth.users u on u.id = pa.teacher_id
  left join auth.users gu on gu.id = pa.granted_by
  left join auth.users ru on ru.id = pa.revoked_by
  where pa.passport_id = p_passport_id
    and pa.institution_id = p_institution_id
    and exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and s.deactivated_at is null
        and s.approved_at is not null
        and inst.status = 'verified'
    )
  order by pa.linked_at desc;
$$;

grant execute on function public.get_passport_access_for_child(uuid, uuid) to authenticated;
