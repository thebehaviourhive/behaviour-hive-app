-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 1, STAGE 1b: INSTITUTION JOIN APPROVAL. institution_staff's only
-- INSERT policy has ever checked that the caller's real role matches the
-- role they're writing -- nothing has ever checked that anyone at the
-- institution consented. Institution codes are openly readable by
-- design. Under this PRD, institution membership itself confers
-- roster-tier read access to every child in the school -- so an
-- unapproved self-service join stops being an empty-dashboard problem
-- and becomes a real access boundary with nothing behind it.
--
-- This must ship before Stage 1c (principal handover, PRD 2.4c) --
-- handover promotes an existing active staff member to principal, and
-- that's unsafe if the staff member joined through a path nobody vetted.
--
-- THE STATE MODEL, four states on one row, no separate table:
--   pending    -- approved_at null, rejected_at null, deactivated_at null
--   active     -- approved_at set, rejected_at null, deactivated_at null
--   deactivated -- approved_at set, rejected_at null, deactivated_at set
--   rejected   -- approved_at null, rejected_at set, deactivated_at null
-- A rejected row is terminal -- it is never approved after the fact. A
-- later change of heart is a NEW row, matching "reactivation is a new
-- row" from Stage 1. deactivate_institution_staff() and
-- reject_staff_join() are therefore different actions for different
-- states, not two names for the same thing -- see the new guards on
-- deactivate_institution_staff() below.
--
-- THE AUTO-APPROVE RULE, evaluated exactly once, never re-evaluated: a
-- principal-role join is approved immediately if and only if the
-- institution has no active principal AT THE MOMENT THE ROW IS INSERTED.
-- This is a BEFORE INSERT trigger specifically because a trigger has no
-- re-evaluation path -- a queued pending request can never be swept up
-- and auto-approved later, whenever a school happens to lose its
-- principal. If it could, the bootstrap rule would become a way to
-- SEIZE a school rather than a way to START one: submit a request while
-- a principal exists (correctly pending), then simply wait. Evaluating
-- once, at insert, closes that. The narrower residual case -- a fresh
-- request submitted the instant a genuine no-principal window opens --
-- is not new risk this introduces; it's the same bounded exposure the
-- bootstrap rule always accepted (capped at one wrong actor, discoverable
-- the same way a second-principal collision already surfaces today),
-- just narrowed from "any time, ever" to "the instant of a real gap."
-- Not fixed further, deliberately.
--
-- This rule has a second property, not a coincidence: "no active
-- principal" is also true for PRD 2.4c's own abandoned-principal case
-- once Behaviour Hive resolves it out-of-band. The same rule covers a
-- genuinely new institution and a recovered abandoned one, with no
-- second mechanism.
--
-- Every existing row is grandfathered approved, with a null approver --
-- not a fabricated one. Nothing in the old ungated model recorded who
-- "approved" anyone, and inventing an approver would break the same
-- "two honest facts, nothing invented" discipline countersigned_via was
-- built on. approved_by staying null is also how an auto-approved
-- bootstrap row is told apart from a real human decision, forever, with
-- no separate column needed -- a future reader auditing "who approved
-- this" and finding no one did is the correct, honest answer either way.

-- =====================================================================
-- 1. institution_staff -- the approval/rejection columns.
-- =====================================================================

alter table public.institution_staff
  add column approved_at timestamptz,
  add column approved_by uuid references auth.users (id),
  add column rejected_at timestamptz,
  add column rejected_by uuid references auth.users (id),
  add column rejection_reason text;

alter table public.institution_staff
  add constraint institution_staff_rejection_paired_check
  check (
    (rejected_at is null) = (rejected_by is null)
    and (rejected_at is null) = (rejection_reason is null)
  );

alter table public.institution_staff
  add constraint institution_staff_not_approved_and_rejected
  check (not (approved_at is not null and rejected_at is not null));

alter table public.institution_staff
  add constraint institution_staff_not_deactivated_and_rejected
  check (not (deactivated_at is not null and rejected_at is not null));

