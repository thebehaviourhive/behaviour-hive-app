-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 1, Stage 1b/1c: Principal handover. institution_staff_one_
-- principal_per_institution permits one active principal per
-- institution, and deactivate_institution_staff() requires an active
-- principal caller who is not the target -- together, no principal
-- could ever be removed, by anyone. This migration adds the one write
-- path that can: hand_over_principal(), a single atomic transaction
-- that promotes a successor and stands down the predecessor together,
-- so the unique index below never sees two active principals at once.
--
-- DELIBERATE, RECORDED HERE: institution_staff_one_principal_per_
-- institution is NOT widened to include approved_at is not null, even
-- though that's what makes a pending principal impossible (see
-- CLAUDE.md, Deferred work). Widening it would let a second principal-
-- role join sit pending instead of being blocked outright -- and the
-- only thing that could resolve that pending row is approve_staff_
-- join(), unmodified, which sets approved_at and stops. That would
-- leave two simultaneously ACTIVE principals, because the OTHER index
-- (institution_staff_one_active_per_institution) is keyed per-person
-- (institution_id, user_id), not per-institution -- nothing else would
-- catch it. Keeping this index exactly as it is means a second
-- principal-role join is never offered a pending state, active or not
-- -- always blocked outright, always routed to friendlyJoinError()'s
-- message pointing at this function. Handover is the only path to the
-- principal seat. This is a property of the index, chosen deliberately
-- -- not an inherited accident of one written in migration 0068 for a
-- different purpose. Do not widen it later thinking that's a gap.

-- =====================================================================
-- 1. _close_passport_access_for_departure() -- the passport_access
-- cascade, extracted from deactivate_institution_staff() into a shared
-- internal helper so hand_over_principal()'s 'leaving' outcome and
-- ordinary deactivation share ONE implementation of "cascade on
-- departure" rather than two copies that could drift apart. Not
-- granted to authenticated -- it does zero authorization checking of
-- its own and must only ever be reached from another SECURITY DEFINER
-- function that has already verified the caller. Behaviour is
-- byte-for-byte identical to what deactivate_institution_staff() did
-- inline before this migration -- same loop, same event_description
-- text, same return value -- so its own existing adversarial coverage
-- (V-cascade and friends) continues to prove this code path correct
-- without a single check needing to change.
-- =====================================================================

