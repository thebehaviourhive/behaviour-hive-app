-- Stage 7, item 5: SNA child-scoped messaging -- decided during the
-- Group B access-consistency pass (migration 0188's own header comment
-- names this as "the parked SNA messaging about a child product
-- decision, now decided (SNAs get it) but scoped as its own piece").
-- An SNA can already message about STAFF matters (0168, staff-to-staff)
-- but has no path to message about a specific CHILD at all -- confirmed
-- by reading the live definitions of all three functions below before
-- writing this: none of them mention 'sna' or has_sna_access() on the
-- child-conversation side.
--
-- Matches 0161's own principal-messaging shape exactly (an authorized
-- branch, a candidates branch, a can_view_message branch, a sender
-- branch) -- reused, not reinvented. Simpler than 0161's own principal
-- branches in one respect: has_sna_access() already exists as the
-- single chokepoint for "does this SNA have access to this child" (four
-- branches: direct grant, 1:1 child_assignments, temporary cover,
-- class-tier class_sna_assignments) -- every branch below calls it
-- directly rather than re-deriving its joins inline, so this can never
-- drift out of sync with has_sna_access() the way the six hand-rolled
-- copies from the Group B pass did.
--
-- Same signatures, same return shapes throughout -- CREATE OR REPLACE
-- is sufficient for all three functions.

-- 1. get_message_recipient_candidates() -- new `authorized` branch (an
--    SNA with real access to this child can query candidates at all,
--    same gate every other role already has) and a new `candidates`
--    branch (which SNA(s), specifically, should appear as a target --
--    enumerated via institution_staff role='sna' at this child's own
--    institution, filtered by has_sna_access() itself rather than
--    re-deriving the four-branch join inline).
create or replace function public.get_message_recipient_candidates(p_passport_id uuid)
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
    where
      public.owns_passport(p_passport_id)
      or exists (
        select 1 from public.passport_access pa
        join public.passport_institution_links pil
          on pil.passport_id = pa.passport_id and pil.institution_id = pa.institution_id
        where pa.passport_id = p_passport_id
          and pa.teacher_id = auth.uid()
          and pa.is_active = true
          and pa.actor_role = 'class_teacher'
      )
      or exists (
        select 1
        from public.class_children cc
        join public.classes c on c.id = cc.class_id
        join public.class_teachers ct on ct.class_id = c.id
        join public.institution_staff s on s.user_id = ct.user_id and s.institution_id = c.institution_id
        join public.passport_institution_links pil
          on pil.passport_id = cc.passport_id and pil.institution_id = c.institution_id
        where cc.passport_id = p_passport_id
          and cc.ended_at is null
          and ct.user_id = auth.uid()
          and ct.ended_at is null
          and s.deactivated_at is null
          and s.approved_at is not null
      )
      or (
        public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = p_passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
      )
      or (
        exists (
          select 1 from public.passport_institution_links pil
          join public.institution_staff s on s.institution_id = pil.institution_id
          where pil.passport_id = p_passport_id
            and s.user_id = auth.uid()
            and s.role = 'principal'
            and s.deactivated_at is null
            and s.approved_at is not null
        )
      )
      -- NEW: an SNA with real access to this child (any of has_sna_
      -- access()'s own four branches) is authorized to query candidates.
      or public.has_sna_access(auth.uid(), p_passport_id)
  ),
  candidates as (
    select g.user_id as recipient_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
           'parent'::text as role
    from authorized, public.passport_guardians g
    join auth.users u on u.id = g.user_id
    where g.passport_id = p_passport_id

    union all

    select pa.teacher_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           'class_teacher'
    from authorized, public.passport_access pa
    join public.passport_institution_links pil
      on pil.passport_id = pa.passport_id and pil.institution_id = pa.institution_id
    join auth.users u on u.id = pa.teacher_id
    where pa.passport_id = p_passport_id
      and pa.is_active = true
      and pa.actor_role = 'class_teacher'

    union all

    select ct.user_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           'class_teacher'
    from authorized, public.class_children cc
    join public.classes c on c.id = cc.class_id
    join public.class_teachers ct on ct.class_id = c.id
    join public.institution_staff s on s.user_id = ct.user_id and s.institution_id = c.institution_id
    join public.passport_institution_links pil
      on pil.passport_id = cc.passport_id and pil.institution_id = c.institution_id
    join auth.users u on u.id = ct.user_id
    where cc.passport_id = p_passport_id
      and cc.ended_at is null
      and ct.ended_at is null
      and s.deactivated_at is null
      and s.approved_at is not null
      and not exists (
        select 1 from public.passport_access pa2
        where pa2.passport_id = p_passport_id
          and pa2.teacher_id = ct.user_id
          and pa2.is_active = true
          and pa2.actor_role = 'class_teacher'
      )

    union all

    select ca.clinician_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           'clinician'
    from authorized, public.clinician_access ca
    join auth.users u on u.id = ca.clinician_id
    where ca.passport_id = p_passport_id
      and ca.is_active = true
      and public.is_verified_clinician(ca.clinician_id)

    union all

    select s.user_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           'principal'
    from authorized, public.passport_institution_links pil
    join public.institution_staff s on s.institution_id = pil.institution_id
    join auth.users u on u.id = s.user_id
    where pil.passport_id = p_passport_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null

    union all

    -- NEW: which SNA(s) specifically have real access to this child --
    -- candidate institution_staff role='sna' rows at this child's own
    -- institution, filtered by has_sna_access() itself so this can
    -- never list an SNA who doesn't actually have access.
    select s.user_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           'sna'
    from authorized, public.passport_institution_links pil
    join public.institution_staff s on s.institution_id = pil.institution_id
    join auth.users u on u.id = s.user_id
    where pil.passport_id = p_passport_id
      and s.role = 'sna'
      and s.deactivated_at is null
      and s.approved_at is not null
      and public.has_sna_access(s.user_id, p_passport_id)
  )
  select recipient_id, full_name, role
  from candidates
  where recipient_id <> auth.uid();
