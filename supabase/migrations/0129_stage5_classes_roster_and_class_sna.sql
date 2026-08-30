-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 2, Stage 5 -- classes and SNA assignment. First new SQL of this
-- PRD. Five pieces, in dependency order:
--
--   1. get_institution_classes_roster() -- new. /principal/classes
--      today composes three raw reads client-side (classes,
--      class_teachers counted, class_children counted). Matches the
--      naming/shape convention of the two existing roster RPCs:
--      class_id (not bare id), named the way get_institution_child_
--      roster() names passport_id -- "the entity's own identifier,
--      named by what it identifies" -- teacher_count/child_count as
--      plain counts of currently-active rows.
--
--   2. get_institution_child_roster() widened with current_class_id --
--      NOT a dedicated RPC. Reasoning: "unassigned" is a per-child fact
--      that belongs on the roster row itself, the same way
--      enrolment_ended_at (0122) does -- it needs the identical base
--      query (every linked child, institution-scoped, standing-
--      checked), the identical authorization, and the identical
--      ordering as the roster already computes. A dedicated RPC would
--      duplicate every one of those for zero gain -- nothing about "is
--      this child in an active class right now" needs different rows
--      or different authorization than the roster already has in hand.
--      A nullable class_id (not a bare boolean) is more useful than
--      "is_unassigned" alone: the client gets "which class, if any" in
--      the same read, needed for the child roster's own CLASS SNA
--      display, at zero extra cost since the row is already being
--      fetched.
--
--      Same non-breaking shape 0122 already proved once, checked again
--      here rather than assumed: every existing caller (principal/
--      classes/[classId], principal/passports/[passportId], teacher/
--      incidents/[incidentId], GrantPassportAccessSheet,
--      AddClassChildSheet, teacher/class, useSnaChildren,
--      useInstitutionRoster, and now principal/passports/page.tsx for
--      enrolment_ended_at) only ever destructures named fields off
--      each row -- none breaks by one more column being present, none
--      is narrowed by this change. CREATE OR REPLACE cannot change a
--      RETURNS TABLE column list -- DROP + CREATE, matching 0113/0122's
--      own precedent for the identical constraint.
--
--   3. class_sna_assignments -- NEW persistent, class-wide SNA
--      standing. Does not exist anywhere in this schema today --
--      add_class_teacher()'s own comment (0104) says so explicitly:
--      "the seven Stage 2 decisions never described a class-level SNA
--      concept, only individual one-to-one assignment." The closest
--      existing thing, temporary_access's own class-wide SNA-tier
--      cover (0105/0109), is deliberately DAY-SCOPED (a date + a
--      cutoff time, ends automatically) -- mixing a permanent
--      assignment into that table would mean weakening every one of
--      its own date/time WHERE clauses for a lifecycle it was never
--      built to hold. A separate table, mirroring class_teachers'
--      own shape exactly (id/class_id/user_id/started_at/started_by/
--      ended_at/ended_by/end_reason), is the same "one relationship,
--      one table" convention already used for class_teachers/
--      class_children/child_assignments as four independent tables
--      rather than one polymorphic one.
--
--      No 3-slot cap, deliberately -- Daniel's own spec states the cap
--      only for teachers ("up to three"); the SNA-assignment bullet
--      that follows it names none. One partial unique index prevents
--      the same person holding two simultaneously-active rows for the
--      same class (the same sanity constraint class_teachers has via
--      its own class_teachers_one_active_row_per_teacher_per_class),
--      nothing more restrictive.
--
--   4. has_sna_access() -- widened with a fourth branch: an active
--      class_sna_assignments row for a class the child is currently
--      in. Mirrors has_class_teacher_access()'s own class_teachers
--      branch (0104) exactly in shape -- join class_children ->
--      class_sna_assignments -> institution_staff, active standing
--      required on all three. This is the chokepoint by design (0104's
--      own naming) -- widening it correctly, automatically extends
--      "everything for every child in the class" to every screen
--      already gated on has_sna_access(), with no caller-by-caller
--      update needed, because it's a boolean gate, not a data shape.
--      Signature unchanged (still (uuid, uuid) -> boolean) -- CREATE OR
--      REPLACE is sufficient here, no DROP+CREATE needed.
--
--   5. get_sna_roommates(p_passport_id) -- NEW, deliberately narrow.
--      The other half of Daniel's own instruction: "1:1 SNA sees
--      everything for that child wherever they are" is already true
--      today (child_assignments has no class scoping at all -- 0104's
--      own header comment: "structurally independent of class
--      membership... follows the child across the school"). What's
--      missing is "roster-level only for others in the room" -- a 1:1-
--      assigned SNA has ZERO visibility today into the rest of their
--      assigned child's class (class_children's own SELECT policy,
--      0104, is deliberately narrower than has_sna_access() itself:
--      "a class's own current teachers, plus the institution's
--      principal... general institution-wide roster visibility...
--      is Stage 4's [roster tier] to decide, not this one's default"
--      -- PRD 2 Stage 5 is that decision, for this one case).
--      Deliberately NOT the same shape as get_temporary_access_
--      covered_children() (0109), which returns diagnoses/
--      diagnosis_other because a covering SNA gets FULL sna-tier
--      access for the day, for every child in the class. This function
--      returns child_name only -- a real roster tier, narrower than
--      full access, matching Daniel's own words exactly ("roster-level
--      ONLY"). It does not grant has_sna_access() for those other
--      children; it's a name list for a screen to render, not a new
--      access branch. Excludes the caller's own assigned child (the
--      point is "who else is in the room").
--
-- Not needed: a new RPC for the ASSIGNMENT HISTORY accordion on the
-- child profile. child_assignments' own SELECT policy (0104) already
-- lets any active institution staff member read every row directly --
-- exactly the same posture /principal/classes/[classId]/page.tsx
-- already relies on for class_teachers/class_children history, no RPC
-- wrapper needed there either. class_sna_assignments (below) gets the
-- identical policy, so its own history reads the same way, once it
-- exists.

