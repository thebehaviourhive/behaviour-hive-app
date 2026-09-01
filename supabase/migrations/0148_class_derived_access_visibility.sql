-- Class-derived access: visible on the roster, visible to the
-- principal, and no longer stackable with a redundant manual grant.
--
-- CONTEXT: has_class_teacher_access() (0104, widened 0130) has always
-- correctly granted RLS-level access via class_children/class_teachers/
-- class_sna_assignments -- confirmed live, empirically, before this
-- migration was written (a real fixture: class, teacher, child, zero
-- passport_access rows -- passport SELECT, class roster SELECT, an ABC
-- log INSERT, a teacher_update INSERT, and get_todays_checkins_for_
-- passports() all worked as that teacher's own session). The database
-- was never the problem.
--
-- Two client surfaces never asked the database that question, and both
-- are fixed in the client pass this migration precedes, not here:
--   1. useTeacherPassports.ts queries passport_access directly, with no
--      class-membership branch at all -- the shared source for five
--      surfaces (Students, dashboard, ABC log picker, messages, and via
--      useTeacherMorningCheckins, the morning grid and morning-updates
--      page). get_my_accessible_children() below replaces its query.
--   2. teacher/passport/[passportId]/page.tsx's own inline access guard
--      -- a second, separate instance of the identical pattern. Being
--      deleted outright in the client pass, not fixed: .maybeSingle()
--      on passports already returns null correctly via RLS for someone
--      with no access; the guard was redundant AND wrong.
--
-- The more serious finding: the principal's own Access tab
-- (get_passport_access_for_child()) has ALWAYS read passport_access
-- only -- it has no idea class_children/class_teachers/
-- class_sna_assignments exist, so it cannot tell a principal "this
-- person already has access via their class" from "this person has no
-- access at all". grant_passport_access()'s own duplicate guard has the
-- identical blind spot. The result: a principal grants defensively on
-- top of already-working class access, the manual grant and the class
-- assignment become two independent sources of the same access, and
-- removing the child from the class -- which correctly ends the class-
-- derived half -- leaves the manual grant standing, unrevoked, forever.
-- "Remove the child from the class and access ends" is false whenever
-- this has happened, silently, and nothing before this migration could
-- even show a principal that it had.
--
-- =====================================================================
-- 1. resolve_class_derived_access() -- given a child, list everyone who
-- has access to them via class membership (teacher or class-tier SNA),
-- optionally narrowed to one user and/or one institution. The single
-- chokepoint for "who has derived access to THIS child" -- used by both
-- get_passport_access_for_child() (no user filter -- everyone) and
-- grant_passport_access()'s new guard (filtered to the one person about
-- to be granted). Its own two branches are copied from has_class_
-- teacher_access()'s (0130) two class-derived branches exactly -- if
-- that function's join shape ever changes, this one and get_my_
-- accessible_children() below (which needed its own copy for a
-- genuinely different query direction -- see its own comment) both need
-- the same change. Grep for "class_sna_assignments csa on csa.class_id"
-- to find all three at once.
-- =====================================================================

