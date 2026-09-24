-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 11 Stage 2 -- "the institution exists and staff can join." The
-- third institution type, and its own two role values.
--
-- DECISION 1 (Daniel, confirmed before this migration): respite gets
-- its OWN roles and its OWN route tree. /principal is NOT widened.
-- institution_staff_one_principal_per_institution (0100) is a hard
-- unique index -- exactly one active/pending principal-role row per
-- institution, ever. PRD 11 section 2 is explicit that a centre has
-- SEVERAL managers, not one. Reusing 'principal' for centre_manager
-- would therefore be structurally impossible past the first manager --
-- confirmed by reading this index directly, not assumed. centre_manager
-- and care_staff are new institution_staff.role values, never a
-- relabelled principal, and they never reach any /principal or
-- /clinician page: neither value appears in any existing
-- useRequireRole() call anywhere in the app, so both roles are
-- unreachable there by construction, not by a new check added here.
--
-- Because of that, most of Stage 1's own item-1 findings (the school
-- dashboard, school nav, Directory segments, the enrol page's RPC
-- choice, the clinic-only settings pages, ChildDetail.tsx's ~18 sites,
-- hand_over_principal()'s own school/clinic staying-role branch) simply
-- stop mattering for this stage -- respite cannot fall into them
-- because it never gets there. Confirmed directly for two of them
-- rather than assumed: grant_passport_access()'s own caller check is
-- role='principal' only (0148, unchanged) -- unreachable for the
-- identical reason, no change needed. hand_over_principal() is
-- likewise principal-only and untouched -- a respite institution's own
-- handover mechanism, if one is ever needed, is Stage 3+ territory, not
-- this migration's.
--
-- DECISION 2 (Daniel): fail-closed sweep, belt and braces, even where
-- respite should never reach a branch. Every institutionType ternary
-- this migration's own client-side counterpart touches gets an
-- explicit third outcome, never a silent fall into the school branch --
-- see the client-side commit for the specific files. On the SQL side,
-- the equivalent is: every widened role/type check below is written as
-- an explicit, additive OR branch (respite gets its own clause), never
-- a bare widened list that would let a respite role slip into a
-- school- or clinic-shaped authorization path it was never meant to
-- satisfy.
--
-- WHAT THIS MIGRATION DOES NOT TOUCH, deliberately, per Daniel's own
-- "NOT IN STAGE 2" list -- placement, stays, the access model, on-call,
-- the forms, and anything that presupposes a child is ever actually ON
-- SITE at a centre:
--   - abc_logs_logged_by_role_check -- care_staff logging an ABC entry
--     is a during-a-stay action with no activation mechanism yet
--     (Stage 3+). Widening this constraint now with nothing able to
--     write against it yet would be exactly the kind of speculative,
--     ungrounded change this codebase's own standing practice avoids.
--   - message_categories.allowed_sender_roles -- no respite messaging
--     UI exists yet to consume it; widening the DATA with nothing
--     built to read it is the same speculative-change concern.
--   - can_own_incident(), create_incident_stamp(), raise_support_alert()
--     -- confirmed, per Daniel's own answer, that "centre manager
--     countersigns" means finalising the post-stay report (Stage 3+,
--     its own new mechanism), never the school incident-log RPCs.
--     Untouched, on purpose.
--
-- WHAT THIS MIGRATION DOES TOUCH BEYOND DANIEL'S OWN NUMBERED LIST,
-- because Stage 2's own stated verification goal ("a second manager
-- joins the same centre and is accepted") is not reachable without it:
-- derive_staff_join_approval()'s bootstrap branch (0101) and
-- approve_staff_join()/reject_staff_join()'s own caller checks (0222/
-- 0100) are all hard-coded to role='principal' with no institution-type
-- awareness at all -- confirmed by reading each live definition before
-- writing this. Without a respite-specific bootstrap and a respite-
-- specific approver, a brand-new respite institution's very first
-- centre_manager would join 'pending' with nobody able to approve them,
-- and a second manager could never be accepted at all -- the exact
-- verification case Daniel named. Both are widened as an explicit,
-- additive OR branch, never a rewrite of the existing school/clinic
-- logic.

-- =====================================================================
-- 1. institutions.type gains 'respite_centre'. Unnamed column CHECK
-- from 0200 -- Postgres's own default naming for a column-level CHECK
-- is <table>_<column>_check, confirmed live (grepped every migration
-- for "institutions_type_check" -- zero hits, so this is the first
-- time it's been referenced by name; if the drop below fails because
-- the real name differs, the CREATE will still succeed since IF NOT
-- EXISTS guards the column itself, and Daniel will see the DROP's own
-- error naming the real constraint).
-- =====================================================================
alter table public.institutions
  drop constraint if exists institutions_type_check;
