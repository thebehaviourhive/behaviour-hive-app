-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 1, Stage 7, Step 1 -- clinician_access.engaged_by and split
-- revocation authority. The last stage of PRD 1. Full design decided in
-- Step 0's own recon; this migration is that recon executed, not a new
-- round of decisions.
--
-- SHAPE: engaged_by ('parent' | 'institution') + engaged_by_institution_id
-- (paired, null iff parent), plus the four audit columns this table has
-- never had at all -- granted_by, revoked_at, revoked_by,
-- revocation_reason -- matching passport_access's own shape. Backfill:
-- every existing row gets engaged_by = 'parent' (the only thing that has
-- ever been possible); granted_by stays NULL on backfilled rows,
-- deliberately -- there is no record of who granted them, and a guessed
-- value would be a false statement in an audit trail, the same reasoning
-- that kept 0113 from backdating parent_approved_at and 0121 from
-- backfilling enrolment_id onto old artefacts.
--
-- WRITE PATHS: converted to real RPCs on BOTH sides, not just the new
-- institution one. The two existing bare RLS-gated client writes
-- (ShareBottomSheet.tsx's insert/reactivate, passport/dashboard/
-- page.tsx's revoke) are exactly the shape that let
-- passport_institution_links' own teacher-view policy go wrong twice --
-- an RPC makes the reason and the audit trail structural, not client
-- discipline. The old INSERT/UPDATE policies are dropped; only the RPCs
-- can write from here on. SELECT policies are untouched and need no
-- change for parent-side visibility: "Parents can view clinicians
-- connected to their own passport" was never engaged_by-scoped (just
-- owns_passport(passport_id)), so a parent already sees an
-- institution-engaged clinician on their own child's passport the moment
-- one exists -- the symmetry Step 0 asked for is already there at the
-- data layer; surfacing engaged_by in the parent's own UI is Step 2's
-- job, not this migration's.
--
-- THREE INDEPENDENT REVOKE AUTHORITIES, never each other's: a parent
-- revokes their own engaged_by='parent' rows; a principal revokes their
-- own institution's engaged_by='institution' rows; a clinician revokes
-- ANY row that's their own, regardless of engaged_by -- a third,
-- orthogonal path (their own professional decision to step back, not
-- either authority acting), requiring their own free-text reason, same
-- as everyone else. revoke_clinician_access() below is the single RPC
-- for all three, branching on which authority the caller actually has.
--
-- THE DOUBLE-ENGAGEMENT REFUSAL: unique(passport_id, clinician_id) means
-- the same clinician cannot be both parent- and institution-engaged for
-- the same child. Left as a real, named limitation (CLAUDE.md gets its
-- own entry) -- solving it means a second row with two authorities on
-- one relationship, more complexity than the case currently justifies.
-- What DOES need building: the refusal itself. Both grant_clinician_
-- access() and connect_clinician() check the OTHER authority's
-- engagement first and refuse with a message explaining why, before
-- ever reaching the table's own unique constraint -- a client should
-- never see a raw "duplicate key value violates unique constraint".
--
-- THE ENROLMENT-END CASCADE: _close_child_access_for_enrolment_end()
-- (0121) gets a fourth clause, closing clinician_access rows where
-- engaged_by = 'institution' AND engaged_by_institution_id = the ending
-- institution -- mirroring exactly how it already closes passport_access,
-- filtered the same way, isolated the same way (CHECK JJ's own JJ-5d is
-- the template for the equivalent clinician check Step 2's own coverage
-- will need). Parent-engaged clinicians are completely untouched by
-- this, same reasoning as approved_by_parent staying untouched: a
-- school-side event has no authority over a relationship the parent
-- holds.
--
-- WHAT DOES NOT CHANGE, confirmed deliberately: deactivate_institution_
-- staff() and hand_over_principal() are NOT touched, and never call
-- anything clinician-related. The engagement belongs to the institution
-- (engaged_by_institution_id), not the staff member who happened to
-- click grant -- the same way a class survives its teacher leaving. A
-- principal handover, or the departure of whichever staff member
-- originally connected a clinician, does nothing to that clinician's
-- access.

-- =====================================================================
-- 1. Schema: engaged_by + the four audit columns passport_access
--    already has and this table never did.
-- =====================================================================

alter table public.clinician_access
  add column engaged_by text not null default 'parent' check (engaged_by in ('parent', 'institution')),
  add column engaged_by_institution_id uuid references public.institutions (id),
  add column granted_by uuid references auth.users (id),
  add column revoked_at timestamptz,
  add column revoked_by uuid references auth.users (id),
  add column revocation_reason text;

