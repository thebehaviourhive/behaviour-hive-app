-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- "NO SNA REQUIRED" -- a persisted fact, not a per-viewer dismissal.
-- Before this, get_my_class_sna_gaps() (0135/0137) had no way for a
-- teacher to say a child genuinely doesn't need an SNA -- the gap card
-- stayed on the dashboard permanently, indistinguishable from a real
-- unaddressed gap. Daniel's own framing, agreed with: "this child does
-- not require SNA support" is a real statement about the child a
-- principal or a covering teacher benefits from knowing, not a UI
-- state that only hides a card for the one person who dismissed it.
--
-- SCOPED TO (passport_id, institution_id), not to a specific class or
-- to the passport alone. Two reasons: (1) this is a staffing decision
-- a SCHOOL makes about a child it currently teaches, not a permanent
-- clinical pronouncement that should follow the child to a different
-- school were they ever enrolled at one -- the home/school and
-- cross-institution boundaries elsewhere in this schema (CLAUDE.md)
-- push toward institution-scoped, not passport-global. (2) It must
-- survive an ordinary within-school class change (a child moving
-- rooms doesn't change whether they need an SNA), which passport+class
-- scoping would not -- ending the old class_children row would silently
-- drop the fact and resurface the gap for no real reason.
--
-- REVERSIBLE BOTH WAYS: set_child_sna_not_required() records it;
-- clear_child_sna_not_required() is the explicit undo, for the same
-- authorities. And per Daniel's own requirement (b), assigning an SNA
-- LATER must clear the fact rather than contradict it -- both
-- assign_sna_to_child() (1:1) and assign_class_sna() (class-wide,
-- which get_my_class_sna_gaps() itself already treats as satisfying
-- the gap for every child in that class) now delete any matching
-- row(s) as part of the same call. A child can never simultaneously
-- have "does not require an SNA" recorded AND an actual SNA assigned.
--
-- WHO SEES IT: any current, approved, non-deactivated institution
-- staff member at that institution -- same breadth as
-- child_assignments' and class_sna_assignments' own SELECT policies
-- (0104/0129), not narrowed to has_class_teacher_access()/
-- has_sna_access(). A principal reviewing the roster and a covering
-- SNA/teacher who has never had an ordinary grant on this child both
-- need to be able to tell "deliberately not needed" from "nobody's
-- addressed this yet" -- that's the whole point Daniel named. No new
-- UI is added on the principal side in this migration/PR -- the data
-- layer is built so a future principal-facing surface can read it
-- directly, same as child_assignments already is.
--
-- AUTHORITY TO SET/CLEAR: the principal, or a current teacher of the
-- child's own class -- the exact same authorization shape
-- assign_sna_to_child() already uses for "who may act on this child's
-- SNA support", copied verbatim rather than invented fresh.

create table public.child_sna_not_required (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  passport_id uuid not null references public.passports (id) on delete cascade,
  set_by uuid not null references auth.users (id),
  set_at timestamptz not null default now()
);

create unique index child_sna_not_required_one_per_child_per_institution
  on public.child_sna_not_required (passport_id, institution_id);

create index child_sna_not_required_institution_id_idx on public.child_sna_not_required (institution_id);

alter table public.child_sna_not_required enable row level security;

create policy "Active staff can view their institution's SNA-not-required flags"
  on public.child_sna_not_required for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = child_sna_not_required.institution_id
        and s.user_id = auth.uid()
        and s.deactivated_at is null
        and s.approved_at is not null
    )
  );

-- No client-facing write policy -- set_child_sna_not_required()/
-- clear_child_sna_not_required() below are the only write paths, same
-- convention as child_assignments/class_sna_assignments.

-- ---------------------------------------------------------------------
-- set_child_sna_not_required() / clear_child_sna_not_required()
-- ---------------------------------------------------------------------
create or replace function public.set_child_sna_not_required(p_passport_id uuid, p_institution_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_authorized boolean;
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
    raise exception 'Only the principal, or a teacher of this child''s current class, can record this.';
  end if;

  insert into public.child_sna_not_required (institution_id, passport_id, set_by)
  values (p_institution_id, p_passport_id, auth.uid())
  on conflict (passport_id, institution_id) do nothing;
end;
$$;

grant execute on function public.set_child_sna_not_required(uuid, uuid) to authenticated;

create or replace function public.clear_child_sna_not_required(p_passport_id uuid, p_institution_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_authorized boolean;
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
    raise exception 'Only the principal, or a teacher of this child''s current class, can undo this.';
  end if;

  delete from public.child_sna_not_required
  where passport_id = p_passport_id and institution_id = p_institution_id;
end;
$$;

grant execute on function public.clear_child_sna_not_required(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- assign_sna_to_child() (live definition: 0105) -- ONE new statement
-- (clear any "not required" flag on real assignment), everything else
-- unchanged.
-- ---------------------------------------------------------------------
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
  ) or not public.institution_staff_has_current_standing(p_user_id, p_institution_id) then
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

  -- NEW: a real assignment clears any "does not require an SNA" fact
  -- rather than contradicting it.
  delete from public.child_sna_not_required
  where passport_id = p_passport_id and institution_id = p_institution_id;

  return v_row_id;
end;
$$;

grant execute on function public.assign_sna_to_child(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- assign_class_sna() (live definition: 0129) -- ONE new statement
-- (clear "not required" for every child currently in the class, since
-- get_my_class_sna_gaps() itself already treats a class-wide SNA as
-- satisfying the gap for the whole class), everything else unchanged.
-- ---------------------------------------------------------------------
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

  -- NEW: clears "does not require an SNA" for every child currently in
  -- this class -- a class-wide SNA is real coverage for all of them.
  delete from public.child_sna_not_required
  where institution_id = v_class.institution_id
    and passport_id in (
      select passport_id from public.class_children
      where class_id = p_class_id and ended_at is null
    );

  return v_row_id;
end;
$$;

grant execute on function public.assign_class_sna(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- get_my_class_sna_gaps() (live definition: 0137) -- ONE new exclusion,
-- everything else unchanged.
-- ---------------------------------------------------------------------
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
    and not exists (
      select 1 from public.child_sna_not_required snr
      where snr.passport_id = cc.passport_id and snr.institution_id = c.institution_id
    )
  order by c.name, p.child_name;
$$;

grant execute on function public.get_my_class_sna_gaps() to authenticated;