-- Grandfather every existing row -- approved, null approver, per the
-- header note above.
update public.institution_staff
set approved_at = created_at
where approved_at is null;


-- =====================================================================
-- 2. Widen both Stage 1 partial unique indexes to exclude rejected rows.
-- A rejected row must never permanently occupy the one-principal slot
-- or block a fresh request at the same institution -- "can a rejected
-- person request again at the same school" is yes, and this is the
-- constraint that has to agree.
-- =====================================================================

drop index if exists institution_staff_one_principal_per_institution;
create unique index institution_staff_one_principal_per_institution
  on public.institution_staff (institution_id)
  where role = 'principal' and deactivated_at is null and rejected_at is null;

drop index if exists institution_staff_one_active_per_institution;
create unique index institution_staff_one_active_per_institution
  on public.institution_staff (institution_id, user_id)
  where deactivated_at is null and rejected_at is null;


-- =====================================================================
-- 3. school_notices -- a subject column for this notice type (mirrors
-- the existing incident_id/passport_id shape, one populated per
-- notice_type), and the widened notice_type constraint. The EXISTING
-- "Principal or incident owner can view/acknowledge school notices"
-- policies (0078) need no change: they already route through
-- can_countersign_incident() OR an incident-owner branch that's simply
-- moot when incident_id is null, which it always is for this notice
-- type. Confirmed by reading both policies, not assumed. One accepted
-- side effect, named rather than silently taken: a countersign
-- grant-holder (Deputy Principal) will also see staff-join notices via
-- can_countersign_incident(), even though only the principal role itself
-- can act on them via approve_staff_join()/reject_staff_join() below --
-- an FYI they can't act on, not a new capability, not worth a narrower
-- policy just for this one notice type.
-- =====================================================================

alter table public.school_notices
  add column institution_staff_id uuid references public.institution_staff (id) on delete cascade;

alter table public.school_notices
  drop constraint school_notices_notice_type_check;
alter table public.school_notices
  add constraint school_notices_notice_type_check
  check (notice_type = any (array['incident_parent_call'::text, 'attestation_withdrawn'::text, 'incident_amendment_added'::text, 'staff_join_requested'::text]));


-- =====================================================================
-- 4. derive_staff_join_approval() -- the auto-approve rule itself. See
-- the header note for why this is a BEFORE INSERT trigger and nothing
-- else: evaluated exactly once, no re-evaluation path exists.
-- =====================================================================

create or replace function public.derive_staff_join_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'principal' and not exists (
    select 1 from public.institution_staff s
    where s.institution_id = new.institution_id
      and s.role = 'principal'
      and s.approved_at is not null
      and s.deactivated_at is null
      and s.rejected_at is null
  ) then
    new.approved_at := now();
    -- approved_by stays null -- see header note.
  end if;
  return new;
end;
$$;

drop trigger if exists derive_staff_join_approval on public.institution_staff;
create trigger derive_staff_join_approval
before insert on public.institution_staff
for each row execute function public.derive_staff_join_approval();


-- =====================================================================
-- 5. notify_principal_of_staff_join_request() -- AFTER insert,
-- deliberately: it reads the row post-trigger, so an auto-approved
-- bootstrap principal correctly raises no notice at all (there is no
-- one to notify; approval already happened in the same statement),
-- while a genuinely pending request does.
-- =====================================================================

