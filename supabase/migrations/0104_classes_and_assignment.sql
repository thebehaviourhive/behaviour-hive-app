-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 1, Stage 2: Classes and Assignment. Introduces classes (up to
-- three teachers each, equal standing, membership itself confers
-- access) and child assignment (one-to-one SNA, its own table,
-- independent of class membership). Depends on Stage 1/1a/1b's
-- institution_staff lifecycle and approval model.
--
-- THE ACCESS MODEL: class membership and individual assignment become
-- a SECOND and THIRD source of child access, alongside the existing
-- passport_access grant -- coexisting, not replacing. has_child_access()
-- below is the single function every rewritten call site uses to ask
-- "does this person have ANY of the three kinds of standing with this
-- child" -- this is now the highest-risk object in the schema: every
-- child-data gate in the app resolves through it. Every branch inside
-- it re-verifies the caller's OWN institution_staff row is currently
-- active and approved, regardless of whether a class_teachers/
-- child_assignments row was ever closed for them -- the cascade is for
-- tidiness and history; this re-check is the actual security boundary,
-- and it must never be allowed to be the only thing standing between a
-- deactivated person and a child's record.
--
-- ROW-CURRENCY DISCIPLINE, applied from the first table, not
-- retrofitted: class_teachers and child_assignments both use
-- "ended_at is null" to mean "current", exactly like institution_staff
-- already does, and has_child_access() filters on it explicitly in
-- every branch rather than trusting row existence alone.
--
-- STRICTER approved_by_parent PATHS, three of them (activity_log
-- SELECT, get_teacher_activity_feed, get_message_recipient_candidates):
-- deliberately UNTOUCHED. Their separate, additional
-- passport_institution_links.approved_by_parent = true requirement
-- stays exactly as it is for class-derived callers too --
-- has_child_access() returning true must never be read as satisfying
-- it. That requirement comes out system-wide in Stage 3, which is where
-- it should be removed deliberately, not loosened incidentally here.
-- Each of the three sites below carries this same comment inline.

-- =====================================================================
-- 1. classes -- persist indefinitely (a school reuses "Room 4" year to
-- year); only membership within them starts and ends. Year-boundary
-- correctness for class_children is Stage 6's (enrolment) problem, not
-- this table's -- see the header note on class_children below for what
-- that means operationally until then.
-- =====================================================================

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id)
);

create index classes_institution_id_idx on public.classes (institution_id);

alter table public.classes enable row level security;

-- Any active, approved staff member at the institution can see the
-- class list -- lightweight, for context/picking (e.g. the SNA
-- assignment picker below needs to show which classes exist). This is
-- NOT roster-tier visibility into class ROSTERS -- that's scoped
-- separately below, to the class's own teachers and the principal,
-- until Stage 4 formalises roster tier generally.
create policy "Active staff can view their institution's classes"
  on public.classes for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = classes.institution_id
        and s.user_id = auth.uid()
        and s.deactivated_at is null
        and s.approved_at is not null
    )
  );

-- No client-facing INSERT/UPDATE/DELETE policy -- create_class() below
-- is the only write path, principal-only, matching every other
-- institution-shaping action in this product.

-- =====================================================================
-- 2. class_teachers -- up to three per class, equal standing, no
-- primary/co-teacher distinction. Position (1/2/3) is the cap
-- mechanism: a partial unique index on (class_id, position) where
-- ended_at is null makes "at most three" atomic by construction --
-- concurrent inserts racing for the same slot resolve the normal way a
-- unique index resolves them, no counting trigger, no extra locking.
-- The assigning RPC finds the lowest free slot; a raw insert bypassing
-- it still can't create a fourth, the index is the hard backstop.
-- =====================================================================

create table public.class_teachers (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  position smallint not null check (position in (1, 2, 3)),
  started_at timestamptz not null default now(),
  started_by uuid not null references auth.users (id),
  ended_at timestamptz,
  ended_by uuid references auth.users (id),
  end_reason text,
  constraint class_teachers_end_paired check (
    (ended_at is null and ended_by is null and end_reason is null)
    or (ended_at is not null and ended_by is not null and end_reason is not null)
  )
);

create index class_teachers_class_id_idx on public.class_teachers (class_id);
create index class_teachers_user_id_idx on public.class_teachers (user_id);

-- The cap itself.
create unique index class_teachers_one_active_position_per_class
  on public.class_teachers (class_id, position)
  where ended_at is null;

-- The SAME teacher cannot hold two simultaneously-active slots in the
-- same class (a raw-insert edge case the position cap alone doesn't
-- prevent -- two different free positions for the same person).
create unique index class_teachers_one_active_row_per_teacher_per_class
  on public.class_teachers (class_id, user_id)
  where ended_at is null;

alter table public.class_teachers enable row level security;

create policy "Active staff can view their institution's class teacher rows"
  on public.class_teachers for select to authenticated
  using (
    exists (
      select 1 from public.classes c
      join public.institution_staff s on s.institution_id = c.institution_id
      where c.id = class_teachers.class_id
        and s.user_id = auth.uid()
        and s.deactivated_at is null
        and s.approved_at is not null
    )
  );

-- No client-facing write policy -- add_class_teacher()/
-- remove_class_teacher() below are the only write paths.

-- =====================================================================
-- 3. class_children -- a child is in at most one class at a time
-- (unique on passport_id where ended_at is null). Moving a child is
-- atomic in add_class_child() below: ending the old row and starting
-- the new one happen in the same transaction, so a child is never
-- observably in zero classes or two at once mid-move.
--
-- YEAR-ROLLOVER, asked and answered in Step 0: classes persist,
-- class_children ends the same way class_teachers does -- manually, by
-- the principal, one child (or however many the client batches) at a
-- time. There is no automatic year-boundary mechanism in this stage --
-- if a school doesn't act, old class_children rows simply stay active
-- across a rollover, which would be quietly wrong. Stage 6 (enrolment)
-- is where year-boundaries actually get modelled; until it ships, this
-- is a real, named operational gap, not a silent one -- worth its own
-- line in this stage's VERIFY report, not just this comment.
-- =====================================================================

create table public.class_children (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  passport_id uuid not null references public.passports (id) on delete cascade,
  started_at timestamptz not null default now(),
  started_by uuid not null references auth.users (id),
  ended_at timestamptz,
  ended_by uuid references auth.users (id),
  end_reason text,
  constraint class_children_end_paired check (
    (ended_at is null and ended_by is null and end_reason is null)
    or (ended_at is not null and ended_by is not null and end_reason is not null)
  )
);

create index class_children_class_id_idx on public.class_children (class_id);
create index class_children_passport_id_idx on public.class_children (passport_id);

create unique index class_children_one_active_class_per_child
  on public.class_children (passport_id)
  where ended_at is null;

alter table public.class_children enable row level security;

-- Roster visibility, deliberately narrower than the class list itself:
-- a class's own current teachers, plus the institution's principal.
-- General institution-wide roster visibility into class rosters is
-- Stage 4's (roster tier) to decide, not this one's default.
create policy "Class teachers and the principal can view class rosters"
  on public.class_children for select to authenticated
  using (
    exists (
      select 1 from public.class_teachers ct
      where ct.class_id = class_children.class_id
        and ct.user_id = auth.uid()
        and ct.ended_at is null
    )
    or exists (
      select 1 from public.classes c
      join public.institution_staff s on s.institution_id = c.institution_id
      where c.id = class_children.class_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and s.deactivated_at is null
        and s.approved_at is not null
    )
  );