-- =====================================================================
-- 1. get_institution_classes_roster()
-- =====================================================================
create function public.get_institution_classes_roster(p_institution_id uuid)
returns table (
  class_id uuid,
  name text,
  created_at timestamptz,
  teacher_count bigint,
  child_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    c.id as class_id,
    c.name,
    c.created_at,
    (select count(*) from public.class_teachers ct where ct.class_id = c.id and ct.ended_at is null) as teacher_count,
    (select count(*) from public.class_children cc where cc.class_id = c.id and cc.ended_at is null) as child_count
  from public.classes c
  where c.institution_id = p_institution_id
    and public.institution_staff_has_current_standing(auth.uid(), p_institution_id)
  order by c.name;
$$;

grant execute on function public.get_institution_classes_roster(uuid) to authenticated;

-- =====================================================================
-- 2. get_institution_child_roster() widened with current_class_id
-- =====================================================================
drop function if exists public.get_institution_child_roster(uuid);

create function public.get_institution_child_roster(p_institution_id uuid)
returns table (
  passport_id uuid,
  child_name text,
  enrolment_ended_at timestamptz,
  current_class_id uuid
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id as passport_id,
    p.child_name,
    e.ended_at as enrolment_ended_at,
    cc.class_id as current_class_id
  from public.passports p
  join public.passport_institution_links pil on pil.passport_id = p.id
  left join lateral (
    select en.ended_at
    from public.enrolments en
    where en.passport_id = p.id
      and en.institution_id = p_institution_id
    order by en.started_at desc
    limit 1
  ) e on true
  left join public.class_children cc
    on cc.passport_id = p.id
    and cc.ended_at is null
    and cc.class_id in (select cl.id from public.classes cl where cl.institution_id = p_institution_id)
  where pil.institution_id = p_institution_id
    and public.institution_staff_has_current_standing(auth.uid(), p_institution_id)
  order by p.child_name;
$$;

grant execute on function public.get_institution_child_roster(uuid) to authenticated;

-- =====================================================================
-- 3. class_sna_assignments
-- =====================================================================
create table public.class_sna_assignments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  started_at timestamptz not null default now(),
  started_by uuid not null references auth.users (id),
  ended_at timestamptz,
  ended_by uuid references auth.users (id),
  end_reason text,
  constraint class_sna_assignments_end_paired check (
    (ended_at is null and ended_by is null and end_reason is null)
    or (ended_at is not null and ended_by is not null and end_reason is not null)
  )
);

create index class_sna_assignments_class_id_idx on public.class_sna_assignments (class_id);
create index class_sna_assignments_user_id_idx on public.class_sna_assignments (user_id);

create unique index class_sna_assignments_one_active_row_per_sna_per_class
  on public.class_sna_assignments (class_id, user_id)
  where ended_at is null;

alter table public.class_sna_assignments enable row level security;

-- Same breadth as class_teachers' own SELECT policy (0104) -- any
-- active institution staff, not just this class's own teachers or the
-- SNA themselves. Needed for the same reason: any active staff member
-- viewing a class or a child's profile needs to resolve "who is the
-- class SNA here" by name.
create policy "Active staff can view their institution's class SNA rows"
  on public.class_sna_assignments for select to authenticated
  using (
    exists (
      select 1 from public.classes c
      join public.institution_staff s on s.institution_id = c.institution_id
      where c.id = class_sna_assignments.class_id
        and s.user_id = auth.uid()
        and s.deactivated_at is null
        and s.approved_at is not null
    )
  );

-- No client-facing write policy -- assign_class_sna()/
-- end_class_sna_assignment() below are the only write paths, same
-- convention as every other table in this migration's own family.

create or replace function public.assign_class_sna(p_class_id uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class public.classes;
  v_row_id uuid;
begin
  select * into v_class from public.classes where id = p_class_id;
  if not found then
    raise exception 'Class not found.';
  end if;

  if not (
    public.institution_staff_has_current_standing(auth.uid(), v_class.institution_id)
    and exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.institution_id = v_class.institution_id
        and s.role = 'principal'
    )
  ) then
    raise exception 'Only an active principal at this institution can assign a class SNA.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    where s.user_id = p_user_id
      and s.institution_id = v_class.institution_id
      and s.role = 'sna'
      and s.deactivated_at is null
      and s.approved_at is not null
  ) then
    raise exception 'This person must be an active SNA at this institution.';
  end if;

  if exists (
    select 1 from public.class_sna_assignments
    where class_id = p_class_id and user_id = p_user_id and ended_at is null
  ) then
    raise exception 'This person is already the class SNA for this class.';
  end if;

  insert into public.class_sna_assignments (class_id, user_id, started_by)
  values (p_class_id, p_user_id, auth.uid())
  returning id into v_row_id;

  return v_row_id;