create or replace function public.notify_principal_of_staff_join_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.approved_at is null and new.rejected_at is null then
    insert into public.school_notices (notice_type, institution_id, institution_staff_id)
    values ('staff_join_requested', new.institution_id, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists notify_principal_of_staff_join_request on public.institution_staff;
create trigger notify_principal_of_staff_join_request
after insert on public.institution_staff
for each row execute function public.notify_principal_of_staff_join_request();


-- =====================================================================
-- 6. approve_staff_join() -- principal-only, same-institution-only,
-- mirrors deactivate_institution_staff()'s own authorization shape.
-- =====================================================================

create or replace function public.approve_staff_join(p_institution_staff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.institution_staff;
  v_caller_is_active_principal boolean;
begin
  select * into v_target from public.institution_staff where id = p_institution_staff_id;
  if not found then
    raise exception 'Staff join request not found.';
  end if;

  if v_target.approved_at is not null then
    raise exception 'This request has already been approved.';
  end if;

  if v_target.rejected_at is not null then
    raise exception 'This request has already been rejected.';
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
    raise exception 'Only an active principal at this institution can approve staff here.';
  end if;

  update public.institution_staff
  set approved_at = now(), approved_by = auth.uid()
  where id = p_institution_staff_id;

  return jsonb_build_object('approved', true);
end;
$$;

grant execute on function public.approve_staff_join(uuid) to authenticated;


-- =====================================================================
-- 7. reject_staff_join() -- same authorization shape, reason required
-- matching deactivate_institution_staff()'s own precedent. Terminal --
-- there is no "un-reject"; a later change of heart is a new request.
-- =====================================================================

create or replace function public.reject_staff_join(p_institution_staff_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.institution_staff;
  v_caller_is_active_principal boolean;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required to reject a staff join request.';
  end if;

  select * into v_target from public.institution_staff where id = p_institution_staff_id;
  if not found then
    raise exception 'Staff join request not found.';
  end if;

  if v_target.approved_at is not null then
    raise exception 'This request has already been approved.';
  end if;

  if v_target.rejected_at is not null then
    raise exception 'This request has already been rejected.';
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
    raise exception 'Only an active principal at this institution can reject staff here.';
  end if;

  update public.institution_staff
  set rejected_at = now(), rejected_by = auth.uid(), rejection_reason = p_reason
  where id = p_institution_staff_id;

  return jsonb_build_object('rejected', true);
end;
$$;

grant execute on function public.reject_staff_join(uuid, text) to authenticated;


-- =====================================================================
-- 8. get_rejected_staff_joins() -- the principal's history view. Lets
-- the client show "requested again after rejection on <date>, for
-- <reason>" when reviewing a new pending request from someone who was
-- rejected before -- the client correlates by user_id, this just
-- supplies the raw history. Principal-only, same shape as everything
-- else here.
-- =====================================================================

create or replace function public.get_rejected_staff_joins(p_institution_id uuid)
returns table (
  id uuid,
  user_id uuid,
  full_name text,
  role text,
  rejected_at timestamptz,
  rejected_by_name text,
  rejection_reason text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.id,
    s.user_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    s.role,
    s.rejected_at,
    coalesce(ru.raw_user_meta_data ->> 'full_name', ru.raw_app_meta_data ->> 'full_name') as rejected_by_name,
    s.rejection_reason,
    s.created_at
  from public.institution_staff s
  join auth.users u on u.id = s.user_id
  left join auth.users ru on ru.id = s.rejected_by
  where s.institution_id = p_institution_id
    and s.rejected_at is not null
    and exists (
      select 1 from public.institution_staff s2
      join public.institutions inst on inst.id = s2.institution_id
      where s2.institution_id = p_institution_id
        and s2.user_id = auth.uid()
        and s2.role = 'principal'
        and s2.approved_at is not null
        and s2.deactivated_at is null
        and inst.status = 'verified'
    )
  order by s.rejected_at desc;
$$;

grant execute on function public.get_rejected_staff_joins(uuid) to authenticated;


-- =====================================================================
-- 9. deactivate_institution_staff() -- two new guards. Deactivate means
-- "close out someone who WAS active" -- a pending row was never active
-- (point them at reject_staff_join() instead) and a rejected row is
-- already terminal (nothing to close out). Full body, verbatim from
-- 0097, plus these two guards and approved_at is not null added to both
-- the caller check and the last-principal check.
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
  v_target_name text;
  v_caller_is_active_principal boolean;
  v_grants_revoked integer := 0;
  v_grant record;
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

  select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name')
  into v_target_name
  from auth.users u
  where u.id = v_target.user_id;

  for v_grant in
    select id, passport_id
    from public.passport_access
    where teacher_id = v_target.user_id
      and institution_id = v_target.institution_id
      and is_active = true
  loop
    update public.passport_access set is_active = false where id = v_grant.id;

    insert into public.activity_log (passport_id, actor_id, event_type, event_description)
    values (
      v_grant.passport_id,
      auth.uid(),
      'access_revoked',
      'Access removed for ' || coalesce(v_target_name, 'a staff member') || ' (staff member deactivated)'
    );

    v_grants_revoked := v_grants_revoked + 1;
  end loop;

  return jsonb_build_object('deactivated', true, 'grants_revoked', v_grants_revoked);
end;
$$;


-- =====================================================================
-- 10. get_staff_deactivation_preview() -- approved_at is not null added
-- to the caller check. Full body, verbatim from 0098.
-- =====================================================================

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


-- =====================================================================
-- 11. can_countersign_incident() -- approved_at is not null added to
-- both branches. Full body, verbatim from 0097.
-- =====================================================================

create or replace function public.can_countersign_incident(p_user_id uuid, p_institution_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = p_user_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  )
  or exists (
    select 1 from public.institution_permissions p
    join public.institutions inst on inst.id = p.institution_id
    join public.institution_staff s
      on s.institution_id = p.institution_id and s.user_id = p.user_id
    where p.institution_id = p_institution_id
      and p.user_id = p_user_id
      and p.permission = 'countersign_incident'
      and p.revoked_at is null
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  );
$$;


-- =====================================================================
-- 12. guard_institution_permissions_grantee_is_staff() -- approved_at
-- is not null added.
-- =====================================================================

create or replace function public.guard_institution_permissions_grantee_is_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.institution_staff s
    where s.institution_id = new.institution_id
      and s.user_id = new.user_id
      and s.deactivated_at is null
      and s.approved_at is not null
  ) then
    raise exception 'Cannot grant % -- user % is not an active member of institution_staff at institution %.',
      new.permission, new.user_id, new.institution_id;
  end if;
  return new;
end;
$$;


-- =====================================================================
-- 13. guard_institution_permissions_last_holder() -- approved_at is not
-- null added to both branches.
-- =====================================================================

create or replace function public.guard_institution_permissions_last_holder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.revoked_at is not null and old.revoked_at is null and new.permission = 'countersign_incident' then
    if not exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = new.institution_id
        and s.role = 'principal'
        and s.deactivated_at is null
        and s.approved_at is not null
        and inst.status = 'verified'
    ) and not exists (
      select 1 from public.institution_permissions p2
      join public.institution_staff s2
        on s2.institution_id = p2.institution_id and s2.user_id = p2.user_id
      where p2.institution_id = new.institution_id
        and p2.permission = 'countersign_incident'
        and p2.revoked_at is null
        and p2.id <> new.id
        and s2.deactivated_at is null
        and s2.approved_at is not null
    ) then
      raise exception 'Cannot revoke -- this is the last active countersign holder at institution %. This institution has no principal; revoking this grant would leave nobody able to countersign.',
        new.institution_id;
    end if;
  end if;
  return new;
end;
$$;


-- =====================================================================
-- 14. Vocabulary tables -- 8 identical policies, approved_at is not
-- null added.
-- =====================================================================

alter policy "Vocabulary is readable by global default or own institution"
  on public.incident_action_types
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = incident_action_types.institution_id
      and s.user_id = auth.uid() and s.deactivated_at is null and s.approved_at is not null
  ));

