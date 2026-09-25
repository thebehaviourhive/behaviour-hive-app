-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- FOLLOW-UP TO 0303. Verifying that fix's own second claim -- "send_message()
-- itself needs no separate fix... it refuses the whole send if any chosen
-- recipient resolves to a null role" -- surfaced that the refusal observed
-- live was never actually that check. Read the live body (0302) closely: it
-- inserts into message_recipients first, resolving each recipient's role via
-- get_message_recipient_candidates()/get_institution_staff_candidates(), and
-- ONLY AFTER the insert checks `where recipient_role is null` to raise a
-- named, readable exception ("One or more recipients are not authorized
-- participants for this conversation."). But `message_recipients.recipient_
-- role` has been `not null` since the column was created (0061) and still is
-- today -- so the INSERT itself fails first, on a bare NOT NULL constraint
-- violation, every time a candidate resolves to null. The intended, readable
-- RAISE EXCEPTION two lines below it has been dead code, unreachable, since
-- 0061 -- true of every historical version of this function, not introduced
-- by 0303. The refusal 0303's own verification observed was real (nothing
-- got through), but it was a constraint catching an accident, not an
-- authorisation decision -- and it would vanish silently the moment that
-- column ever gained a default or the lookup grew a fallback branch.
--
-- THE FIX: an explicit eligibility check, BEFORE any row is written (before
-- even the `messages` insert, so a refused send never leaves an orphaned
-- message row) -- every non-self recipient id must resolve to a real row in
-- the exact same candidate function the later INSERT already joins against.
-- Named check first: `One or more recipients are not authorized participants
-- for this conversation.` -- the OLD readable exception this function always
-- meant to raise, now actually reachable. The post-insert `recipient_role is
-- null` check and the column's own NOT NULL constraint are left in place,
-- deliberately, as backstops -- under the new check they should be
-- structurally unreachable, the same "defense in depth, once proven correct
-- rather than assumed" posture this schema already applies everywhere else
-- (institution_staff_has_current_standing() alongside RLS, the exclude
-- constraint alongside the availability re-check in PRD 9 Stage 2, etc).
--
-- Same signature as the live 0302 definition, CREATE OR REPLACE-safe --
-- confirmed against this schema's own "new trailing parameter" gotcha:
-- nothing added or reordered, only the body.
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
    elsif exists (
      select 1 from public.institution_staff s
      where s.user_id = v_uid
        and s.role = 'centre_manager'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
        and exists (
          select 1 from public.respite_activations a
          where a.passport_id = p_passport_id
            and a.institution_id = s.institution_id
            and a.closed_at is null
        )
    ) then
      v_sender_role := 'centre_manager';
    elsif exists (
      select 1 from public.institution_staff s
      where s.user_id = v_uid
        and s.role = 'care_staff'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
        and exists (
          select 1 from public.respite_activations a
          where a.passport_id = p_passport_id
            and a.institution_id = s.institution_id
            and a.closed_at is null
        )
    ) then
      v_sender_role := 'care_staff';
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

  -- NEW: the real eligibility gate, before anything is written. Every
  -- non-self recipient id must resolve to a real row in the exact same
  -- candidate function the INSERT below joins against -- named,
  -- explicit, and evaluated before the `messages` row itself is created,
  -- so a refused send never leaves an orphaned message behind.
  if p_passport_id is not null and exists (
    select 1
    from unnest(p_recipient_ids) as rid
    where rid <> v_uid
      and rid not in (
        select recipient_id from public.get_message_recipient_candidates(p_passport_id)
      )
  ) then
    raise exception 'One or more recipients are not authorized participants for this conversation.';
  end if;

  if p_institution_id is not null and exists (
    select 1
    from unnest(p_recipient_ids) as rid
    where rid <> v_uid
      and rid not in (
        select recipient_id from public.get_institution_staff_candidates(p_institution_id)
      )
  ) then
    raise exception 'One or more recipients are not authorized participants for this conversation.';
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

  -- BACKSTOP, not the gate -- should be structurally unreachable now that
  -- the explicit check above runs first. Kept deliberately, matching this
  -- schema's own defense-in-depth posture elsewhere.
  if exists (
    select 1 from public.message_recipients where message_id = v_message_id and recipient_role is null
  ) then
    raise exception 'One or more recipients are not authorized participants for this conversation.';
  end if;

  return v_message_id;
end;
$$;

grant execute on function public.send_message(uuid, uuid, text, boolean, uuid[], uuid, boolean, uuid) to authenticated;