-- No client-facing write policy -- add_class_child()/remove_class_child()
-- below are the only write paths, principal-only.

-- =====================================================================
-- 4. child_assignments -- one-to-one SNA assignment, structurally
-- independent of class membership: it follows the child across the
-- school, including outside the assigned SNA's own class. An SNA may
-- hold both a class membership and one or more individual assignments
-- at once -- no special case, the two tables don't reference each
-- other at all. "One-to-one" is a plain partial unique index, the
-- cleanest possible expression of the cap -- one active assignment per
-- child, full stop.
-- =====================================================================

create table public.child_assignments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  passport_id uuid not null references public.passports (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  started_at timestamptz not null default now(),
  started_by uuid not null references auth.users (id),
  ended_at timestamptz,
  ended_by uuid references auth.users (id),
  end_reason text,
  constraint child_assignments_end_paired check (
    (ended_at is null and ended_by is null and end_reason is null)
    or (ended_at is not null and ended_by is not null and end_reason is not null)
  )
);

create index child_assignments_institution_id_idx on public.child_assignments (institution_id);
create index child_assignments_passport_id_idx on public.child_assignments (passport_id);
create index child_assignments_user_id_idx on public.child_assignments (user_id);

create unique index child_assignments_one_active_sna_per_child
  on public.child_assignments (passport_id)
  where ended_at is null;

alter table public.child_assignments enable row level security;

create policy "Active staff can view their institution's child assignments"
  on public.child_assignments for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = child_assignments.institution_id
        and s.user_id = auth.uid()
        and s.deactivated_at is null
        and s.approved_at is not null
    )
  );

-- No client-facing write policy -- assign_sna_to_child()/
-- end_child_assignment() below are the only write paths.

-- =====================================================================
-- 5. has_child_access() and its two role-scoped primitives -- the
-- chokepoint. IMPLEMENTATION NOTE, a refinement made while writing this
-- SQL rather than assumed in the Step 0 report: `passports` itself has
-- no institution_id column (confirmed by reading 0002's table
-- definition directly) -- a passport isn't scoped to one institution at
-- the schema level, `passport_access`/classes/child_assignments each
-- carry their own. So has_child_access() takes (user, passport) only,
-- not a caller-supplied institution_id -- removing a class of bug where
-- a wrong or stale institution_id argument could narrow or widen a
-- check incorrectly. Eight of the nineteen call sites are role-
-- restricted (class_teacher-only, or sna-only) rather than "either
-- role" -- duplicating the OR-tree at each of those eight would be
-- exactly the "same three-way OR duplicated everywhere" this helper
-- exists to prevent. So has_child_access() is built from two role-
-- scoped primitives, has_class_teacher_access() and has_sna_access(),
-- each independently callable at a role-restricted site, and OR'd
-- together to form the role-blind has_child_access() used at the
-- eight "either role" sites. One chokepoint, three related functions,
-- not one function duplicated eight times. Every branch in both
-- primitives re-verifies the caller's own institution_staff row is
-- currently active and approved -- this is the security boundary; the
-- departure cascade above is tidiness, not a substitute for this check.
-- =====================================================================

create or replace function public.has_class_teacher_access(
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
        and pa.actor_role = 'class_teacher'
    )
    or exists (
      select 1
      from public.class_children cc
      join public.classes c on c.id = cc.class_id
      join public.class_teachers ct on ct.class_id = c.id
      join public.institution_staff s on s.user_id = ct.user_id and s.institution_id = c.institution_id
      where cc.passport_id = p_passport_id
        and cc.ended_at is null
        and ct.user_id = p_user_id
        and ct.ended_at is null
        and s.deactivated_at is null
        and s.approved_at is not null
    );
$$;

grant execute on function public.has_class_teacher_access(uuid, uuid) to authenticated;

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
    );
$$;

grant execute on function public.has_sna_access(uuid, uuid) to authenticated;