alter policy "Vocabulary is readable by global default or own institution"
  on public.incident_recovery_types
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = incident_recovery_types.institution_id
      and s.user_id = auth.uid() and s.deactivated_at is null and s.approved_at is not null
  ));

alter policy "Vocabulary is readable by global default or own institution"
  on public.cpi_reason_types
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = cpi_reason_types.institution_id
      and s.user_id = auth.uid() and s.deactivated_at is null and s.approved_at is not null
  ));

alter policy "Vocabulary is readable by global default or own institution"
  on public.cpi_disengagement_types
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = cpi_disengagement_types.institution_id
      and s.user_id = auth.uid() and s.deactivated_at is null and s.approved_at is not null
  ));

alter policy "Vocabulary is readable by global default or own institution"
  on public.cpi_result_types
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = cpi_result_types.institution_id
      and s.user_id = auth.uid() and s.deactivated_at is null and s.approved_at is not null
  ));

alter policy "Vocabulary is readable by global default or own institution"
  on public.incident_injury_types
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = incident_injury_types.institution_id
      and s.user_id = auth.uid() and s.deactivated_at is null and s.approved_at is not null
  ));

alter policy "Vocabulary is readable by global default or own institution"
  on public.incident_locations
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = incident_locations.institution_id
      and s.user_id = auth.uid() and s.deactivated_at is null and s.approved_at is not null
  ));

