-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- THE PATTERN, NAMED ONCE HERE, EXPANDED IN ITS OWN CLAUDE.md ENTRY:
-- an unordered `SELECT ... INTO variable FROM institution_staff ...` is
-- only safe when a real constraint structurally caps the result at one
-- row. `institution_staff_one_active_per_institution` (0100) covers
-- `deactivated_at is null` AT ONE SPECIFIC institution_id -- nothing
-- else. Scan across institutions, or omit the standing filter, and the
-- result is arbitrary, and Postgres will never warn you -- it just
-- returns whichever row it happens to read first. Found four times now,
-- each by accident while doing something else: derive_countersign_
-- fields() (0103, dropped by 0245's own rewrite, restored 0256),
-- create_bsp() (this session, the stagnation-queue fixture), and the two
-- fixed below.
--
-- Three fixes, three different correct shapes for the SAME underlying
-- problem -- worth reading as three distinct answers, not one:
--   1. create_bsp() -- derive institution_id from the CHILD'S OWN
--      engagement (clinician_access.engaged_by_institution_id for this
--      exact passport+clinician pair), never from the caller's general
--      institution_staff membership. clinician_access has a real
--      unique(passport_id, clinician_id) -- structurally at most one row.
--   2. hand_over_principal() -- THE DEEPER FIX: it took no institution_id
--      parameter at all, so filtering the lookup alone could not have
--      fixed it -- the function's own TARGET was inferred, not stated.
--      Now takes p_institution_id explicitly; the caller (who always
--      knows which institution they're acting in) states it, and the
--      predecessor lookup filters on it directly.
--   3. send_message() -- the sender-role lookup gains the same
--      deactivated_at/approved_at filter every OTHER institution-scoped
--      lookup in this schema already carries, closing the rejoin case
--      (old deactivated row + new active row, same institution) the
--      same way 0103 closed it for derive_countersign_fields().

-- =====================================================================
-- 1. create_bsp() -- institution_id from clinician_access, not from an
-- unordered scan of the caller's own institution_staff memberships.
-- Same signature (bare CREATE OR REPLACE is correct) -- only the
-- institution_id resolution changes; everything else, including the
-- 0241 no-source-FBA fix, is untouched.
-- =====================================================================

create or replace function public.create_bsp(
  p_passport_id uuid,
  p_source_fba_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_institution_id uuid;
  v_fba record;
  v_new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_verified_clinician(auth.uid()) then
    raise exception 'Only a verified clinician may create a behaviour support plan.';
  end if;

  -- THE FIX: this passport's own clinician_access row for this caller is
  -- the unambiguous source of truth for which institution engaged them
  -- for THIS child -- unique(passport_id, clinician_id) (0026) means
  -- there is structurally at most one row to read, unlike the old query
  -- (an unordered scan of every clinic this clinician happens to work
  -- at, unrelated to which one actually engaged them here). Replaces
  -- BOTH the old existence check and the old institution_id derivation
  -- with one query. engaged_by_institution_id is null for a
  -- parent-engaged (non-institution) clinician, which correctly leaves
  -- v_institution_id null too -- an independent clinician's BSP has
  -- never carried an institution_id, and this preserves that exactly.
  select ca.engaged_by_institution_id into v_institution_id
  from public.clinician_access ca
  where ca.passport_id = p_passport_id
    and ca.clinician_id = auth.uid()
    and ca.is_active = true;

  if not found then
    raise exception 'You do not have active access to this child.';
  end if;

  if p_source_fba_id is not null then
    select * into v_fba from public.fba_reports where id = p_source_fba_id;
    if v_fba.id is null then
      raise exception 'FBA not found.';
    end if;
    if v_fba.passport_id is distinct from p_passport_id then
      raise exception 'That FBA does not belong to this child.';
    end if;
    if v_fba.status <> 'completed' then
      raise exception 'Only a completed FBA can be carried into a plan.';
    end if;
  else
    select null::jsonb as content_data into v_fba;
  end if;

  insert into public.bsp (
    passport_id, institution_id, clinician_id, source_fba_id,
    target_behaviours, triggers, setting_events, precursors
  )
  values (
    p_passport_id, v_institution_id, auth.uid(), p_source_fba_id,
    coalesce(v_fba.content_data -> 'targetBehaviours', '[]'::jsonb),
    coalesce(v_fba.content_data -> 'triggers', '[]'::jsonb),
    coalesce(v_fba.content_data -> 'settingEvents', '[]'::jsonb),
    v_fba.content_data ->> 'precursors'
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

grant execute on function public.create_bsp(uuid, uuid) to authenticated;

-- =====================================================================
-- 2. hand_over_principal() -- gains an explicit p_institution_id, per
-- Daniel's own instruction: filtering the lookup fixes the arbitrary
-- pick, it does not fix a function whose target institution was
-- inferred rather than stated. The caller (HandOverPrincipalSheet.tsx,
-- rendered from /principal/school and /principal/clinic, both of which
-- already resolve institutionId as local state before this sheet ever
-- opens) always knows which institution it's acting in -- no new query
-- needed client-side, only a prop threaded through. New leading
-- parameter changes the signature -- DROP the old 4-param function
-- first, per this schema's own standing rule for exactly this class of
-- change.
--
-- The predecessor lookup now filters on p_institution_id directly,
-- which makes it structurally safe the same way every OTHER
-- institution-scoped, deactivated_at/approved_at-filtered lookup in
-- this schema already is (institution_staff_one_active_per_institution,
-- 0100) -- limit 1 is removed because it's no longer doing any real
-- work once the row set is provably capped at one.
-- =====================================================================

drop function if exists public.hand_over_principal(uuid, text, text, text);

create function public.hand_over_principal(
  p_institution_id uuid,
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
  v_institution_type text;
  v_valid_staying_roles text[];
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

  -- THE FIX: filtered on the CALLER-STATED p_institution_id, not
  -- inferred from an unordered scan of every institution this person
  -- happens to be an active principal at. Structurally at most one row
  -- can match (institution_staff_one_active_per_institution, 0100) --
  -- no limit needed.
  select s.* into v_predecessor
  from public.institution_staff s
  join public.institutions inst on inst.id = s.institution_id
  where s.user_id = auth.uid()
    and s.institution_id = p_institution_id
    and s.role = 'principal'
    and s.deactivated_at is null
    and s.approved_at is not null
    and inst.status = 'verified';

  if not found then
    raise exception 'Only an active principal at a verified institution can hand over the principal role.';
  end if;

  v_institution_id := v_predecessor.institution_id;

  select type into v_institution_type from public.institutions where id = v_institution_id;
  v_valid_staying_roles := case
    when v_institution_type = 'clinic' then array['clinician', 'clinical_lead', 'clinic_admin']
    else array['class_teacher', 'sna']
  end;

  if p_outcome = 'staying' and (p_staying_role is null or not (p_staying_role = any(v_valid_staying_roles))) then
    raise exception 'When staying, the new role must be one of: %', array_to_string(v_valid_staying_roles, ', ');
  end if;

  if p_outcome = 'leaving' and p_staying_role is not null then
    raise exception 'A staying role must not be provided when the outcome is leaving.';
  end if;

  if p_successor_user_id = auth.uid() then
    raise exception 'You cannot hand over the principal role to yourself.';
  end if;

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

grant execute on function public.hand_over_principal(uuid, uuid, text, text, text) to authenticated;

-- =====================================================================
-- 3. send_message() -- the sender-role lookup (staff-to-staff branch)
-- gains the deactivated_at/approved_at filter every OTHER institution-
-- scoped lookup in this schema already carries. Same signature -- bare
-- CREATE OR REPLACE is correct.
-- =====================================================================

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

    -- THE FIX: deactivated_at/approved_at added, matching every other
    -- institution-scoped role lookup in this schema. Without this, an
    -- old, deactivated row and a newer active row at the SAME
    -- institution (a real rejoin) both match, and Postgres returns
    -- whichever it happens to read first -- a role that can be both a
    -- wrong authorization input AND, worse, get permanently written
    -- into messages.sender_role as attribution.
    select role into v_sender_role
    from public.institution_staff
    where user_id = v_uid and institution_id = p_institution_id
      and deactivated_at is null and approved_at is not null;

    if v_sender_role not in ('class_teacher', 'sna', 'principal', 'clinician', 'clinical_lead', 'clinic_admin') then
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