create or replace function public.has_child_access(
  p_user_id uuid,
  p_passport_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.has_class_teacher_access(p_user_id, p_passport_id)
      or public.has_sna_access(p_user_id, p_passport_id);
$$;

grant execute on function public.has_child_access(uuid, uuid) to authenticated;

-- =====================================================================
-- 6. The departure cascade -- extended and renamed, not duplicated.
-- _close_passport_access_for_departure() (0102) becomes
-- _close_child_access_for_departure(): same two call sites
-- (deactivate_institution_staff(), hand_over_principal()'s leaving
-- branch), same signature, now also closing class_teachers and
-- child_assignments rows for the departing person. One helper, per
-- the same reasoning it was extracted for in Stage 1c.
-- =====================================================================

create or replace function public._close_child_access_for_departure(
  p_user_id uuid,
  p_institution_id uuid,
  p_actor_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_name text;
  v_grants_revoked integer := 0;
  v_grant record;
begin
  select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name')
  into v_target_name
  from auth.users u
  where u.id = p_user_id;

  for v_grant in
    select id, passport_id
    from public.passport_access
    where teacher_id = p_user_id
      and institution_id = p_institution_id
      and is_active = true
  loop
    update public.passport_access set is_active = false where id = v_grant.id;

    insert into public.activity_log (passport_id, actor_id, event_type, event_description)
    values (
      v_grant.passport_id,
      p_actor_id,
      'access_revoked',
      'Access removed for ' || coalesce(v_target_name, 'a staff member') || ' (staff member deactivated)'
    );

    v_grants_revoked := v_grants_revoked + 1;
  end loop;

  update public.class_teachers ct
  set ended_at = now(), ended_by = p_actor_id, end_reason = 'Staff member deactivated.'
  from public.classes c
  where ct.class_id = c.id
    and c.institution_id = p_institution_id
    and ct.user_id = p_user_id
    and ct.ended_at is null;

  update public.child_assignments
  set ended_at = now(), ended_by = p_actor_id, end_reason = 'Staff member deactivated.'
  where institution_id = p_institution_id
    and user_id = p_user_id
    and ended_at is null;

  return v_grants_revoked;
end;
$$;

-- deactivate_institution_staff() -- unchanged except the renamed call.
create or replace function public.deactivate_institution_staff(
  p_institution_staff_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.institution_staff;
  v_caller_is_active_principal boolean;
  v_grants_revoked integer := 0;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required to deactivate a staff member.';
  end if;

  select * into v_target
  from public.institution_staff
  where id = p_institution_staff_id;

  if not found then
    raise exception 'Staff member not found.';
  end if;

  if v_target.deactivated_at is not null then
    raise exception 'This staff member is already deactivated.';
  end if;

  if v_target.rejected_at is not null then
    raise exception 'This request was rejected -- there is nothing to deactivate.';
  end if;

  if v_target.approved_at is null then
    raise exception 'This request is still pending -- use reject_staff_join(), not deactivate_institution_staff(), for a request that was never approved.';
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
    raise exception 'Only an active principal at this institution can deactivate staff here.';
  end if;

  if v_target.user_id = auth.uid() then
    raise exception 'You cannot deactivate your own staff membership.';
  end if;

  if v_target.role = 'principal' and not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = v_target.institution_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and s.id <> v_target.id
      and inst.status = 'verified'
  ) then
    raise exception 'Cannot deactivate the last active principal at this institution.';
  end if;

  update public.institution_staff
  set deactivated_at = now(),
      deactivated_by = auth.uid(),
      deactivation_reason = p_reason
  where id = p_institution_staff_id;

  v_grants_revoked := public._close_child_access_for_departure(v_target.user_id, v_target.institution_id, auth.uid());

  return jsonb_build_object('deactivated', true, 'grants_revoked', v_grants_revoked);
end;
$$;

-- hand_over_principal() -- unchanged except the renamed call, in the
-- 'leaving' branch only ('staying' never called the cascade, still
-- doesn't -- a role change never cascades).
create or replace function public.hand_over_principal(
  p_successor_user_id uuid,
  p_outcome text,
  p_staying_role text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_predecessor public.institution_staff;
  v_successor public.institution_staff;
  v_institution_id uuid;
  v_predecessor_new_id uuid;
  v_successor_new_id uuid;
  v_handover_id uuid;
  v_grants_revoked integer := 0;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required to hand over the principal role.';
  end if;

  if p_outcome not in ('leaving', 'staying') then
    raise exception 'Outcome must be either ''leaving'' or ''staying''.';
  end if;

  if p_outcome = 'staying' and (p_staying_role is null or p_staying_role not in ('class_teacher', 'sna')) then
    raise exception 'When staying, the new role must be class_teacher or sna.';
  end if;

  if p_outcome = 'leaving' and p_staying_role is not null then
    raise exception 'A staying role must not be provided when the outcome is leaving.';
  end if;

  if p_successor_user_id = auth.uid() then
    raise exception 'You cannot hand over the principal role to yourself.';
  end if;

  select s.* into v_predecessor
  from public.institution_staff s
  join public.institutions inst on inst.id = s.institution_id
  where s.user_id = auth.uid()
    and s.role = 'principal'
    and s.deactivated_at is null
    and s.approved_at is not null
    and inst.status = 'verified'
  limit 1;

  if not found then
    raise exception 'Only an active principal at a verified institution can hand over the principal role.';
  end if;

  v_institution_id := v_predecessor.institution_id;

  select * into v_successor
  from public.institution_staff s
  where s.user_id = p_successor_user_id
    and s.institution_id = v_institution_id
    and s.deactivated_at is null
    and s.approved_at is not null;

  if not found then
    raise exception 'The person you are handing over to must be an active staff member at this institution.';
  end if;

  update public.institution_staff
  set deactivated_at = now(),
      deactivated_by = auth.uid(),
      deactivation_reason = p_reason
  where id = v_predecessor.id;

  if p_outcome = 'leaving' then
    v_grants_revoked := public._close_child_access_for_departure(auth.uid(), v_institution_id, auth.uid());
  else
    insert into public.institution_staff (institution_id, user_id, role)
    values (v_institution_id, auth.uid(), p_staying_role)
    returning id into v_predecessor_new_id;

    update public.institution_staff
    set approved_at = now(), approved_by = auth.uid(), approval_source = 'handover'
    where id = v_predecessor_new_id;
  end if;

  update public.institution_staff
  set deactivated_at = now(),
      deactivated_by = auth.uid(),
      deactivation_reason = 'Role changed to principal via institution handover.'
  where id = v_successor.id;

  insert into public.institution_staff (institution_id, user_id, role)
  values (v_institution_id, p_successor_user_id, 'principal')
  returning id into v_successor_new_id;

  update public.institution_staff
  set approved_at = now(), approved_by = auth.uid(), approval_source = 'handover'
  where id = v_successor_new_id;

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'principal')
  where id = p_successor_user_id;

  if p_outcome = 'staying' then
    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', p_staying_role)
    where id = auth.uid();
  end if;

  insert into public.principal_handovers (
    institution_id, predecessor_user_id, successor_user_id, outcome, staying_role, reason,
    predecessor_institution_staff_id, predecessor_new_institution_staff_id,
    successor_old_institution_staff_id, successor_new_institution_staff_id
  )
  values (
    v_institution_id, auth.uid(), p_successor_user_id, p_outcome, p_staying_role, p_reason,
    v_predecessor.id, v_predecessor_new_id,
    v_successor.id, v_successor_new_id
  )
  returning id into v_handover_id;

  insert into public.school_notices (notice_type, institution_id, institution_staff_id)
  values ('principal_handover', v_institution_id, v_successor_new_id);

  return jsonb_build_object(
    'handed_over', true,
    'outcome', p_outcome,
    'handover_id', v_handover_id,
    'successor_institution_staff_id', v_successor_new_id,
    'predecessor_new_institution_staff_id', v_predecessor_new_id,
    'grants_revoked', v_grants_revoked
  );
end;
$$;

-- =====================================================================
-- 7. Write RPCs -- classes/teachers principal-only throughout, matching
-- every other institution-shaping action. SNA assignment is the
-- deliberate exception: a class teacher may assign/end an assignment
-- for a child currently in THEIR OWN class; the principal may do so for
-- any child at their institution, class or no class.
-- =====================================================================

create or replace function public.create_class(p_institution_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class_id uuid;
begin
  if p_name is null or trim(p_name) = '' then
    raise exception 'A class name is required.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.user_id = auth.uid()
      and s.institution_id = p_institution_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) then
    raise exception 'Only an active principal at this institution can create a class.';
  end if;

  insert into public.classes (institution_id, name, created_by)
  values (p_institution_id, trim(p_name), auth.uid())
  returning id into v_class_id;

  return v_class_id;
end;
$$;

grant execute on function public.create_class(uuid, text) to authenticated;

create or replace function public.add_class_teacher(p_class_id uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class public.classes;
  v_free_position smallint;
  v_row_id uuid;
begin
  select * into v_class from public.classes where id = p_class_id;
  if not found then
    raise exception 'Class not found.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.user_id = auth.uid()
      and s.institution_id = v_class.institution_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) then
    raise exception 'Only an active principal at this institution can edit a class''s teacher list.';
  end if;

  -- class_teacher role only, deliberately -- has_class_teacher_access()/
  -- has_sna_access() rely on a class_teachers row always meaning
  -- class_teacher and a child_assignments row always meaning sna. An SNA
  -- gets standing through child_assignments, not by occupying a class
  -- teacher slot; the seven Stage 2 decisions never described a
  -- class-level SNA concept, only individual one-to-one assignment.
  if not exists (
    select 1 from public.institution_staff s
    where s.user_id = p_user_id
      and s.institution_id = v_class.institution_id
      and s.role = 'class_teacher'
      and s.deactivated_at is null
      and s.approved_at is not null
  ) then
    raise exception 'This person must be an active class teacher at this institution.';
  end if;

  if exists (
    select 1 from public.class_teachers
    where class_id = p_class_id and user_id = p_user_id and ended_at is null
  ) then
    raise exception 'This person is already a teacher for this class.';
  end if;

  select min(p) into v_free_position
  from unnest(array[1, 2, 3]) as p
  where p not in (
    select position from public.class_teachers where class_id = p_class_id and ended_at is null
  );

  if v_free_position is null then
    raise exception 'This class already has three teachers.';
  end if;

  insert into public.class_teachers (class_id, user_id, position, started_by)
  values (p_class_id, p_user_id, v_free_position, auth.uid())
  returning id into v_row_id;

  return v_row_id;
end;
$$;

grant execute on function public.add_class_teacher(uuid, uuid) to authenticated;

create or replace function public.remove_class_teacher(p_class_teacher_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.class_teachers;
  v_institution_id uuid;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required.';
  end if;

  select ct.* into v_row from public.class_teachers ct where ct.id = p_class_teacher_id;
  if not found then
    raise exception 'Class teacher row not found.';
  end if;

  if v_row.ended_at is not null then
    raise exception 'This teacher has already been removed from this class.';
  end if;

  select c.institution_id into v_institution_id from public.classes c where c.id = v_row.class_id;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.user_id = auth.uid()
      and s.institution_id = v_institution_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) then
    raise exception 'Only an active principal at this institution can edit a class''s teacher list.';
  end if;

  update public.class_teachers
  set ended_at = now(), ended_by = auth.uid(), end_reason = p_reason
  where id = p_class_teacher_id;
end;
$$;

grant execute on function public.remove_class_teacher(uuid, text) to authenticated;

-- Moving a child is atomic: any existing active class_children row for
-- this passport is closed in the SAME statement sequence that opens
-- the new one, so a child is never observably in zero classes or two
-- at once mid-move.
create or replace function public.add_class_child(p_class_id uuid, p_passport_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class public.classes;
  v_existing public.class_children;
  v_row_id uuid;
begin
  select * into v_class from public.classes where id = p_class_id;
  if not found then
    raise exception 'Class not found.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.user_id = auth.uid()
      and s.institution_id = v_class.institution_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) then
    raise exception 'Only an active principal at this institution can edit a class''s roster.';
  end if;

  select * into v_existing
  from public.class_children
  where passport_id = p_passport_id and ended_at is null;

  if found then
    if v_existing.class_id = p_class_id then
      raise exception 'This child is already in this class.';
    end if;
    update public.class_children
    set ended_at = now(), ended_by = auth.uid(), end_reason = 'Moved to a different class.'
    where id = v_existing.id;
  end if;

  insert into public.class_children (class_id, passport_id, started_by)
  values (p_class_id, p_passport_id, auth.uid())
  returning id into v_row_id;

  return v_row_id;
end;
$$;

grant execute on function public.add_class_child(uuid, uuid) to authenticated;

create or replace function public.remove_class_child(p_class_children_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.class_children;
  v_institution_id uuid;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required.';
  end if;

  select cc.* into v_row from public.class_children cc where cc.id = p_class_children_id;
  if not found then
    raise exception 'Class roster row not found.';
  end if;

  if v_row.ended_at is not null then
    raise exception 'This child has already left this class.';
  end if;

  select c.institution_id into v_institution_id from public.classes c where c.id = v_row.class_id;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.user_id = auth.uid()
      and s.institution_id = v_institution_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) then
    raise exception 'Only an active principal at this institution can edit a class''s roster.';
  end if;

  update public.class_children
  set ended_at = now(), ended_by = auth.uid(), end_reason = p_reason
  where id = p_class_children_id;
end;
$$;

grant execute on function public.remove_class_child(uuid, text) to authenticated;

-- Delegated authority: a class teacher may assign/end an SNA assignment
-- for a child currently in THEIR OWN class. A principal may do so for
-- ANY child at their institution, whether or not that child is
-- currently in a class -- the only path when a child has no class at
-- all, or when the caller isn't one of that class's own teachers.
create or replace function public.assign_sna_to_child(
  p_passport_id uuid,
  p_user_id uuid,
  p_institution_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_authorized boolean;
  v_row_id uuid;
begin
  select exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.user_id = auth.uid()
      and s.institution_id = p_institution_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) or exists (
    select 1 from public.class_children cc
    join public.class_teachers ct on ct.class_id = cc.class_id
    where cc.passport_id = p_passport_id
      and cc.ended_at is null
      and ct.user_id = auth.uid()
      and ct.ended_at is null
  ) into v_caller_authorized;

  if not v_caller_authorized then
    raise exception 'Only the principal, or a teacher of this child''s current class, can assign an SNA.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    where s.user_id = p_user_id
      and s.institution_id = p_institution_id
      and s.role = 'sna'
      and s.deactivated_at is null
      and s.approved_at is not null
  ) then
    raise exception 'This person must be an active SNA at this institution.';
  end if;

  if exists (
    select 1 from public.child_assignments
    where passport_id = p_passport_id and ended_at is null
  ) then
    raise exception 'This child already has an assigned SNA.';
  end if;

  insert into public.child_assignments (institution_id, passport_id, user_id, started_by)
  values (p_institution_id, p_passport_id, p_user_id, auth.uid())
  returning id into v_row_id;

  return v_row_id;
end;
$$;

grant execute on function public.assign_sna_to_child(uuid, uuid, uuid) to authenticated;

create or replace function public.end_child_assignment(p_child_assignment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.child_assignments;
  v_caller_authorized boolean;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required.';
  end if;

  select * into v_row from public.child_assignments where id = p_child_assignment_id;
  if not found then
    raise exception 'Assignment not found.';
  end if;

  if v_row.ended_at is not null then
    raise exception 'This assignment has already ended.';
  end if;

  select exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.user_id = auth.uid()
      and s.institution_id = v_row.institution_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) or exists (
    select 1 from public.class_children cc
    join public.class_teachers ct on ct.class_id = cc.class_id
    where cc.passport_id = v_row.passport_id
      and cc.ended_at is null
      and ct.user_id = auth.uid()
      and ct.ended_at is null
  ) into v_caller_authorized;

  if not v_caller_authorized then
    raise exception 'Only the principal, or a teacher of this child''s current class, can end this assignment.';
  end if;

  update public.child_assignments
  set ended_at = now(), ended_by = auth.uid(), end_reason = p_reason
  where id = p_child_assignment_id;
end;
$$;

grant execute on function public.end_child_assignment(uuid, text) to authenticated;

-- =====================================================================
-- 8. The nineteen call sites. Each rewritten to has_child_access(),
-- role restrictions layered on separately where the current policy has
-- one, everything else byte-identical to what it replaces. The three
-- approved_by_parent-stricter sites keep that requirement completely
-- untouched -- see the header note.
-- =====================================================================

-- 8.1 passports SELECT -- role-blind original, has_child_access() is a
-- direct drop-in.
alter policy "Teachers with granted access can view a passport"
  on public.passports
  using (
    public.has_child_access(auth.uid(), passports.id)
  );

-- 8.2 passport_section_b SELECT -- same shape.
alter policy "Teachers with granted access can view section B"
  on public.passport_section_b
  using (
    public.has_child_access(auth.uid(), passport_section_b.passport_id)
  );

-- 8.3 passport_section_c SELECT -- same shape.
alter policy "Teachers with granted access can view section C"
  on public.passport_section_c
  using (
    public.has_child_access(auth.uid(), passport_section_c.passport_id)
  );

-- 8.4 passport_section_d SELECT -- same shape.
alter policy "Teachers with granted access can view section D"
  on public.passport_section_d
  using (
    public.has_child_access(auth.uid(), passport_section_d.passport_id)
  );

-- 8.5 morning_checkins SELECT -- same shape.
alter policy "Teachers with granted access can view morning check-ins"
  on public.morning_checkins
  using (
    public.has_child_access(auth.uid(), morning_checkins.passport_id)
  );

-- 8.6 strategy_ledger INSERT -- class_teacher-only in the original
-- (actor_role = 'class_teacher'), so has_class_teacher_access() not
-- has_child_access().
alter policy "Teachers can insert ledger entries for passports they can access"
  on public.strategy_ledger
  with check (
    auth.uid() = submitted_by
    and public.has_class_teacher_access(auth.uid(), strategy_ledger.passport_id)
  );

-- 8.7 strategy_ledger SELECT -- REAL BUG FIXED HERE, found during Step 0
-- recon, not introduced by this migration: the third branch below never
-- checked pa.is_active at all, only actor_role -- meaning a REVOKED
-- class teacher's passport_access row (is_active = false) still passed
-- this policy, silently outliving the revocation. `and pa.is_active =
-- true` is added below alongside the rewrite, not left to ride along
-- unfixed.
alter policy "Teachers and the child's parent can view ledger entries"
  on public.strategy_ledger
  using (
    auth.uid() = submitted_by
    or exists (
      select 1 from public.passports p
      where p.id = strategy_ledger.passport_id
        and p.user_id = auth.uid()
    )
    or public.has_class_teacher_access(auth.uid(), strategy_ledger.passport_id)
  );

-- 8.8 teacher_updates INSERT -- class_teacher-only original.
alter policy "Teachers can insert updates for passports they can access"
  on public.teacher_updates
  with check (
    auth.uid() = teacher_id
    and public.has_class_teacher_access(auth.uid(), teacher_updates.passport_id)
  );

-- 8.9 activity_log INSERT -- role-blind original (0065's own comment:
-- "an SNA's own ABC log must still generate the same abc_logged event
-- everyone else already sees" -- write access, deliberately untouched).
drop policy if exists "Teachers can insert activity for passports they access" on public.activity_log;

create policy "Teachers can insert activity for passports they access"
  on public.activity_log
  for insert
  to authenticated
  with check (
    actor_id = auth.uid()
    and public.has_child_access(auth.uid(), activity_log.passport_id)
  );

-- 8.10 activity_log SELECT -- class_teacher-only AND a SEPARATE,
-- additional approved_by_parent requirement -- one of the three
-- "stricter" sites. STAGE 3 NOTE: approved_by_parent stays required
-- below, completely untouched, for class-derived callers too --
-- deliberately, per the header note. It comes out system-wide only when
-- Stage 3 removes it generally, not incidentally here. NOT rewritten
-- via has_class_teacher_access() alone -- the original has no
-- institution-matching between the grant and the approval link (just
-- "some approved link exists for this passport"), and the class-derived
-- branch added below preserves that exact, looser shape rather than
-- accidentally tightening or loosening it.
alter policy "Teachers can view activity for passports they access"
  on public.activity_log
  using (
    (
      exists (
        select 1 from public.passport_access pa
        where pa.passport_id = activity_log.passport_id
          and pa.teacher_id = auth.uid()
          and pa.is_active = true
          and pa.actor_role = 'class_teacher'
      )
      or exists (
        select 1
        from public.class_children cc
        join public.classes c on c.id = cc.class_id
        join public.class_teachers ct on ct.class_id = c.id
        join public.institution_staff s on s.user_id = ct.user_id and s.institution_id = c.institution_id
        where cc.passport_id = activity_log.passport_id
          and cc.ended_at is null
          and ct.user_id = auth.uid()
          and ct.ended_at is null
          and s.deactivated_at is null
          and s.approved_at is not null
      )
    )
    and exists (
      select 1 from public.passport_institution_links pil
      where pil.passport_id = activity_log.passport_id
        and pil.approved_by_parent = true
    )
    and activity_log.event_type in (
      'passport_updated', 'abc_logged', 'team_linked', 'strategy_logged',
      'access_revoked', 'afternoon_update', 'clinical_content_added'
    )
    and (activity_log.event_type <> 'abc_logged' or activity_log.actor_id = auth.uid())
    and not exists (
      select 1 from public.clinicians c where c.user_id = activity_log.actor_id
    )
  );

-- 8.11 abc_logs INSERT (class_teacher).
alter policy "Teachers can insert abc logs for passports they access"
  on public.abc_logs
  with check (
    auth.uid() = logged_by
    and logged_by_role = 'class_teacher'
    and public.has_class_teacher_access(auth.uid(), abc_logs.passport_id)
  );

-- 8.12 abc_logs INSERT (sna).
alter policy "SNAs can insert abc logs for passports they access"
  on public.abc_logs
  with check (
    auth.uid() = logged_by
    and logged_by_role = 'sna'
    and public.has_sna_access(auth.uid(), abc_logs.passport_id)
  );

-- 8.13 abc_logs SELECT -- role-blind original (0064's own governance
-- narrowing: own-authored + shared-via-message, on top of general
-- access). has_child_access() is a direct drop-in for the access check;
-- the own/shared narrowing is untouched.
alter policy "Teachers can view abc logs for passports they access"
  on public.abc_logs
  using (
    public.has_child_access(auth.uid(), abc_logs.passport_id)
    and (
      abc_logs.logged_by = auth.uid()
      or exists (
        select 1 from public.messages m
        join public.message_recipients mr on mr.message_id = m.id
        where m.abc_log_id = abc_logs.id
          and mr.recipient_id = auth.uid()
      )
    )
  );

-- 8.14 passport_clinical_content SELECT (0040) -- role-blind original
-- (no actor_role filter ever existed on this table policy, unlike the
-- get_passport_clinical_content() RPC's own item_type-filtered branch,
-- which already explicitly allows both roles). has_child_access() is a
-- direct drop-in.
alter policy "Teachers with active access can view school-relevant clinical content"
  on public.passport_clinical_content
  using (
    item_type in ('strategy_school', 'strategy_shared', 'trigger', 'setting_event')
    and public.has_child_access(auth.uid(), passport_clinical_content.passport_id)
  );

-- 8.15 strategy_feedback INSERT (teacher) -- rater_role = 'teacher' in
-- this table means class_teacher specifically (the item_type scope
-- below, 'strategy_school'/'strategy_shared', is the same "From your
-- Clinical Team" content Q1 explicitly extends to SNA elsewhere, but
-- strategy_feedback itself was never in SNA's v1 grant list and stays
-- exactly as narrow as it already was -- not widened here).
alter policy "Teachers can rate school/shared strategies on linked passports"
  on public.strategy_feedback
  with check (
    rater_id = auth.uid()
    and rater_role = 'teacher'
    and context = 'eod'
    and strategy_content_id is not null
    and calm_card_id is null
    and public.has_class_teacher_access(auth.uid(), strategy_feedback.passport_id)
    and exists (
      select 1 from public.passport_clinical_content pcc
      where pcc.id = strategy_feedback.strategy_content_id
        and pcc.passport_id = strategy_feedback.passport_id
        and pcc.item_type in ('strategy_school', 'strategy_shared')
    )
  );

-- 8.16 strategy_feedback_prompts INSERT -- class_teacher-only original,
-- explicitly excludes SNA (not in SNA's v1 grant list), unchanged here.
alter policy "Teachers can log their own strategy-feedback prompts"
  on public.strategy_feedback_prompts
  with check (
    teacher_id = auth.uid()
    and public.has_class_teacher_access(auth.uid(), strategy_feedback_prompts.passport_id)
  );

-- =====================================================================
-- 9. Section B -- the eight functions.
-- =====================================================================

-- 9.1 get_abc_logs -- role-blind original, live def 0067. Return shape
-- (sensory columns, perceived_function_other) carried over byte-
-- identical; only the access check inside the WHERE changes.
create or replace function public.get_abc_logs(p_passport_id uuid)
returns table (
  id uuid,
  passport_id uuid,
  logged_by uuid,
  logged_by_name text,
  logged_by_role text,
  incident_date date,
  incident_time time,
  duration_minutes integer,
  intensity integer,
  antecedents text[],
  antecedent_other text,
  behaviours text[],
  behaviour_other text,
  consequences text[],
  consequence_other text,
  sensory_sought text[],
  sensory_avoided text[],
  sensory_sought_other text,
  sensory_avoided_other text,
  perceived_function text,
  perceived_function_other text,
  general_notes text,
  is_draft boolean,
  sync_status text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    a.id, a.passport_id, a.logged_by,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as logged_by_name,
    a.logged_by_role, a.incident_date, a.incident_time, a.duration_minutes,
    a.intensity, a.antecedents, a.antecedent_other, a.behaviours, a.behaviour_other,
    a.consequences, a.consequence_other,
    a.sensory_sought, a.sensory_avoided, a.sensory_sought_other, a.sensory_avoided_other,
    case
      when public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = a.passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
      then a.perceived_function
      else null
    end as perceived_function,
    case
      when public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = a.passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
      then a.perceived_function_other
      else null
    end as perceived_function_other,
    a.general_notes,
    a.is_draft, a.sync_status, a.created_at
  from public.abc_logs a
  join auth.users u on u.id = a.logged_by
  where a.passport_id = p_passport_id
    and (
      public.owns_passport(p_passport_id)
      or (
        public.has_child_access(auth.uid(), p_passport_id)
        and (
          a.logged_by = auth.uid()
          or exists (
            select 1 from public.messages m
            join public.message_recipients mr on mr.message_id = m.id
            where m.abc_log_id = a.id
              and mr.recipient_id = auth.uid()
          )
        )
      )
      or (
        public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = p_passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
      )
    )
  order by a.incident_date desc, a.incident_time desc;
$$;

grant execute on function public.get_abc_logs(uuid) to authenticated;

-- 9.2 get_abc_trend_data -- class_teacher-only original (SNA
-- deliberately excluded from Progress/trend data, per 0065's own
-- comment -- unchanged here, has_sna_access() is NOT used).
create or replace function public.get_abc_trend_data(p_passport_id uuid)
returns table (
  id uuid,
  incident_date date,
  incident_time time,
  logged_by_role text,
  duration_minutes integer,
  intensity integer,
  antecedents text[],
  behaviours text[],
  consequences text[]
)
language sql
security definer
set search_path = public
stable
as $$
  select
    a.id, a.incident_date, a.incident_time, a.logged_by_role,
    a.duration_minutes, a.intensity, a.antecedents, a.behaviours, a.consequences
  from public.abc_logs a
  where a.passport_id = p_passport_id
    and (
      public.owns_passport(p_passport_id)
      or (
        public.has_class_teacher_access(auth.uid(), p_passport_id)
        and (
          a.logged_by = auth.uid()
          or exists (
            select 1 from public.messages m
            join public.message_recipients mr on mr.message_id = m.id
            where m.abc_log_id = a.id
              and mr.recipient_id = auth.uid()
          )
        )
      )
      or (
        public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = p_passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
      )
    )
  order by a.incident_date asc, a.incident_time asc;
$$;

grant execute on function public.get_abc_trend_data(uuid) to authenticated;

-- 9.3 get_teacher_activity_feed -- class_teacher-only AND a SEPARATE,
-- institution-matched approved_by_parent requirement -- the second of
-- the three "stricter" sites. STAGE 3 NOTE: approved_by_parent stays
-- required below, completely untouched, for class-derived callers too
-- -- deliberately, per the header note. NOT has_class_teacher_access()
-- alone -- the original JOINs pa.institution_id to pil.institution_id
-- (the SPECIFIC institution the grant belongs to must itself be
-- parent-approved, not just any institution), so the class-derived
-- branch below re-derives and matches the class's own institution_id
-- the same way, preserving that exact institution-scoping rather than
-- silently widening it to "any approved institution".
create or replace function public.get_teacher_activity_feed(
  p_limit integer default 20, p_offset integer default 0
)
returns table (
  id uuid, passport_id uuid, child_name text, event_type text,
  event_description text, created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select al.id, al.passport_id, p.child_name, al.event_type, al.event_description, al.created_at
  from public.activity_log al
  join public.passports p on p.id = al.passport_id
  where (
      exists (
        select 1 from public.passport_access pa
        join public.passport_institution_links pil
          on pil.passport_id = pa.passport_id and pil.institution_id = pa.institution_id
        where pa.passport_id = al.passport_id
          and pa.teacher_id = auth.uid()
          and pa.is_active = true
          and pa.actor_role = 'class_teacher'
          and pil.approved_by_parent = true
      )
      or exists (
        select 1
        from public.class_children cc
        join public.classes c on c.id = cc.class_id
        join public.class_teachers ct on ct.class_id = c.id
        join public.institution_staff s on s.user_id = ct.user_id and s.institution_id = c.institution_id
        join public.passport_institution_links pil
          on pil.passport_id = cc.passport_id and pil.institution_id = c.institution_id
        where cc.passport_id = al.passport_id
          and cc.ended_at is null
          and ct.user_id = auth.uid()
          and ct.ended_at is null
          and s.deactivated_at is null
          and s.approved_at is not null
          and pil.approved_by_parent = true
      )
    )
    and al.event_type in (
      'passport_updated', 'abc_logged', 'team_linked', 'strategy_logged',
      'access_revoked', 'afternoon_update', 'clinical_content_added'
    )
    and (al.event_type <> 'abc_logged' or al.actor_id = auth.uid())
    and not exists (
      select 1 from public.clinicians c where c.user_id = al.actor_id
    )
  order by al.created_at desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.get_teacher_activity_feed(integer, integer) to authenticated;

-- 9.4 get_passport_clinical_content -- "either role" original (actor_role
-- in ('class_teacher','sna')), has_child_access() is a direct drop-in.
create or replace function public.get_passport_clinical_content(p_passport_id uuid)
returns table (
  id uuid,
  item_type text,
  content jsonb,
  author_role text,
  author_name text,
  author_specialty text,
  source_document_type text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    pcc.id,
    pcc.item_type,
    pcc.content,
    pcc.author_role,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as author_name,
    c.specialty as author_specialty,
    pcc.source_document_type,
    pcc.created_at
  from public.passport_clinical_content pcc
  join auth.users u on u.id = pcc.author_id
  left join public.clinicians c on c.user_id = pcc.author_id
  where pcc.passport_id = p_passport_id
    and (
      public.owns_passport(p_passport_id)
      or (
        exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = p_passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
        and public.is_verified_clinician(auth.uid())
      )
      or (
        pcc.item_type in ('strategy_school', 'strategy_shared', 'trigger', 'setting_event')
        and public.has_child_access(auth.uid(), p_passport_id)
      )
    )
  order by pcc.created_at asc;
$$;

grant execute on function public.get_passport_clinical_content(uuid) to authenticated;

-- 9.5 can_view_message -- class_teacher-only original, no
-- approved_by_parent gate on this one (not one of the three stricter
-- sites). Only the teacher branch's EXISTS changes.
create or replace function public.can_view_message(p_message_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.messages m
    where m.id = p_message_id
      and (
        public.owns_passport(m.passport_id)

        or (
          public.has_class_teacher_access(auth.uid(), m.passport_id)
          and (
            m.sender_id = auth.uid()
            or exists (
              select 1 from public.message_recipients mr
              where mr.message_id = m.id and mr.recipient_id = auth.uid()
            )
          )
        )

        or (
          public.is_verified_clinician(auth.uid())
          and exists (
            select 1 from public.clinician_access ca
            where ca.passport_id = m.passport_id
              and ca.clinician_id = auth.uid()
              and ca.is_active = true
          )
          and (
            m.sender_id = auth.uid()
            or exists (
              select 1 from public.message_recipients mr
              where mr.message_id = m.id and mr.recipient_id = auth.uid()
            )
          )
        )

        or (
          public.is_verified_clinician(auth.uid())
          and exists (
            select 1 from public.clinician_access ca
            where ca.passport_id = m.passport_id
              and ca.clinician_id = auth.uid()
              and ca.is_active = true
          )
          and m.sender_role in ('parent', 'class_teacher')
          and not exists (
            select 1 from public.message_recipients mr2
            where mr2.message_id = m.id and mr2.recipient_role = 'clinician'
          )
        )
      )
  );
$$;

grant execute on function public.can_view_message(uuid) to authenticated;

-- 9.6 get_message_recipient_candidates -- class_teacher-only AND a
-- SEPARATE, institution-matched approved_by_parent requirement -- the
-- third of the three "stricter" sites. STAGE 3 NOTE: approved_by_parent
-- stays required below, completely untouched, for class-derived callers
-- too -- deliberately, per the header note. Messages stays class_teacher
-- -only by design (SNA messaging is explicitly excluded per 0065's own
-- migration header, "stays explicitly denied") -- no assignment-derived
-- (SNA) branch is added anywhere in this function. The new
-- class-derived candidates branch is deduplicated against the
-- passport_access branch so a teacher holding both never appears twice.
create or replace function public.get_message_recipient_candidates(p_passport_id uuid)
returns table (
  recipient_id uuid,
  full_name text,
  role text
)
language sql
security definer
set search_path = public
stable
as $$
  with authorized as (
    select 1
    where
      public.owns_passport(p_passport_id)
      or exists (
        select 1 from public.passport_access pa
        join public.passport_institution_links pil
          on pil.passport_id = pa.passport_id and pil.institution_id = pa.institution_id
        where pa.passport_id = p_passport_id
          and pa.teacher_id = auth.uid()
          and pa.is_active = true
          and pa.actor_role = 'class_teacher'
          and pil.approved_by_parent = true
      )
      or exists (
        select 1
        from public.class_children cc
        join public.classes c on c.id = cc.class_id
        join public.class_teachers ct on ct.class_id = c.id
        join public.institution_staff s on s.user_id = ct.user_id and s.institution_id = c.institution_id
        join public.passport_institution_links pil
          on pil.passport_id = cc.passport_id and pil.institution_id = c.institution_id
        where cc.passport_id = p_passport_id
          and cc.ended_at is null
          and ct.user_id = auth.uid()
          and ct.ended_at is null
          and s.deactivated_at is null
          and s.approved_at is not null
          and pil.approved_by_parent = true
      )
      or (
        public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = p_passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
      )
  ),
  candidates as (
    select p.user_id as recipient_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
           'parent'::text as role
    from authorized, public.passports p
    join auth.users u on u.id = p.user_id
    where p.id = p_passport_id

    union all

    select pa.teacher_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           'class_teacher'
    from authorized, public.passport_access pa
    join public.passport_institution_links pil
      on pil.passport_id = pa.passport_id and pil.institution_id = pa.institution_id
    join auth.users u on u.id = pa.teacher_id
    where pa.passport_id = p_passport_id
      and pa.is_active = true
      and pa.actor_role = 'class_teacher'
      and pil.approved_by_parent = true

    union all

    select ct.user_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           'class_teacher'
    from authorized, public.class_children cc
    join public.classes c on c.id = cc.class_id
    join public.class_teachers ct on ct.class_id = c.id
    join public.institution_staff s on s.user_id = ct.user_id and s.institution_id = c.institution_id
    join public.passport_institution_links pil
      on pil.passport_id = cc.passport_id and pil.institution_id = c.institution_id
    join auth.users u on u.id = ct.user_id
    where cc.passport_id = p_passport_id
      and cc.ended_at is null
      and ct.ended_at is null
      and s.deactivated_at is null
      and s.approved_at is not null
      and pil.approved_by_parent = true
      and not exists (
        select 1 from public.passport_access pa2
        where pa2.passport_id = p_passport_id
          and pa2.teacher_id = ct.user_id
          and pa2.is_active = true
          and pa2.actor_role = 'class_teacher'
      )

    union all

    select ca.clinician_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           'clinician'
    from authorized, public.clinician_access ca
    join auth.users u on u.id = ca.clinician_id
    where ca.passport_id = p_passport_id
      and ca.is_active = true
      and public.is_verified_clinician(ca.clinician_id)
  )
  select recipient_id, full_name, role
  from candidates
  where recipient_id <> auth.uid();
$$;

grant execute on function public.get_message_recipient_candidates(uuid) to authenticated;

-- 9.7 send_message -- FOURTH stricter site, found while writing this
-- migration, alongside the three Daniel named explicitly (activity_log
-- SELECT, get_teacher_activity_feed, get_message_recipient_candidates):
-- the teacher elsif branch below has the IDENTICAL institution-matched
-- approved_by_parent shape, not just role-blind passport_access. Named
-- here explicitly per CLAUDE.md's own standing instruction to grep every
-- call site of a changed pattern, not just the ones already flagged.
-- Treated the same way: approved_by_parent stays completely untouched.
-- Return type/signature unchanged, so create or replace is safe.
create or replace function public.send_message(
  p_passport_id uuid,
  p_category_id uuid,
  p_body text,
  p_response_required boolean,
  p_recipient_ids uuid[],
  p_abc_log_id uuid default null,
  p_strategy_update boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sender_role text;
  v_category_roles text[];
  v_category_label text;
  v_open_rr_count integer;
  v_message_id uuid;
  v_recipient_count integer;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  if p_body is not null and char_length(p_body) > 200 then
    raise exception 'Message body must be 200 characters or fewer.';
  end if;

  if p_recipient_ids is null or array_length(p_recipient_ids, 1) is null or array_length(p_recipient_ids, 1) = 0 then
    raise exception 'At least one recipient is required.';
  end if;

  if public.owns_passport(p_passport_id) then
    v_sender_role := 'parent';
  elsif exists (
    select 1 from public.passport_access pa
    join public.passport_institution_links pil
      on pil.passport_id = pa.passport_id and pil.institution_id = pa.institution_id
    where pa.passport_id = p_passport_id
      and pa.teacher_id = v_uid
      and pa.is_active = true
      and pa.actor_role = 'class_teacher'
      and pil.approved_by_parent = true
  ) or exists (
    select 1
    from public.class_children cc
    join public.classes c on c.id = cc.class_id
    join public.class_teachers ct on ct.class_id = c.id
    join public.institution_staff s on s.user_id = ct.user_id and s.institution_id = c.institution_id
    join public.passport_institution_links pil
      on pil.passport_id = cc.passport_id and pil.institution_id = c.institution_id
    where cc.passport_id = p_passport_id
      and cc.ended_at is null
      and ct.user_id = v_uid
      and ct.ended_at is null
      and s.deactivated_at is null
      and s.approved_at is not null
      and pil.approved_by_parent = true
  ) then
    v_sender_role := 'class_teacher';
  elsif public.is_verified_clinician(v_uid) and exists (
    select 1 from public.clinician_access ca
    where ca.passport_id = p_passport_id
      and ca.clinician_id = v_uid
      and ca.is_active = true
  ) then
    v_sender_role := 'clinician';
  else
    raise exception 'You are not authorized to message about this child.';
  end if;

  select array_agg(role_value)
  into v_category_roles
  from (
    select jsonb_array_elements_text(to_jsonb(mc.allowed_sender_roles)) as role_value
    from public.message_categories mc
    where mc.id = p_category_id and mc.is_active = true
  ) roles;

  select label into v_category_label
  from public.message_categories
  where id = p_category_id and is_active = true;

  if v_category_label is null then
    raise exception 'Invalid or inactive category.';
  end if;
  if not (v_sender_role = any(v_category_roles)) then
    raise exception 'This category is not available to your role.';
  end if;

  if p_abc_log_id is not null and not exists (
    select 1 from public.abc_logs where id = p_abc_log_id and passport_id = p_passport_id
  ) then
    raise exception 'That incident log does not belong to this child.';
  end if;

  if p_strategy_update and v_category_label is distinct from 'Strategy update' then
    raise exception 'strategy_update can only be set on a Strategy update message.';
  end if;

  if p_response_required then
    select count(*) into v_open_rr_count
    from public.messages
    where passport_id = p_passport_id
      and sender_id = v_uid
      and response_required = true
      and status <> 'closed';
    if v_open_rr_count >= 3 then
      raise exception 'You already have 3 open response-required conversations for this child. Close one before starting another.';
    end if;
  end if;

  insert into public.messages (
    passport_id, sender_id, sender_role, category_id, body,
    response_required, status, abc_log_id, strategy_update
  ) values (
    p_passport_id, v_uid, v_sender_role, p_category_id, p_body,
    p_response_required, 'open', p_abc_log_id, p_strategy_update
  )
  returning id into v_message_id;

  select count(*) into v_recipient_count
  from unnest(p_recipient_ids) as rid
  where rid <> v_uid;

  if v_recipient_count = 0 then
    raise exception 'At least one valid recipient is required.';
  end if;

  insert into public.message_recipients (message_id, recipient_id, recipient_role)
  select v_message_id, rid, (
    select role from public.get_message_recipient_candidates(p_passport_id) c
    where c.recipient_id = rid
  )
  from unnest(p_recipient_ids) as rid
  where rid <> v_uid;

  if exists (
    select 1 from public.message_recipients where message_id = v_message_id and recipient_role is null
  ) then
    raise exception 'One or more recipients are not authorized participants for this child.';
  end if;

  return v_message_id;
end;
$$;

grant execute on function public.send_message(uuid, uuid, text, boolean, uuid[], uuid, boolean) to authenticated;

-- 9.8 can_view_incident -- the single choke point for the 9
-- incident-family tables (incidents, incident_children, incident_staff,
-- incident_actions, restrictive_practices, incident_injuries,
-- incident_body_marks, incident_debriefs, incident_amendments), none of
-- which reference passport_access directly in their own policy body.
-- Only the last branch changes -- role-blind original (no actor_role
-- filter), matching the incident log's own established posture that
-- institution-roster-derived visibility is role-blind. Every other
-- branch (countersign, creator, owning teacher, clinician) is untouched.
create or replace function public.can_view_incident(p_incident_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return exists (
    select 1 from public.incidents i
    where i.id = p_incident_id
      and (
        public.can_countersign_incident(auth.uid(), i.institution_id)
        or i.created_by = auth.uid()
        or i.owning_teacher_id = auth.uid()
        or (
          i.status <> 'draft'
          and public.is_verified_clinician(auth.uid())
          and exists (
            select 1 from public.incident_children ic
            join public.clinician_access ca on ca.passport_id = ic.passport_id
            where ic.incident_id = i.id
              and ca.clinician_id = auth.uid()
              and ca.is_active = true
          )
        )
        or (
          exists (
            select 1 from public.incident_staff st
            where st.incident_id = i.id and st.user_id = auth.uid()
          )
          and (
            i.status <> 'draft'
            or exists (
              select 1
              from public.incident_attestations att
              join public.incident_staff st on st.id = att.incident_staff_id
              where st.incident_id = i.id and st.user_id = auth.uid()
            )
          )
        )
        or (
          i.status <> 'draft'
          and exists (
            select 1 from public.incident_children ic
            where ic.incident_id = i.id
              and public.has_child_access(auth.uid(), ic.passport_id)
          )
        )
      )
  );
end;
$$;

-- =====================================================================
-- 10. get_passport_team() -- extended for parent-facing completeness,
-- per Daniel's explicit decision: shipping the access without shipping
-- visibility of who holds it leaves a parent's "who's on my child's
-- team" quietly wrong. Two new UNION ALL branches (class-derived
-- teacher, assignment-derived SNA), each gated by owns_passport() like
-- the two existing branches, each deduplicated against the
-- passport_access branch so a person holding both a grant and
-- class/assignment standing never appears twice, each carrying the
-- defense-in-depth institution_staff re-check.
--
-- get_passport_clinicians() CHECKED, per the same instruction, and
-- CONFIRMED TO NEED NO CHANGE: it has zero passport_access reference at
-- all (verified by reading it directly, 0029:570-590) -- purely
-- clinician_access + owns_passport(), no shape-of-problem here.
--
-- get_fba_recipient_candidates() FLAGGED, NOT FIXED HERE: same shape of
-- gap as get_passport_team() had (its teacher branch enumerates via
-- passport_access only, so a class-derived teacher wouldn't appear as
-- an FBA recipient candidate) -- but it was not in the audited 19-site
-- list and Daniel asked specifically about get_passport_team() and
-- get_passport_clinicians(), not this one. Surfaced here rather than
-- silently fixed or silently ignored; left for a deliberate decision.
-- =====================================================================
create or replace function public.get_passport_team(p_passport_id uuid)
returns table (
  teacher_id uuid,
  full_name text,
  role text,
  linked_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    pa.teacher_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    coalesce(s.role, 'class_teacher') as role,
    pa.linked_at
  from public.passport_access pa
  join auth.users u on u.id = pa.teacher_id
  left join public.institution_staff s
    on s.user_id = pa.teacher_id and s.institution_id = pa.institution_id
  where pa.passport_id = p_passport_id
    and pa.is_active = true
    and public.owns_passport(p_passport_id)

  union all

  select
    ca.clinician_id as teacher_id,
    coalesce(c.full_name, u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    'clinician' as role,
    ca.linked_at
  from public.clinician_access ca
  join auth.users u on u.id = ca.clinician_id
  left join public.clinicians c on c.user_id = ca.clinician_id
  where ca.passport_id = p_passport_id
    and ca.is_active = true
    and coalesce(c.verification_status, '') = 'verified'
    and public.owns_passport(p_passport_id)

  union all

  select
    ct.user_id as teacher_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    'class_teacher' as role,
    ct.started_at as linked_at
  from public.class_children cc
  join public.classes c on c.id = cc.class_id
  join public.class_teachers ct on ct.class_id = c.id
  join public.institution_staff s on s.user_id = ct.user_id and s.institution_id = c.institution_id
  join auth.users u on u.id = ct.user_id
  where cc.passport_id = p_passport_id
    and cc.ended_at is null
    and ct.ended_at is null
    and s.deactivated_at is null
    and s.approved_at is not null
    and public.owns_passport(p_passport_id)
    and not exists (
      select 1 from public.passport_access pa2
      where pa2.passport_id = p_passport_id
        and pa2.teacher_id = ct.user_id
        and pa2.is_active = true
    )

  union all

  select
    ca2.user_id as teacher_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    'sna' as role,
    ca2.started_at as linked_at
  from public.child_assignments ca2
  join public.institution_staff s on s.user_id = ca2.user_id and s.institution_id = ca2.institution_id
  join auth.users u on u.id = ca2.user_id
  where ca2.passport_id = p_passport_id
    and ca2.ended_at is null
    and s.deactivated_at is null
    and s.approved_at is not null
    and public.owns_passport(p_passport_id)
    and not exists (
      select 1 from public.passport_access pa3
      where pa3.passport_id = p_passport_id
        and pa3.teacher_id = ca2.user_id
        and pa3.is_active = true
    );
$$;

grant execute on function public.get_passport_team(uuid) to authenticated;