alter policy "Vocabulary is readable by global default or own institution"
  on public.incident_body_regions
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = incident_body_regions.institution_id
      and s.user_id = auth.uid() and s.deactivated_at is null and s.approved_at is not null
  ));


-- =====================================================================
-- 15. Location editing -- approved_at is not null added, both policies.
-- =====================================================================

alter policy "Principals can add locations for their own institution"
  on public.incident_locations
  with check (
    institution_id is not null
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = incident_locations.institution_id
        and s.user_id = auth.uid() and s.role = 'principal'
        and s.deactivated_at is null and s.approved_at is not null
    )
  );

alter policy "Principals can edit locations for their own institution"
  on public.incident_locations
  using (
    institution_id is not null
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = incident_locations.institution_id
        and s.user_id = auth.uid() and s.role = 'principal'
        and s.deactivated_at is null and s.approved_at is not null
    )
  )
  with check (
    institution_id is not null
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = incident_locations.institution_id
        and s.user_id = auth.uid() and s.role = 'principal'
        and s.deactivated_at is null and s.approved_at is not null
    )
  );


-- =====================================================================
-- 16. create_incident_stamp() -- approved_at is not null added. Full
-- body, verbatim from 0097.
-- =====================================================================

create or replace function public.create_incident_stamp(
  p_institution_id uuid,
  p_occurred_at timestamptz,
  p_location_id uuid,
  p_child_passport_ids uuid[],
  p_staff jsonb  -- array of {"user_id": uuid} or {"free_text_name": text}, optional "involvement" (defaults 'involved')
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_incident_id uuid;
  v_child_count integer;
  v_child_index text;
  v_passport_id uuid;
  v_i integer;
  v_staff_entry jsonb;
  v_user_id uuid;
  v_free_text_name text;
  v_involvement text;
begin
  select role into v_caller_role
  from public.institution_staff
  where institution_id = p_institution_id
    and user_id = auth.uid()
    and deactivated_at is null
    and approved_at is not null;

  if v_caller_role is null or v_caller_role not in ('class_teacher', 'sna', 'principal') then
    raise exception 'You are not registered as school staff at this institution.';
  end if;

  if p_child_passport_ids is null or array_length(p_child_passport_ids, 1) is null or array_length(p_child_passport_ids, 1) = 0 then
    raise exception 'At least one child is required.';
  end if;
  v_child_count := array_length(p_child_passport_ids, 1);
  if v_child_count > 2 then
    raise exception 'An incident can name at most two children.';
  end if;

  v_incident_id := gen_random_uuid();

  insert into public.incidents (id, institution_id, created_by, owning_teacher_id, occurred_at, location_id)
  values (
    v_incident_id, p_institution_id, auth.uid(),
    case when v_caller_role = 'class_teacher' then auth.uid() else null end,
    p_occurred_at, p_location_id
  );

  v_i := 0;
  foreach v_passport_id in array p_child_passport_ids
  loop
    if not exists (
      select 1 from public.passport_institution_links pil
      where pil.passport_id = v_passport_id and pil.institution_id = p_institution_id
    ) then
      raise exception 'Child % is not connected to this institution.', v_passport_id;
    end if;

    v_child_index := case when v_i = 0 then 'A' else 'B' end;
    insert into public.incident_children (incident_id, passport_id, child_index, added_by)
    values (v_incident_id, v_passport_id, v_child_index, auth.uid());
    v_i := v_i + 1;
  end loop;

  if p_staff is not null then
    for v_staff_entry in select * from jsonb_array_elements(p_staff)
    loop
      v_user_id := nullif(v_staff_entry ->> 'user_id', '')::uuid;
      v_free_text_name := nullif(v_staff_entry ->> 'free_text_name', '');
      v_involvement := coalesce(nullif(v_staff_entry ->> 'involvement', ''), 'involved');

      if v_user_id is null and v_free_text_name is null then
        raise exception 'Each staff entry needs either user_id or free_text_name.';
      end if;
      if v_involvement not in ('involved', 'witnessed') then
        raise exception 'Invalid involvement value: %', v_involvement;
      end if;

      insert into public.incident_staff (incident_id, user_id, free_text_name, involvement)
      values (v_incident_id, v_user_id, v_free_text_name, v_involvement);
    end loop;
  end if;

  return v_incident_id;
end;
$$;


-- =====================================================================
-- 17. claim_incident() -- approved_at is not null added. Full body,
-- verbatim from 0097.
-- =====================================================================

create or replace function public.claim_incident(p_incident_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_institution_id uuid;
begin
  select institution_id into v_institution_id
  from public.incidents
  where id = p_incident_id and owning_teacher_id is null and teacher_signed_at is null;

  if v_institution_id is null then
    raise exception 'This incident cannot be claimed -- it may already have an owning teacher, be signed off, or not exist.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    where s.institution_id = v_institution_id
      and s.user_id = auth.uid()
      and s.role = 'class_teacher'
      and s.deactivated_at is null
      and s.approved_at is not null
  ) then
    raise exception 'Only a class teacher at this institution can claim an incident.';
  end if;

  update public.incidents set owning_teacher_id = auth.uid() where id = p_incident_id;
end;
$$;


-- =====================================================================
-- 18. mark_parent_called() -- approved_at is not null added to the
-- principal branch. Full body, verbatim from 0097.
-- =====================================================================

create or replace function public.mark_parent_called(p_incident_children_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident_id uuid;
begin
  select incident_id into v_incident_id from public.incident_children where id = p_incident_children_id;
  if v_incident_id is null then
    raise exception 'Not found, or you do not have permission.';
  end if;

  if not exists (
    select 1 from public.incidents i
    where i.id = v_incident_id
      and (
        i.created_by = auth.uid()
        or i.owning_teacher_id = auth.uid()
        or exists (
          select 1 from public.institution_staff s
          join public.institutions inst on inst.id = s.institution_id
          where s.institution_id = i.institution_id
            and s.user_id = auth.uid()
            and s.role = 'principal'
            and s.deactivated_at is null
            and s.approved_at is not null
            and inst.status = 'verified'
        )
      )
  ) then
    raise exception 'You do not have permission to mark this parent as called.';
  end if;

  update public.incident_children
  set parent_called_at = now(), parent_called_by = auth.uid()
  where id = p_incident_children_id;
end;
$$;


-- =====================================================================
-- 19. passport_access -- both grant-creation policies, approved_at is
-- not null added.
-- =====================================================================

alter policy "Teachers can insert access for approved, matching institutions"
  on public.passport_access
  with check (
    auth.uid() = teacher_id
    and passport_access.actor_role = public.current_user_role()
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = passport_access.institution_id
        and s.user_id = auth.uid()
        and s.deactivated_at is null
        and s.approved_at is not null
    )
    and exists (
      select 1 from public.passport_institution_links pil
      where pil.passport_id = passport_access.passport_id
        and pil.institution_id = passport_access.institution_id
        and pil.approved_by_parent = true
    )
  );

alter policy "Teachers can reactivate their own revoked access"
  on public.passport_access
  using (
    teacher_id = auth.uid()
    and is_active = false
  )
  with check (
    teacher_id = auth.uid()
    and is_active = true
    and passport_access.actor_role = public.current_user_role()
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = passport_access.institution_id
        and s.user_id = auth.uid()
        and s.deactivated_at is null
        and s.approved_at is not null
    )
    and exists (
      select 1 from public.passport_institution_links pil
      where pil.passport_id = passport_access.passport_id
        and pil.institution_id = passport_access.institution_id
        and pil.approved_by_parent = true
    )
  );