end;
$$;

grant execute on function public.assign_class_sna(uuid, uuid) to authenticated;

create or replace function public.end_class_sna_assignment(p_class_sna_assignment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.class_sna_assignments;
  v_institution_id uuid;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required.';
  end if;

  select * into v_row from public.class_sna_assignments where id = p_class_sna_assignment_id;
  if not found then
    raise exception 'Class SNA assignment not found.';
  end if;

  if v_row.ended_at is not null then
    raise exception 'This assignment has already ended.';
  end if;

  select c.institution_id into v_institution_id from public.classes c where c.id = v_row.class_id;

  if not (
    public.institution_staff_has_current_standing(auth.uid(), v_institution_id)
    and exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.institution_id = v_institution_id
        and s.role = 'principal'
    )
  ) then
    raise exception 'Only an active principal at this institution can end a class SNA assignment.';
  end if;

  update public.class_sna_assignments
  set ended_at = now(), ended_by = auth.uid(), end_reason = p_reason
  where id = p_class_sna_assignment_id;
end;
$$;

grant execute on function public.end_class_sna_assignment(uuid, text) to authenticated;

-- =====================================================================
-- 4. has_sna_access() -- fourth branch. Signature unchanged, CREATE OR
-- REPLACE is sufficient.
-- =====================================================================
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
        and (now() at time zone public.app_local_timezone())::time >= '07:30'::time
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

-- =====================================================================
-- 5. get_sna_roommates()
-- =====================================================================
create function public.get_sna_roommates(p_passport_id uuid)
returns table (
  passport_id uuid,
  child_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select p2.id as passport_id, p2.child_name
  from public.child_assignments ca
  join public.institution_staff s on s.user_id = ca.user_id and s.institution_id = ca.institution_id
  join public.class_children cc_mine on cc_mine.passport_id = ca.passport_id and cc_mine.ended_at is null
  join public.class_children cc_other on cc_other.class_id = cc_mine.class_id and cc_other.ended_at is null
  join public.passports p2 on p2.id = cc_other.passport_id
  where ca.passport_id = p_passport_id
    and ca.user_id = auth.uid()
    and ca.ended_at is null
    and s.deactivated_at is null
    and s.approved_at is not null
    and cc_other.passport_id <> p_passport_id;
$$;

grant execute on function public.get_sna_roommates(uuid) to authenticated;