create or replace function public.resolve_class_derived_access(
  p_passport_id uuid,
  p_user_id uuid default null,
  p_institution_id uuid default null
)
returns table (
  id uuid,
  user_id uuid,
  source text,
  source_detail text,
  linked_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    ct.id,
    ct.user_id,
    'class_teacher'::text as source,
    c.name as source_detail,
    ct.started_at as linked_at
  from public.class_children cc
  join public.classes c on c.id = cc.class_id
  join public.class_teachers ct on ct.class_id = c.id
  join public.institution_staff s on s.user_id = ct.user_id and s.institution_id = c.institution_id
  where cc.passport_id = p_passport_id
    and cc.ended_at is null
    and ct.ended_at is null
    and s.deactivated_at is null
    and s.approved_at is not null
    and (p_user_id is null or ct.user_id = p_user_id)
    and (p_institution_id is null or c.institution_id = p_institution_id)
  union all
  select
    csa.id,
    csa.user_id,
    'class_sna'::text as source,
    c.name as source_detail,
    csa.started_at as linked_at
  from public.class_children cc
  join public.classes c on c.id = cc.class_id
  join public.class_sna_assignments csa on csa.class_id = c.id
  join public.institution_staff s on s.user_id = csa.user_id and s.institution_id = c.institution_id
  where cc.passport_id = p_passport_id
    and cc.ended_at is null
    and csa.ended_at is null
    and s.deactivated_at is null
    and s.approved_at is not null
    and (p_user_id is null or csa.user_id = p_user_id)
    and (p_institution_id is null or c.institution_id = p_institution_id);
$$;

grant execute on function public.resolve_class_derived_access(uuid, uuid, uuid) to authenticated;


-- =====================================================================
-- 2. get_my_accessible_children() -- replaces useTeacherPassports.ts's
-- own raw passport_access query (client pass, not here). Every child
-- reachable via ANY source -- direct grant, class-teacher membership,
-- class-tier SNA assignment -- one row per child, tagged with which
-- source it came from and, for derived access, which class.
--
-- Own copy of the two class-derived branches, not a call to resolve_
-- class_derived_access() above -- that function fans out from ONE
-- passport to many users; this one fans out from one user (auth.uid())
-- to many passports. Genuinely different query directions, not the
-- same query filtered differently -- see the header note on why this
-- migration has two authorship sites for the same underlying fact
-- (this function's branches, has_class_teacher_access()'s branches in
-- 0130) rather than a false single chokepoint.
--
-- Priority when a child is reachable more than one way (the exact
-- redundant-grant shape this migration exists to stop happening going
-- forward): class_teacher, then class_sna, then direct_grant. The class
-- relationship is the more current, descriptive reason to show on a
-- roster when both exist; which one displays here has no bearing on
-- point 3 below still refusing the redundant grant from ever being
-- created.
-- =====================================================================

create or replace function public.get_my_accessible_children()
returns table (
  passport_id uuid,
  child_name text,
  diagnoses text[],
  diagnosis_other text,
  access_source text,
  source_detail text
)
language sql
security definer
set search_path = public
stable
as $$
  with direct as (
    select
      pa.passport_id,
      'direct_grant'::text as access_source,
      null::text as source_detail
    from public.passport_access pa
    where pa.teacher_id = auth.uid()
      and pa.is_active = true
      and exists (
        select 1 from public.passport_institution_links pil
        where pil.passport_id = pa.passport_id
          and pil.institution_id = pa.institution_id
      )
  ),
  class_teacher_derived as (
    select
      cc.passport_id,
      'class_teacher'::text as access_source,
      c.name as source_detail
    from public.class_teachers ct
    join public.classes c on c.id = ct.class_id
    join public.class_children cc on cc.class_id = c.id and cc.ended_at is null
    join public.institution_staff s on s.user_id = ct.user_id and s.institution_id = c.institution_id
    where ct.user_id = auth.uid()
      and ct.ended_at is null
      and s.deactivated_at is null
      and s.approved_at is not null
  ),
  class_sna_derived as (
    select
      cc.passport_id,
      'class_sna'::text as access_source,
      c.name as source_detail
    from public.class_sna_assignments csa
    join public.classes c on c.id = csa.class_id
    join public.class_children cc on cc.class_id = c.id and cc.ended_at is null
    join public.institution_staff s on s.user_id = csa.user_id and s.institution_id = c.institution_id
    where csa.user_id = auth.uid()
      and csa.ended_at is null
      and s.deactivated_at is null
      and s.approved_at is not null
  ),
  combined as (
    select * from direct
    union all
    select * from class_teacher_derived
    union all
    select * from class_sna_derived
  ),
  ranked as (
    select
      combined.*,
      row_number() over (
        partition by passport_id
        order by case access_source when 'class_teacher' then 1 when 'class_sna' then 2 else 3 end
      ) as rn
    from combined
  )
  select
    r.passport_id,
    p.child_name,
    p.diagnoses,
    p.diagnosis_other,
    r.access_source,
    r.source_detail
  from ranked r
  join public.passports p on p.id = r.passport_id
  where r.rn = 1
  order by p.child_name;
$$;

grant execute on function public.get_my_accessible_children() to authenticated;


-- =====================================================================
-- 3. get_passport_access_for_child() -- widened. Direct grants exactly
-- as before (active and revoked/history, unchanged shape); derived rows
-- unioned in as their own labelled thing, always is_active = true (a
-- derived row simply stops being returned the moment class membership
-- ends -- there is no "revoked" state for it to occupy, so no history
-- entry either). `id` on a derived row is the underlying class_teachers
-- or class_sna_assignments row's own id -- stable for a client key, but
-- NOT a passport_access id: the client must gate any "Revoke" action on
-- source = 'direct_grant', never call revoke_passport_access() with a
-- derived row's id. actor_role on derived rows mirrors institution_
-- staff's own role vocabulary (class_teacher/sna), not the source label
-- (class_teacher/class_sna), so the client's existing ROLE_LABEL lookup
-- keyed on actor_role needs no new case.
--
-- DROP FUNCTION first -- CREATE OR REPLACE cannot change a RETURNS
-- TABLE column list (added source/source_detail here), matching
-- 0113/0122's own precedent for the identical constraint.
-- =====================================================================

drop function if exists public.get_passport_access_for_child(uuid, uuid);

create function public.get_passport_access_for_child(
  p_passport_id uuid,
  p_institution_id uuid
)
returns table (
  id uuid,
  source text,
  user_id uuid,
  full_name text,
  actor_role text,
  is_active boolean,
  linked_at timestamptz,
  source_detail text,
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
    'direct_grant'::text as source,
    pa.teacher_id as user_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    pa.actor_role,
    pa.is_active,
    pa.linked_at,
    null::text as source_detail,
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
  union all
  select
    rca.id,
    rca.source,
    rca.user_id,
    coalesce(u2.raw_user_meta_data ->> 'full_name', u2.raw_app_meta_data ->> 'full_name') as full_name,
    case rca.source when 'class_sna' then 'sna' else 'class_teacher' end as actor_role,
    true as is_active,
    rca.linked_at,
    rca.source_detail,
    null::uuid as granted_by,
    null::text as granted_by_name,
    null::timestamptz as revoked_at,
    null::uuid as revoked_by,
    null::text as revoked_by_name,
    null::text as revocation_reason
  from public.resolve_class_derived_access(p_passport_id, null, p_institution_id) rca
  join auth.users u2 on u2.id = rca.user_id
  where exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  )
  order by linked_at desc;
$$;

grant execute on function public.get_passport_access_for_child(uuid, uuid) to authenticated;


-- =====================================================================
-- 4. grant_passport_access() -- one new guard, inserted after the
-- actor_role is resolved (so we know exactly which person and which
-- role) and before the existing active-grant check. Refuses outright
-- rather than warning -- see the migration's own commit message for
-- why the "someone about to leave the class" case doesn't actually
-- conflict with a hard refusal: the guard only fires while class
-- membership is still live, which is precisely the state where a
-- manual grant is redundant, never the state where someone needs a
-- bridge after leaving.
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
  v_derived_source text;
  v_derived_detail text;
  v_full_name text;
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

  -- NEW: class-membership-derived access already covers this exact
  -- person for this exact child -- refuse with the real reason rather
  -- than create a grant that would silently outlive the class
  -- assignment it duplicates.
  select source, source_detail into v_derived_source, v_derived_detail
  from public.resolve_class_derived_access(p_passport_id, p_user_id, p_institution_id)
  limit 1;

  if v_derived_source is not null then
    select coalesce(raw_user_meta_data ->> 'full_name', raw_app_meta_data ->> 'full_name')
      into v_full_name
      from auth.users where id = p_user_id;
    raise exception '% already has access to this child through their % assignment (%) -- no separate grant is needed.',
      coalesce(v_full_name, 'This person'),
      case v_derived_source when 'class_sna' then 'class SNA' else 'class teacher' end,
      v_derived_detail;
  end if;

  select id, is_active, institution_id into v_existing_id, v_existing_active, v_existing_institution_id
  from public.passport_access
  where passport_id = p_passport_id and teacher_id = p_user_id;

  if v_existing_id is not null and v_existing_active then
    raise exception 'This person already has active passport access to this child.';
  end if;

  if v_existing_id is not null and v_existing_institution_id <> p_institution_id then
    raise exception 'This person has a revoked passport access grant for this child at a different institution. It cannot be reactivated here.';
  end if;

  if v_existing_id is not null then
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
