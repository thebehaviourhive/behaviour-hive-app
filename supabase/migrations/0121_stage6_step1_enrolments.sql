-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 1, Stage 6, Step 1 -- enrolments, the new table Step 0's own recon
-- concluded was needed (not a lifecycle bolted onto
-- passport_institution_links: that table is proven, deliberately
-- multi-valued -- CHECK DD -- and enrolment must be exclusive; those are
-- incompatible constraints on the same row).
--
-- SHAPE: byte-identical to class_children/child_assignments (0104) --
-- started_at/started_by, ended_at/ended_by/end_reason with the same
-- paired CHECK, a partial unique index for "one active per child". No
-- new pattern invented. end_reason is restricted to the three values
-- Stage 6's own scope defines: graduated, left, transferred --
-- 'transferred' names the departure side only; the receiving side of an
-- actual transfer is parked, per Step 0's own decision on Requirement 6.
--
-- COUNT, DONE BEFORE WRITING THIS: zero passports currently hold 2+
-- active passport_institution_links rows in production (checked by
-- direct query, Step 1's own first task). The partial unique index ships
-- as written -- no backfill, no refusal path needed for existing data.
--
-- PROVENANCE (Q2's own answer, reconfirmed): enrolment_id is
-- deliberately NOT added to any existing clinical/incident table here.
-- New artefacts going forward should carry it (nullable, since
-- clinician-authored records may have no enrolment at all to reference);
-- backfilling old rows from enrolment history by time was explicitly
-- rejected -- a guessed enrolment_id would look authoritative and be
-- wrong in exactly the case someone would most want it right
-- (re-enrolment at the same school). Not attempted here; that's each
-- artefact table's own future migration, not this one's.
--
-- THE CASCADE, ON ENDING AN ENROLMENT: mirrors
-- _close_child_access_for_departure() (0104) exactly, child-side instead
-- of staff-side -- class_children, child_assignments, and passport_access
-- for this child at this institution all close. Does NOT touch
-- passport_institution_links.approved_by_parent (that flag belongs to
-- the PARENT's own consent decision; a principal ending an enrolment
-- has no standing to silently clear it, and the institution keeping read
-- access to records it authored is the intended behaviour, the same
-- reason departed staff keep their names on what they wrote). Does NOT
-- touch incidents/owning_teacher_id at all -- confirmed by reading the
-- live edit policy directly: it's gated on owning_teacher_id = auth.uid()
-- plus can_own_incident(), never on ongoing access to the specific
-- child, so an owning teacher can complete an incident about a child
-- whose enrolment has since ended with no new mechanism required. Same
-- answer as 0069's own original decision not to build forced incident
-- reassignment, arrived at independently for the child-departure case.
--
-- Uses institution_staff_has_current_standing() (0105) for the caller
-- check, not a hand-written deactivated_at/approved_at condition --
-- CLAUDE.md's own standing rule after 0119/0120 found three places that
-- got this wrong by hand-writing it.

create table public.enrolments (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  institution_id uuid not null references public.institutions (id) on delete cascade,
  started_at timestamptz not null default now(),
  started_by uuid not null references auth.users (id),
  ended_at timestamptz,
  ended_by uuid references auth.users (id),
  end_reason text check (end_reason in ('graduated', 'left', 'transferred')),
  constraint enrolments_end_paired check (
    (ended_at is null and ended_by is null and end_reason is null)
    or (ended_at is not null and ended_by is not null and end_reason is not null)
  )
);

create index enrolments_passport_id_idx on public.enrolments (passport_id);
create index enrolments_institution_id_idx on public.enrolments (institution_id);

create unique index enrolments_one_active_per_child
  on public.enrolments (passport_id)
  where ended_at is null;

alter table public.enrolments enable row level security;

-- Institution-wide, not class-scoped (enrolment has no class-teacher
-- equivalent to narrow it the way class_children does) -- any currently
-- active, approved staff member at the institution, matching the same
-- caller standard get_institution_child_roster() already uses.
create policy "Active institution staff can view enrolments"
  on public.enrolments for select to authenticated
  using (
    public.institution_staff_has_current_standing(auth.uid(), enrolments.institution_id)
  );

-- No client-facing write policy -- enrol_child()/end_enrolment() are the
-- only write paths, principal-only, matching class_children's own
-- established convention exactly.

-- =====================================================================
-- The cascade. Child-side mirror of _close_child_access_for_departure()
-- (0104) -- same three tables, filtered by passport_id + institution_id
-- instead of user_id + institution_id, since it's the CHILD leaving,
-- not any one staff member.
-- =====================================================================

create or replace function public._close_child_access_for_enrolment_end(
  p_passport_id uuid,
  p_institution_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grants_revoked integer := 0;
  v_grant record;
begin
  for v_grant in
    select id from public.passport_access
    where passport_id = p_passport_id
      and institution_id = p_institution_id
      and is_active = true
  loop
    update public.passport_access set is_active = false where id = v_grant.id;

    insert into public.activity_log (passport_id, actor_id, event_type, event_description)
    values (
      p_passport_id,
      p_actor_id,
      'access_revoked',
      'Access removed (enrolment ended: ' || p_reason || ')'
    );

    v_grants_revoked := v_grants_revoked + 1;
  end loop;

  update public.class_children cc
  set ended_at = now(), ended_by = p_actor_id, end_reason = 'Enrolment ended (' || p_reason || ').'
  from public.classes c
  where cc.class_id = c.id
    and c.institution_id = p_institution_id
    and cc.passport_id = p_passport_id
    and cc.ended_at is null;

  update public.child_assignments
  set ended_at = now(), ended_by = p_actor_id, end_reason = 'Enrolment ended (' || p_reason || ').'
  where institution_id = p_institution_id
    and passport_id = p_passport_id
    and ended_at is null;

  return v_grants_revoked;
end;
$$;

-- =====================================================================
-- enrol_child() -- create_school_passport() (0113) extended to also
-- open the enrolment row, atomically, in the same transaction it
-- already inserts passports + passport_institution_links in -- the
-- identical atomicity reasoning 0113's own comment already gave for
-- passport_institution_links (a passport created without its enrolment
-- in the same transaction would be invisible to any screen that reads
-- "is this child currently enrolled" the moment it's created).
--
-- This is the ONLY enrol path Step 1 builds -- a child that doesn't
-- exist in this system yet. Enrolling an ALREADY-EXISTING passport
-- (transfer-in) is a genuinely different operation (Step 0's own
-- Requirement 6 answer) and is not attempted here, parked with the rest
-- of transfer.
-- =====================================================================

create or replace function public.create_school_passport(p_institution_id uuid, p_child_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_passport_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if coalesce(trim(p_child_name), '') = '' then
    raise exception 'A child name is required.';
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
    raise exception 'Only an active, verified principal can create a passport for their school.';
  end if;

  insert into public.passports (child_name, passport_status)
  values (trim(p_child_name), 'not_started')
  returning id into v_passport_id;

  insert into public.passport_institution_links (passport_id, institution_id, approved_by_parent, parent_approved_at)
  values (v_passport_id, p_institution_id, true, null);

  insert into public.enrolments (passport_id, institution_id, started_by)
  values (v_passport_id, p_institution_id, auth.uid());

  return v_passport_id;
end;
$$;

-- =====================================================================
-- end_enrolment() -- principal-only, refuses an already-ended enrolment,
-- runs the cascade above. The UPDATE's own WHERE ended_at is null is the
-- atomic guard against a concurrent double-end (same pattern as
-- redeem_passport_claim_code()'s own compare-and-swap, 0115) -- checked
-- for the same race this migration's own author already knows to check
-- for, not assumed safe.
-- =====================================================================

create or replace function public.end_enrolment(p_enrolment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrolment public.enrolments;
begin
  if p_reason not in ('graduated', 'left', 'transferred') then
    raise exception 'A valid reason (graduated, left, or transferred) is required to end an enrolment.';
  end if;

  select * into v_enrolment from public.enrolments where id = p_enrolment_id;
  if not found then
    raise exception 'Enrolment not found.';
  end if;

  if v_enrolment.ended_at is not null then
    raise exception 'This enrolment has already ended.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = v_enrolment.institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and inst.status = 'verified'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'Only an active, verified principal at this institution can end an enrolment.';
  end if;

  update public.enrolments
  set ended_at = now(), ended_by = auth.uid(), end_reason = p_reason
  where id = p_enrolment_id
    and ended_at is null;

  if not found then
    raise exception 'This enrolment has already ended.';
  end if;

  perform public._close_child_access_for_enrolment_end(
    v_enrolment.passport_id, v_enrolment.institution_id, auth.uid(), p_reason
  );
end;
$$;

grant execute on function public.end_enrolment(uuid, text) to authenticated;