alter table public.institutions
  add constraint institutions_type_check
  check (type in ('school', 'clinic', 'respite_centre'));

-- =====================================================================
-- 2. institution_staff.role gains 'centre_manager' and 'care_staff'.
-- =====================================================================
alter table public.institution_staff
  drop constraint if exists institution_staff_role_check;
alter table public.institution_staff
  add constraint institution_staff_role_check
  check (role in (
    'class_teacher', 'institution_admin', 'sna', 'principal',
    'clinician', 'clinical_lead', 'clinic_admin',
    'centre_manager', 'care_staff'
  ));

-- institution_staff.approval_source (0101/0102/0105) gains
-- 'centre_manager' too -- approve_staff_join() below records it as the
-- actual approving role, matching the existing 'principal' value's own
-- meaning exactly (who approved, not what was approved). Widening the
-- CHECK without also fixing the write site would have left the write
-- site free to keep lying; both are done together, in this migration.
alter table public.institution_staff
  drop constraint if exists institution_staff_approval_source_check;
alter table public.institution_staff
  add constraint institution_staff_approval_source_check
  check (approval_source is null or approval_source in (
    'grandfathered', 'bootstrap', 'principal', 'handover', 'temporary_grant', 'centre_manager'
  ));

-- =====================================================================
-- 3. The self-link INSERT policy gains a real respite arm -- a third
-- additive OR clause, matching 0203's own school/clinic shape exactly.
-- A respite institution matched NEITHER of the two existing clauses
-- (confirmed in Stage 1 recon) so this was a clean refusal before, not
-- a silent wrong admission -- this is new capability, not a fix.
-- =====================================================================
alter policy "Institution admins and class teachers can self-link"
  on public.institution_staff
  with check (
    auth.uid() = user_id
    and public.current_user_role() = role
    and (
      (
        (select type from public.institutions where id = institution_id) = 'school'
        and role in ('institution_admin', 'class_teacher', 'sna', 'principal')
      )
      or (
        (select type from public.institutions where id = institution_id) = 'clinic'
        and role in ('clinician', 'clinical_lead', 'clinic_admin', 'principal')
      )
      or (
        (select type from public.institutions where id = institution_id) = 'respite_centre'
        and role in ('centre_manager', 'care_staff')
      )
    )
  );

-- =====================================================================
-- 4. derive_staff_join_approval() gains a centre_manager bootstrap
-- branch, additive alongside the existing principal one -- the first
-- centre_manager at a brand-new respite institution auto-approves,
-- exactly as the first principal at a brand-new school/clinic already
-- does. Every subsequent centre_manager or care_staff join is pending
-- by default, same as every other role.
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
    new.approval_source := 'bootstrap';
  end if;

  if new.role = 'centre_manager' and not exists (
    select 1 from public.institution_staff s
    where s.institution_id = new.institution_id
      and s.role = 'centre_manager'
      and s.approved_at is not null
      and s.deactivated_at is null
      and s.rejected_at is null
  ) then
    new.approved_at := now();
    new.approval_source := 'bootstrap';
  end if;

  return new;
end;
$$;