create or replace function public._close_passport_access_for_departure(
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

  return v_grants_revoked;
end;
$$;

-- =====================================================================
-- 2. deactivate_institution_staff() -- unchanged in every observable
-- way (same guards, same order, same UPDATE, same return shape). The
-- only structural change: the cascade loop now lives in the shared
-- helper above instead of inline. Existing checks assert on behaviour,
-- not internal structure, so this should be invisible to all of them.
-- =====================================================================

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

  v_grants_revoked := public._close_passport_access_for_departure(v_target.user_id, v_target.institution_id, auth.uid());

  return jsonb_build_object('deactivated', true, 'grants_revoked', v_grants_revoked);
end;
$$;

-- =====================================================================
-- 3. approval_source gains a fourth value: 'handover'. Neither
-- 'bootstrap' nor 'principal' honestly describes how a row created by
-- this migration's own RPC became active -- it wasn't a self-service
-- first-join, and no one called approve_staff_join(). Located and
-- dropped by its actual definition, not by an assumed name -- the
-- original check was added inline on an ADD COLUMN statement in 0101
-- and never explicitly named, so its auto-generated name isn't
-- something to guess at from a migration file.
-- =====================================================================

do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'public.institution_staff'::regclass
    and pg_get_constraintdef(oid) ilike '%grandfathered%';

  if v_constraint_name is not null then
    execute format('alter table public.institution_staff drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table public.institution_staff
  add constraint institution_staff_approval_source_check
  check (approval_source is null or approval_source in ('grandfathered', 'bootstrap', 'principal', 'handover'));

-- =====================================================================
-- 4. school_notices gains a new notice_type for the successor's
-- notification. No new RLS branch needed -- the existing "principal of
-- a verified institution" SELECT policy already covers the successor,
-- because by the time they read this notice, the same transaction that
-- wrote it has already made them one.
-- =====================================================================

alter table public.school_notices
  drop constraint school_notices_notice_type_check;
alter table public.school_notices
  add constraint school_notices_notice_type_check
  check (notice_type = any (array['incident_parent_call'::text, 'attestation_withdrawn'::text, 'incident_amendment_added'::text, 'staff_join_requested'::text, 'principal_handover'::text]));

-- =====================================================================
-- 5. principal_handovers -- the dedicated, permanent record. No
-- update/delete policy at all, matching institution_staff's own "no
-- UPDATE/DELETE policy" pattern -- only the SECURITY DEFINER RPC below,
-- running with elevated privilege, can write here. Readable by either
-- party named on the record, or by the institution's current active
-- principal. The paired check mirrors institution_staff_approval_
-- source_paired_check's own discipline: an outcome and its consequent
-- facts must agree completely, never partially.
-- =====================================================================

create table public.principal_handovers (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  predecessor_user_id uuid not null references auth.users (id),
  successor_user_id uuid not null references auth.users (id),
  outcome text not null check (outcome in ('leaving', 'staying')),
  staying_role text check (staying_role is null or staying_role in ('class_teacher', 'sna')),
  reason text not null,
  predecessor_institution_staff_id uuid not null references public.institution_staff (id),
  predecessor_new_institution_staff_id uuid references public.institution_staff (id),
  successor_old_institution_staff_id uuid not null references public.institution_staff (id),
  successor_new_institution_staff_id uuid not null references public.institution_staff (id),
  created_at timestamptz not null default now(),
  constraint principal_handovers_staying_role_paired check (
    (outcome = 'staying' and staying_role is not null and predecessor_new_institution_staff_id is not null)
    or (outcome = 'leaving' and staying_role is null and predecessor_new_institution_staff_id is null)
  )
);

create index principal_handovers_institution_id_idx on public.principal_handovers (institution_id);

alter table public.principal_handovers enable row level security;

create policy "Involved parties or the current principal can view handover records"
  on public.principal_handovers for select to authenticated
  using (
    predecessor_user_id = auth.uid()
    or successor_user_id = auth.uid()
    or exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = principal_handovers.institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and s.deactivated_at is null
        and s.approved_at is not null
        and inst.status = 'verified'
    )
  );

-- =====================================================================
-- 6. hand_over_principal() -- the one write path to the principal seat
-- besides the very first bootstrap join. Guard order: input shape
-- first (reason, outcome, staying-role combination), then self-target,
-- then caller authorization (resolves v_institution_id), then successor
-- existence/eligibility -- matching this codebase's established
-- convention throughout 0097/0100/0101.
--
-- ATOMICITY: this entire function is one implicit transaction (a single
-- top-level RPC call, no exception-catching block inside that could
-- swallow a partial failure and let some of it commit). Every guard
-- above runs, and can fail, before any mutating statement executes --
-- so any guard failure this function can produce leaves zero footprint,
-- by construction, not by luck. Postgres's own transactional guarantee
-- covers the rest: if a later statement somehow failed (a constraint
-- violation this function's own guards didn't anticipate), the whole
-- transaction rolls back, full stop. This function does not, and
-- cannot, partially apply.
--
-- STATEMENT ORDER IS THE MECHANISM that keeps
-- institution_staff_one_principal_per_institution from ever seeing two
-- active principals, even transiently within this one transaction: the
-- predecessor's principal row is closed FIRST, unconditionally, before
-- the successor's new principal row is ever inserted. No deferred
-- constraint, no special index behaviour -- just ordering.
--
-- THE AUTH-CLAIM WRITE is the riskiest single statement in this
-- function, not the handover logic around it. auth.users.app_metadata
-- (read by useRequireRole/getPostAuthRedirect on the client, entirely
-- separate from institution_staff.role) is GoTrue-owned and also holds
-- keys this function has no business touching -- provider, providers,
-- and anything else already there. Every write to it below is a merge
-- (coalesce(...) || jsonb_build_object(...)), exactly matching the one
-- existing precedent for writing this column directly from SQL
-- (migration 0017's own backfill) -- never a bare assignment that would
-- silently destroy those other keys and break sign-in in a way that
-- wouldn't obviously trace back to this function.
--
-- ROLE CHANGES NEVER CASCADE: the only call to
-- _close_passport_access_for_departure() in this whole function is on
-- the 'leaving' branch, for the predecessor's own departure. The
-- successor's promotion and the predecessor's staying-demotion both
-- close an old institution_staff row and insert a new one -- the same
-- mechanism institution_staff already uses for every other role/status
-- transition in this table (deactivation, rejection, re-request) -- but
-- neither one touches passport_access. That's the one rule this
-- function and deactivate_institution_staff() must agree on, and this
-- is how: a single p_outcome branch, not two independently-maintained
-- code paths that could drift.
-- =====================================================================

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

  -- Close the predecessor's principal row FIRST, unconditionally --
  -- see the function-level comment on why this ordering is the whole
  -- mechanism that keeps the unique index from ever seeing two active
  -- principals.
  update public.institution_staff
  set deactivated_at = now(),
      deactivated_by = auth.uid(),
      deactivation_reason = p_reason
  where id = v_predecessor.id;

  if p_outcome = 'leaving' then
    v_grants_revoked := public._close_passport_access_for_departure(auth.uid(), v_institution_id, auth.uid());
  else
    -- staying: predecessor's OLD principal row is already closed above.
    -- New row, new role, immediately active -- not run through the
    -- ordinary pending-by-default self-service path, and deliberately
    -- NOT relying on derive_staff_join_approval()'s trigger (which only
    -- auto-approves role='principal' inserts, and wouldn't fire
    -- correctly here anyway -- this insert is role=p_staying_role).
    -- No cascade call on this branch: a role change never cascades.
    insert into public.institution_staff (institution_id, user_id, role)
    values (v_institution_id, auth.uid(), p_staying_role)
    returning id into v_predecessor_new_id;

    update public.institution_staff
    set approved_at = now(), approved_by = auth.uid(), approval_source = 'handover'
    where id = v_predecessor_new_id;
  end if;

  -- The successor: existing row closed with reason role_change, new
  -- principal row inserted, immediately active. This INSERT happens
  -- only now, after the predecessor's principal row is already closed
  -- above -- the ordering that keeps the one-principal index from ever
  -- seeing two principal-role rows satisfying its WHERE clause at once.
  -- No cascade call here either: this is a role change for the
  -- successor, not a departure -- their existing passport_access grants
  -- survive untouched, exactly as written.
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

  -- THE RISKIEST WRITE IN THIS FUNCTION -- see the function-level
  -- comment. Merge, never overwrite.
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

grant execute on function public.hand_over_principal(uuid, text, text, text) to authenticated;