$$;

grant execute on function public.get_message_recipient_candidates(uuid) to authenticated;

-- 2. can_view_message() -- new SNA branch, structured exactly like the
-- class_teacher/clinician/principal branches above it: real access to
-- the child (has_sna_access()) AND sender-or-recipient.
create or replace function public.can_view_message(p_message_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.messages m
    where m.id = p_message_id
      and (
        public.owns_passport(m.passport_id)

        or (
          public.has_class_teacher_access(auth.uid(), m.passport_id)
          and (
            m.sender_id = auth.uid()
            or exists (
              select 1 from public.message_recipients mr
              where mr.message_id = m.id and mr.recipient_id = auth.uid()
            )
          )
        )

        or (
          public.is_verified_clinician(auth.uid())
          and exists (
            select 1 from public.clinician_access ca
            where ca.passport_id = m.passport_id
              and ca.clinician_id = auth.uid()
              and ca.is_active = true
          )
          and (
            m.sender_id = auth.uid()
            or exists (
              select 1 from public.message_recipients mr
              where mr.message_id = m.id and mr.recipient_id = auth.uid()
            )
          )
        )

        or (
          public.is_verified_clinician(auth.uid())
          and exists (
            select 1 from public.clinician_access ca
            where ca.passport_id = m.passport_id
              and ca.clinician_id = auth.uid()
              and ca.is_active = true
          )
          and m.sender_role in ('parent', 'class_teacher')
          and not exists (
            select 1 from public.message_recipients mr2
            where mr2.message_id = m.id and mr2.recipient_role = 'clinician'
          )
        )

        or (
          exists (
            select 1 from public.passport_institution_links pil
            join public.institution_staff s on s.institution_id = pil.institution_id
            where pil.passport_id = m.passport_id
              and s.user_id = auth.uid()
              and s.role = 'principal'
              and s.deactivated_at is null
              and s.approved_at is not null
          )
          and (
            m.sender_id = auth.uid()
            or exists (
              select 1 from public.message_recipients mr
              where mr.message_id = m.id and mr.recipient_id = auth.uid()
            )
          )
        )

        -- NEW: an SNA with real access to this child, sender-or-recipient.
        or (
          m.passport_id is not null
          and public.has_sna_access(auth.uid(), m.passport_id)
          and (
            m.sender_id = auth.uid()
            or exists (
              select 1 from public.message_recipients mr
              where mr.message_id = m.id and mr.recipient_id = auth.uid()
            )
          )
        )

        or (
          m.institution_id is not null
          and public.institution_staff_has_current_standing(auth.uid(), m.institution_id)
          and (
            m.sender_id = auth.uid()
            or exists (
              select 1 from public.message_recipients mr
              where mr.message_id = m.id and mr.recipient_id = auth.uid()
            )
          )
        )
      )
  );
$$;

grant execute on function public.can_view_message(uuid) to authenticated;

-- 3. send_message() -- new SNA sender branch on the child-conversation
-- side, inserted alongside class_teacher (both "school staff working
-- directly with this child" tiers) and ahead of clinician/principal.
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
    -- Staff-to-staff branch, unchanged.
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

    if v_sender_role not in ('class_teacher', 'sna', 'principal') then
      raise exception 'You are not authorized to message staff at this institution.';
    end if;
  else
    -- Child-conversation branch -- NEW sna elsif inserted after
    -- class_teacher, before clinician.
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

-- 4. message_categories -- DATA update (this table's own established
-- convention: editing this set is a data edit, never a code change).
-- 'sna' added everywhere 'class_teacher' already is, on the reasoning
-- that an SNA works directly with a child day-to-day the same way a
-- class teacher does -- operational parity, not the narrower
-- escalation-contact set principal got (0161). Excludes "Sleep/morning
-- heads-up" (parent-reporting-in only, not staff-initiated regardless
-- of role) and "Strategy update" (clinician-authorship-specific).
update public.message_categories
set allowed_sender_roles = array_append(allowed_sender_roles, 'sna')
where applies_to = 'child'
  and 'class_teacher' = any(allowed_sender_roles)
  and not ('sna' = any(allowed_sender_roles));