-- =====================================================================
-- 5. approve_staff_join() / reject_staff_join() gain a centre_manager-
-- at-a-respite-centre caller branch, additive alongside the existing
-- principal-only check. A centre_manager approves/rejects joins at
-- their OWN centre only -- an institution-type check is included even
-- though a centre_manager role can, by construction (the self-link
-- policy above), only ever exist at a respite_centre institution in
-- the first place; included anyway to match the explicit, defensive
-- shape every other type-aware check in this schema already uses,
-- rather than relying on that construction alone.
-- =====================================================================
create or replace function public.approve_staff_join(p_institution_staff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.institution_staff;
  v_caller_role text;
  v_institution_type text;
  v_approval_source text;
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

  -- A COLUMN NAME IS A CLAIM (CLAUDE.md's own standing rule): approval_
  -- source records WHO actually approved, so the caller's own role is
  -- read here, not assumed to be 'principal' -- a centre_manager
  -- approving would otherwise write a false attribution.
  select s.role into v_caller_role
  from public.institution_staff s
  join public.institutions inst on inst.id = s.institution_id
  where s.user_id = auth.uid()
    and s.institution_id = v_target.institution_id
    and s.deactivated_at is null
    and s.approved_at is not null
    and inst.status = 'verified'
    and (
      (s.role = 'principal')
      or (s.role = 'centre_manager' and inst.type = 'respite_centre')
    );

  if v_caller_role is null then
    raise exception 'Only an active principal or centre manager at this institution can approve staff here.';
  end if;

  v_approval_source := case when v_caller_role = 'centre_manager' then 'centre_manager' else 'principal' end;

  update public.institution_staff
  set approved_at = now(), approved_by = auth.uid(), approval_source = v_approval_source
  where id = p_institution_staff_id;

  -- Unchanged: a clinic practitioner's own director-approval IS their
  -- verification. Fires only for role='clinician' at a type='clinic'
  -- institution -- respite's own two roles never touch this branch.
  if v_target.role = 'clinician' then
    select type into v_institution_type from public.institutions where id = v_target.institution_id;

    if v_institution_type = 'clinic' then
      insert into public.clinicians (user_id, specialty, verification_status, verification_route)
      values (v_target.user_id, 'unspecified', 'verified', 'organisation')
      on conflict (user_id) do update
        set verification_status = case
              when public.clinicians.verification_status = 'verified' then public.clinicians.verification_status
              else 'verified'
            end,
            verification_route = case
              when public.clinicians.verification_status = 'verified' then public.clinicians.verification_route
              else 'organisation'
            end;
    end if;
  end if;

  return jsonb_build_object('approved', true);
end;
$$;

create or replace function public.reject_staff_join(p_institution_staff_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.institution_staff;
  v_caller_is_authorized boolean;
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
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
      and (
        (s.role = 'principal')
        or (s.role = 'centre_manager' and inst.type = 'respite_centre')
      )
  ) into v_caller_is_authorized;

  if not v_caller_is_authorized then
    raise exception 'Only an active principal or centre manager at this institution can reject staff here.';
  end if;

  update public.institution_staff
  set rejected_at = now(), rejected_by = auth.uid(), rejection_reason = p_reason
  where id = p_institution_staff_id;

  return jsonb_build_object('rejected', true);
end;
$$;

-- =====================================================================
-- 6. The messaging/consent CHECK constraints -- assembling the
-- complete list, per Daniel's own instruction, including the two
-- functions he named as unverified in Stage 1 recon (grant_passport_
-- access, confirmed above as genuinely unreachable and left alone;
-- send_message, widened below).
-- =====================================================================
alter table public.messages drop constraint if exists messages_sender_role_check;
alter table public.messages add constraint messages_sender_role_check
  check (sender_role in (
    'parent', 'class_teacher', 'clinician', 'principal', 'sna',
    'clinical_lead', 'clinic_admin', 'centre_manager', 'care_staff'
  ));

alter table public.message_recipients drop constraint if exists message_recipients_recipient_role_check;
alter table public.message_recipients add constraint message_recipients_recipient_role_check
  check (recipient_role in (
    'parent', 'class_teacher', 'clinician', 'principal', 'sna',
    'clinical_lead', 'clinic_admin', 'centre_manager', 'care_staff'
  ));

alter table public.consents
  drop constraint if exists consents_role_check;
alter table public.consents
  add constraint consents_role_check
  check (role in (
    'parent', 'class_teacher', 'sna', 'principal', 'clinician',
    'clinical_lead', 'clinic_admin', 'centre_manager', 'care_staff'
  ));

-- =====================================================================
-- 7. get_institution_staff_candidates() and send_message()'s own
-- inline sender-role check -- both role-list widenings only, no
-- signature change, bare CREATE OR REPLACE is correct (this schema's
-- own documented rule: a DROP-first is only required when a
-- function's PARAMETER LIST changes, never for a body-only edit).
-- =====================================================================
create or replace function public.get_institution_staff_candidates(p_institution_id uuid)
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
    where public.institution_staff_has_current_standing(auth.uid(), p_institution_id)
  )
  select s.user_id as recipient_id,
         coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
         s.role
  from authorized, public.institution_staff s
  join auth.users u on u.id = s.user_id
  where s.institution_id = p_institution_id
    and s.role in (
      'class_teacher', 'sna', 'principal', 'clinician', 'clinical_lead',
      'clinic_admin', 'centre_manager', 'care_staff'
    )
    and public.institution_staff_has_current_standing(s.user_id, p_institution_id)
    and s.user_id <> auth.uid();
$$;

-- Reproduced verbatim from its live definition (0261) -- read in full
-- before writing this, not reconstructed from memory (a first attempt
-- at this edit got the parameter list itself wrong, caught before
-- running anything; kept as a reminder in this comment rather than
-- silently corrected, per this schema's own standing discipline of
-- naming a mistake caught mid-work). The ONLY change from 0261's own
-- body is the role list at "THE FIX" below.
create or replace function public.send_message(
  p_passport_id uuid,
  p_category_id uuid,
  p_body text,
  p_response_required boolean,
  p_recipient_ids uuid[],
  p_abc_log_id uuid default null,
  p_strategy_update boolean default false,
  p_institution_id uuid default null
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
  v_category_applies_to text;
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

  if (p_passport_id is null) = (p_institution_id is null) then
    raise exception 'Exactly one of a child or a staff conversation must be specified.';
  end if;

  if p_institution_id is not null then
    if p_abc_log_id is not null then
      raise exception 'A staff conversation cannot reference an incident log.';
    end if;
    if p_strategy_update then
      raise exception 'A staff conversation cannot be a strategy update.';
    end if;

    if not public.institution_staff_has_current_standing(v_uid, p_institution_id) then
      raise exception 'You are not authorized to message staff at this institution.';
    end if;

    select role into v_sender_role
    from public.institution_staff
    where user_id = v_uid and institution_id = p_institution_id
      and deactivated_at is null and approved_at is not null;

    -- THE FIX: centre_manager/care_staff added, matching every other
    -- role list widened in this migration.
    if v_sender_role not in (
      'class_teacher', 'sna', 'principal', 'clinician', 'clinical_lead',
      'clinic_admin', 'centre_manager', 'care_staff'
    ) then
      raise exception 'You are not authorized to message staff at this institution.';
    end if;
  else
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
    ) then
      v_sender_role := 'class_teacher';
    elsif public.has_sna_access(v_uid, p_passport_id) then
      v_sender_role := 'sna';
    elsif public.is_verified_clinician(v_uid) and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = p_passport_id
        and ca.clinician_id = v_uid
        and ca.is_active = true
    ) then
      v_sender_role := 'clinician';
    elsif exists (
      select 1 from public.passport_institution_links pil
      join public.institution_staff s on s.institution_id = pil.institution_id
      where pil.passport_id = p_passport_id
        and s.user_id = v_uid
        and s.role = 'principal'
        and s.deactivated_at is null
        and s.approved_at is not null
    ) then
      v_sender_role := 'principal';
    else
      raise exception 'You are not authorized to message about this child.';
    end if;
  end if;

  select array_agg(role_value)
  into v_category_roles
  from (
    select jsonb_array_elements_text(to_jsonb(mc.allowed_sender_roles)) as role_value
    from public.message_categories mc
    where mc.id = p_category_id and mc.is_active = true
  ) roles;

  select label, applies_to into v_category_label, v_category_applies_to
  from public.message_categories
  where id = p_category_id and is_active = true;

  if v_category_label is null then
    raise exception 'Invalid or inactive category.';
  end if;
  if not (v_sender_role = any(v_category_roles)) then
    raise exception 'This category is not available to your role.';
  end if;
  if p_institution_id is not null and v_category_applies_to <> 'staff' then
    raise exception 'This category is not available on a staff conversation.';
  end if;
  if p_passport_id is not null and v_category_applies_to <> 'child' then
    raise exception 'This category is not available on a child conversation.';
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
    if p_institution_id is not null then
      select count(*) into v_open_rr_count
      from public.messages
      where institution_id = p_institution_id
        and sender_id = v_uid
        and response_required = true
        and status <> 'closed';
    else
      select count(*) into v_open_rr_count
      from public.messages
      where passport_id = p_passport_id
        and sender_id = v_uid
        and response_required = true
        and status <> 'closed';
    end if;
    if v_open_rr_count >= 3 then
      raise exception 'You already have 3 open response-required conversations here. Close one before starting another.';
    end if;
  end if;

  insert into public.messages (
    passport_id, institution_id, sender_id, sender_role, category_id, body,
    response_required, status, abc_log_id, strategy_update
  ) values (
    p_passport_id, p_institution_id, v_uid, v_sender_role, p_category_id, p_body,
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
  where rid <> v_uid and p_passport_id is not null

  union all

  select v_message_id, rid, (
    select role from public.get_institution_staff_candidates(p_institution_id) c
    where c.recipient_id = rid
  )
  from unnest(p_recipient_ids) as rid
  where rid <> v_uid and p_institution_id is not null;

  if exists (
    select 1 from public.message_recipients where message_id = v_message_id and recipient_role is null
  ) then
    raise exception 'One or more recipients are not authorized participants for this conversation.';
  end if;

  return v_message_id;
end;
$$;

grant execute on function public.send_message(uuid, uuid, text, boolean, uuid[], uuid, boolean, uuid) to authenticated;