alter table public.clinician_access
  add constraint clinician_access_engaged_by_paired check (
    (engaged_by = 'parent' and engaged_by_institution_id is null)
    or (engaged_by = 'institution' and engaged_by_institution_id is not null)
  );

alter table public.clinician_access
  add constraint clinician_access_revoked_paired check (
    (revoked_at is null and revoked_by is null and revocation_reason is null)
    or (revoked_at is not null and revoked_by is not null and revocation_reason is not null)
  );

-- =====================================================================
-- 2. Drop the two write policies -- from here on, only the RPCs below
--    can insert or update this table. SELECT policies (parent's own
--    view, clinician's own view) are untouched -- read access doesn't
--    need to change shape, only who may write.
-- =====================================================================

drop policy if exists "Parents can connect a clinician to their own passport" on public.clinician_access;
drop policy if exists "Parents can revoke clinician access on their own passport" on public.clinician_access;

-- =====================================================================
-- 3. New: principal visibility. The only new SELECT policy this
--    migration adds -- a principal at an institution this child is
--    genuinely linked to sees EVERY clinician connected to that child,
--    parent-engaged or institution-engaged alike (care coordination --
--    a principal who can't see a private psychologist is already
--    connected may duplicate or contradict that work). Revoke authority
--    stays separately scoped inside revoke_clinician_access() itself;
--    this policy only grants sight, never write.
-- =====================================================================

create policy "Principals can view clinicians connected to their institution's linked children"
  on public.clinician_access
  for select
  to authenticated
  using (
    exists (
      select 1 from public.passport_institution_links pil
      join public.institution_staff s on s.institution_id = pil.institution_id
      where pil.passport_id = clinician_access.passport_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  );

-- =====================================================================
-- 4. connect_clinician() -- the parent-side write, converted from
--    ShareBottomSheet.tsx's own raw insert/update. Same code-lookup
--    shape as before (lookup_clinician_by_code() stays as the
--    read-only preview that RPC already was); this is what actually
--    performs the write, with engaged_by stamped and the cross-
--    authority refusal in place before the table's own unique
--    constraint is ever reached.
-- =====================================================================

create or replace function public.connect_clinician(
  p_passport_id uuid,
  p_clinician_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinician_id uuid;
  v_existing public.clinician_access;
  v_row_id uuid;
begin
  if not public.owns_passport(p_passport_id) then
    raise exception 'Only this child''s own parent or guardian can connect a clinician.';
  end if;

  select c.user_id into v_clinician_id
  from public.clinicians c
  where c.clinician_code = p_clinician_code
    and c.verification_status = 'verified';

  if v_clinician_id is null then
    raise exception 'We couldn''t find a clinician with that code. Please check with them and try again.';
  end if;

  select * into v_existing
  from public.clinician_access
  where passport_id = p_passport_id and clinician_id = v_clinician_id;

  if found then
    -- THE DOUBLE-ENGAGEMENT REFUSAL: explained, not a constraint violation.
    if v_existing.engaged_by = 'institution' then
      raise exception 'This clinician is already connected to your child through their school and cannot be reconnected here. Contact the school if you''d like this changed.';
    end if;

    -- same authority (parent) -- ordinary duplicate/reactivate.
    if v_existing.is_active then
      raise exception 'This clinician already has active access to this child.';
    end if;

    update public.clinician_access
    set is_active = true,
        linked_at = now(),
        granted_by = auth.uid(),
        revoked_at = null,
        revoked_by = null,
        revocation_reason = null
    where id = v_existing.id
    returning id into v_row_id;
    return v_row_id;
  end if;

  insert into public.clinician_access (passport_id, clinician_id, engaged_by, granted_by)
  values (p_passport_id, v_clinician_id, 'parent', auth.uid())
  returning id into v_row_id;

  return v_row_id;
end;
$$;

grant execute on function public.connect_clinician(uuid, text) to authenticated;

-- =====================================================================
-- 5. grant_clinician_access() -- the new institution-side write.
--    Principal-only, requires the child to already be linked to their
--    institution (same "This child has no link to your institution"
--    guard grant_passport_access() already uses), same code-based
--    lookup and double-engagement refusal shape as connect_clinician().
-- =====================================================================

create or replace function public.grant_clinician_access(
  p_institution_id uuid,
  p_passport_id uuid,
  p_clinician_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinician_id uuid;
  v_existing public.clinician_access;
  v_row_id uuid;
begin
  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and inst.status = 'verified'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'Only an active, verified principal can connect a clinician for their school.';
  end if;

  if not exists (
    select 1 from public.passport_institution_links pil
    where pil.passport_id = p_passport_id and pil.institution_id = p_institution_id
  ) then
    raise exception 'This child has no link to your institution.';
  end if;

  select c.user_id into v_clinician_id
  from public.clinicians c
  where c.clinician_code = p_clinician_code
    and c.verification_status = 'verified';

  if v_clinician_id is null then
    raise exception 'We couldn''t find a clinician with that code. Please check with them and try again.';
  end if;

  select * into v_existing
  from public.clinician_access
  where passport_id = p_passport_id and clinician_id = v_clinician_id;

  if found then
    -- THE DOUBLE-ENGAGEMENT REFUSAL, both directions.
    if v_existing.engaged_by = 'parent' then
      raise exception 'This clinician is already engaged by this child''s parent or guardian. A school cannot take over a parent''s own clinical engagement -- if your school needs its own involvement, connect a different clinician, or ask the family to make the introduction.';
    end if;
    if v_existing.engaged_by_institution_id <> p_institution_id then
      raise exception 'This clinician was engaged by a different school for this child and cannot be reactivated here.';
    end if;

    -- same authority (this institution) -- ordinary duplicate/reactivate.
    if v_existing.is_active then
      raise exception 'This clinician already has active access to this child.';
    end if;

    update public.clinician_access
    set is_active = true,
        linked_at = now(),
        granted_by = auth.uid(),
        revoked_at = null,
        revoked_by = null,
        revocation_reason = null
    where id = v_existing.id
    returning id into v_row_id;
    return v_row_id;
  end if;

  insert into public.clinician_access (passport_id, clinician_id, engaged_by, engaged_by_institution_id, granted_by)
  values (p_passport_id, v_clinician_id, 'institution', p_institution_id, auth.uid())
  returning id into v_row_id;

  return v_row_id;
end;
$$;

grant execute on function public.grant_clinician_access(uuid, uuid, text) to authenticated;

-- =====================================================================
-- 6. revoke_clinician_access() -- the single RPC for all three
--    independent authorities. Branches on which one the caller actually
--    has; never lets one act on another's behalf. A reason is required
--    from all three -- including the clinician's own self-revoke,
--    free-text, theirs to state, not a fixed list.
-- =====================================================================

create or replace function public.revoke_clinician_access(
  p_clinician_access_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.clinician_access;
  v_authorized boolean := false;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required.';
  end if;

  select * into v_row from public.clinician_access where id = p_clinician_access_id;
  if not found then
    raise exception 'Not found.';
  end if;

  if not v_row.is_active then
    raise exception 'This access has already been revoked.';
  end if;

  -- Self-revoke: the clinician's own professional decision, orthogonal
  -- to engaged_by -- always available regardless of who engaged them.
  if v_row.clinician_id = auth.uid() then
    v_authorized := true;
  elsif v_row.engaged_by = 'parent' and public.owns_passport(v_row.passport_id) then
    v_authorized := true;
  elsif v_row.engaged_by = 'institution' and exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = v_row.engaged_by_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and inst.status = 'verified'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    v_authorized := true;
  end if;

  if not v_authorized then
    raise exception 'You do not have authority to revoke this clinician''s access.';
  end if;

  update public.clinician_access
  set is_active = false,
      revoked_at = now(),
      revoked_by = auth.uid(),
      revocation_reason = trim(p_reason)
  where id = p_clinician_access_id
    and is_active = true;

  if not found then
    raise exception 'This access has already been revoked.';
  end if;
end;
$$;

grant execute on function public.revoke_clinician_access(uuid, text) to authenticated;

-- =====================================================================
-- 7. The enrolment-end cascade, extended. Fourth clause, same
--    institution_id-filtered shape as the other three -- closes ONLY
--    engaged_by = 'institution' rows for the institution whose
--    enrolment just ended. Parent-engaged rows are untouched by
--    construction (the WHERE clause never matches them).
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

  -- The new clause: school-engaged clinicians close the same way
  -- passport_access does above. Parent-engaged rows never match this
  -- WHERE clause, by construction.
  update public.clinician_access
  set is_active = false,
      revoked_at = now(),
      revoked_by = p_actor_id,
      revocation_reason = 'Enrolment ended (' || p_reason || ').'
  where passport_id = p_passport_id
    and engaged_by = 'institution'
    and engaged_by_institution_id = p_institution_id
    and is_active = true;

  return v_grants_revoked;
end;
$$;
