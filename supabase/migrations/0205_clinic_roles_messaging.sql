-- PRD 5 Stage 2, enumerations #4 and #8 of Stage 1's own audit,
-- resolved together since they're paired: a role that can't be a
-- staff-messaging candidate can't sensibly be a sender, and vice versa.
-- Institution-level staff messaging is a general mechanism, not
-- incident-log-specific, so clinic colleagues messaging each other is
-- in scope even though incidents themselves are not.
--
-- Unlike the self-link policy and hand_over_principal() (0203, 0204),
-- neither of these needs type-awareness: a clinical_lead/clinic_admin/
-- clinician institution_staff row can only ever exist at a clinic
-- institution in the first place, because 0203's own self-link policy
-- is what gates creation -- by the time either function below runs,
-- the row it's reading already carries the correct type's role. A flat
-- widening is the right shape here, not a branch.
--
-- 'clinician' added here for the reason the whole stage turns on: a
-- clinic's own practitioners are institution_staff rows now (0203),
-- and without this widening they'd be invisible to their own
-- colleagues' staff-thread candidate list and unable to send a staff
-- message themselves -- the exact gap Stage 1's own recon first
-- surfaced as a messaging-function problem before the real premise
-- (institution_staff membership) was resolved.
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
    and s.role in ('class_teacher', 'sna', 'principal', 'clinician', 'clinical_lead', 'clinic_admin')
    and public.institution_staff_has_current_standing(s.user_id, p_institution_id)
    and s.user_id <> auth.uid();
$$;

grant execute on function public.get_institution_staff_candidates(uuid) to authenticated;

-- send_message()'s CHILD-conversation branch is untouched -- its own
-- 'clinician' elsif already authorizes via is_verified_clinician() +
-- clinician_access, with no dependency on engaged_by at all, so an
-- institution-engaged practitioner already sends child-scoped messages
-- correctly today, unchanged by this migration. clinical_lead and
-- clinic_admin deliberately do NOT get a new child-conversation branch
-- -- PRD section 5 gives clinic_admin "no clinical content", and a
-- lead's own described authority (reassign/discharge/approve within
-- scope) is about caseload administration, not being a clinical
-- contact on a specific child's thread -- that's the practitioner's
-- role, unchanged. Only the STAFF-to-staff branch's role gate widens.
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
    -- Staff-to-staff branch -- role gate widened for the three clinic
    -- values (0203).
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
    where user_id = v_uid and institution_id = p_institution_id;

    if v_sender_role not in ('class_teacher', 'sna', 'principal', 'clinician', 'clinical_lead', 'clinic_admin') then
      raise exception 'You are not authorized to message staff at this institution.';
    end if;
  else
    -- Child-conversation branch -- unchanged, see header comment.
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

-- CHECK constraints on the underlying tables -- 'clinician' already
-- present in both (school-engaged clinicians already send/receive
-- child-scoped messages); clinical_lead/clinic_admin are the two new
-- values these need.
alter table public.messages drop constraint if exists messages_sender_role_check;
alter table public.messages add constraint messages_sender_role_check
  check (sender_role in ('parent', 'class_teacher', 'clinician', 'principal', 'sna', 'clinical_lead', 'clinic_admin'));

alter table public.message_recipients drop constraint if exists message_recipients_recipient_role_check;
alter table public.message_recipients add constraint message_recipients_recipient_role_check
  check (recipient_role in ('parent', 'class_teacher', 'clinician', 'principal', 'sna', 'clinical_lead', 'clinic_admin'));

-- NOT done here, flagged rather than guessed at: the three existing
-- applies_to='staff' message_categories rows ("Cover / Rota",
-- "Class / Roster", "General") are school-vocabulary category NAMES,
-- not just role lists -- appending clinic roles to allowed_sender_roles
-- on "Class / Roster" would offer a clinic's own staff a category that
-- means nothing to them. A clinic institution needs either its own
-- parallel staff-category rows or a vocabulary-translated category
-- label (matching this stage's own Stage 1 precedent) -- a real,
-- undecided product question, not a schema question, left for a
-- deliberate decision rather than shipped as a guess.