-- =====================================================================
-- 20. get_institution_staff_roster() -- p_include_pending added
-- alongside p_include_inactive, a status pair (is_active/is_pending)
-- replaces the old single is_active boolean, and the caller gate now
-- requires approved_at is not null (unlike deactivated_at, which stays
-- unguarded on the caller for the historical-resolution reason Stage 1
-- already established).
--
-- THE NUANCE, spelled out here because a future reader will otherwise
-- "fix" it by adding a second toggle: p_include_inactive toggles
-- deactivated_at only, never approved_at. A deactivated person was once
-- genuinely active and may be legitimately named on real historical
-- records -- that's Stage 1's own reasoning, unchanged, and it's why
-- deactivated_at stays a toggle. A pending or rejected person was NEVER
-- active and cannot be named on anything, because every write path here
-- already requires approval before it will act at all. So
-- "approved_at is not null" is unconditional in the WHERE clause below,
-- not a second flag to pass -- do not add a p_include_pending_in_
-- deactivated_view knob or similar; that would resurface pending/
-- rejected people as if they'd once had standing they never had.
-- p_include_pending exists for exactly one purpose: letting the
-- principal's OWN staff-list screen show pending rows explicitly,
-- separately from the deactivated toggle, which is a different question
-- (departed vs. never-arrived).
-- =====================================================================

drop function if exists public.get_institution_staff_roster(uuid, boolean);

create function public.get_institution_staff_roster(
  p_institution_id uuid,
  p_include_inactive boolean default false,
  p_include_pending boolean default false
)
returns table (
  id uuid,
  user_id uuid,
  full_name text,
  role text,
  is_active boolean,
  is_pending boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.id,
    s.user_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    s.role,
    (s.approved_at is not null and s.deactivated_at is null) as is_active,
    (s.approved_at is null and s.deactivated_at is null) as is_pending
  from public.institution_staff s
  join auth.users u on u.id = s.user_id
  where s.institution_id = p_institution_id
    and s.rejected_at is null
    and (
      (s.approved_at is not null and (p_include_inactive or s.deactivated_at is null))
      or (p_include_pending and s.approved_at is null and s.deactivated_at is null)
    )
    and exists (
      select 1 from public.institution_staff s2
      where s2.institution_id = p_institution_id
        and s2.user_id = auth.uid()
        and s2.approved_at is not null
    )
  order by full_name;
$$;

grant execute on function public.get_institution_staff_roster(uuid, boolean, boolean) to authenticated;


-- =====================================================================
-- 21. get_institution_child_roster() -- approved_at is not null added
-- to the caller gate (deactivated_at stays unguarded there, unchanged,
-- for the same historical-resolution reason as item 20 -- a pending or
-- rejected caller has never had standing to call this at all, and
-- adding this filter cannot break resolving names on records they were
-- never on in the first place).
-- =====================================================================

create or replace function public.get_institution_child_roster(p_institution_id uuid)
returns table (
  passport_id uuid,
  child_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select p.id as passport_id, p.child_name
  from public.passports p
  join public.passport_institution_links pil on pil.passport_id = p.id
  where pil.institution_id = p_institution_id
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and s.approved_at is not null
    )
  order by p.child_name;
$$;
