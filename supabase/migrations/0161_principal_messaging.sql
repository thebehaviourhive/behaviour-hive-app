-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Principal messaging. Confirmed before writing this: a principal
-- cannot be addressed today, through any path. get_message_recipient_
-- candidates() has exactly three branches -- parent, class_teacher,
-- clinician -- no principal branch, anywhere. And the picker isn't the
-- only gate: send_message() cross-checks every recipient id against
-- that same candidates function and refuses the whole send if any
-- recipient doesn't match ('One or more recipients are not authorized
-- participants for this child') -- so even a raw RPC call naming a
-- principal's id directly is refused today, not just hidden from the
-- UI. can_view_message() independently requires a pre-existing child
-- relationship (owns_passport/has_class_teacher_access/clinician_
-- access) before even checking sender-or-recipient -- a principal has
-- none of those, so simply becoming a message_recipients row would not
-- have been enough on its own.
--
-- Daniel's own correction to the original design: "threads they are
-- addressed on, nothing else" was the rule for READING -- a principal
-- must not inherit every conversation in the school by being
-- principal, and can_view_message() below still enforces exactly that
-- (sender-or-recipient, never a bare institution-membership check). It
-- was never a rule against SENDING. A principal who cannot message a
-- parent about their own child -- when they countersign restraint
-- records and are who a family escalates to -- is more constrained
-- than makes sense. So a principal CAN start a thread here, scoped to
-- children enrolled at their own institution.
--
-- FOUR CHANGES:
--   1. get_message_recipient_candidates() -- new principal branch
--      (recipient candidate: the active principal at the child's own
--      institution).
--   2. can_view_message() -- new principal branch (read access:
--      principal at the message's own institution AND
--      sender-or-recipient, matching every other branch's own shape).
--   3. send_message() -- new principal branch in the sender-role
--      determination, scoped to children enrolled at the principal's
--      own institution.
--   4. message_categories -- a DATA update (this table's own
--      established convention: "editing this set going forward is a
--      DATA edit, never a code change"), not a new migration behaviour.
--      Widened three categories to include 'principal': "Wellbeing
--      note", "Contact me when you can", "Other" -- the three already
--      spanning multiple roles including clinician, matching a
--      principal's own natural reason to write (a wellbeing check-in,
--      a general escalation contact, or anything else) rather than the
--      day-to-day operational categories (schedule/collection/
--      forgotten-item/medication/supplies/sleep) that stay teacher/
--      parent territory. Checked the LIVE data first, not the seed
--      migration alone -- no category currently lists 'principal';
--      adding the sender branch without a usable category would have
--      produced exactly the authenticate-then-refuse failure this
--      migration is otherwise built to avoid.
--
-- reply_to_message() needs NO change -- already completely role-blind
-- (sender_id = you OR you're a message_recipients row), confirmed by
-- reading it before writing any of this.
--
-- CREATE OR REPLACE is sufficient for all three functions -- same
-- signatures, same return shapes, only the branch lists change.

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

    -- NEW: the active principal at this child's own institution. Reuses
    -- the SAME `authorized` gate every other branch does -- only
    -- someone who already has legitimate standing on this child
    -- (parent, class teacher, clinician) can query candidates at all,
    -- so the authorization boundary for who may DISCUSS this child
    -- doesn't move; this only adds one more entry to who may appear as
    -- a TARGET.
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
  )
  select recipient_id, full_name, role
  from candidates
  where recipient_id <> auth.uid();
$$;

grant execute on function public.get_message_recipient_candidates(uuid) to authenticated;

-- can_view_message() -- new principal branch. Structured exactly like
-- the class_teacher/clinician branches above it: a real relationship
-- to the child (here: active principal at the SAME institution the
-- child is linked to) AND sender-or-recipient. This is the enforcement
-- of "threads they are addressed on, nothing else" -- a bare
-- institution-membership check would let a principal read every
-- conversation in the school; this requires them to actually be a
-- party to this specific one.
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
      )
  );
$$;

grant execute on function public.can_view_message(uuid) to authenticated;

-- send_message() -- new principal sender branch, scoped to children
-- enrolled at the principal's own institution (not institution-wide
-- "any child anywhere" -- a principal's authority to open a
-- conversation about a child is the same "this child belongs to my
-- school" boundary every other principal-scoped RPC in this schema
-- already uses).
create or replace function public.send_message(
  p_passport_id uuid,
  p_category_id uuid,
  p_body text,
  p_response_required boolean,
  p_recipient_ids uuid[],
  p_abc_log_id uuid default null,
  p_strategy_update boolean default false
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

  select array_agg(role_value)
  into v_category_roles
  from (
    select jsonb_array_elements_text(to_jsonb(mc.allowed_sender_roles)) as role_value
    from public.message_categories mc
    where mc.id = p_category_id and mc.is_active = true
  ) roles;

  select label into v_category_label
  from public.message_categories
  where id = p_category_id and is_active = true;

  if v_category_label is null then
    raise exception 'Invalid or inactive category.';
  end if;
  if not (v_sender_role = any(v_category_roles)) then
    raise exception 'This category is not available to your role.';
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
    select count(*) into v_open_rr_count
    from public.messages
    where passport_id = p_passport_id
      and sender_id = v_uid
      and response_required = true
      and status <> 'closed';
    if v_open_rr_count >= 3 then
      raise exception 'You already have 3 open response-required conversations for this child. Close one before starting another.';
    end if;
  end if;

  insert into public.messages (
    passport_id, sender_id, sender_role, category_id, body,
    response_required, status, abc_log_id, strategy_update
  ) values (
    p_passport_id, v_uid, v_sender_role, p_category_id, p_body,
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
  where rid <> v_uid;

  if exists (
    select 1 from public.message_recipients where message_id = v_message_id and recipient_role is null
  ) then
    raise exception 'One or more recipients are not authorized participants for this child.';
  end if;

  return v_message_id;
end;
$$;

grant execute on function public.send_message(uuid, uuid, text, boolean, uuid[], uuid, boolean) to authenticated;

-- message_categories -- DATA update, this table's own established
-- convention (0061: "editing this set going forward is a DATA edit
-- (UPDATE/INSERT rows), never a code change"). Checked live before
-- writing this -- no category currently lists 'principal'.
update public.message_categories
set allowed_sender_roles = array_append(allowed_sender_roles, 'principal')
where label in ('Wellbeing note', 'Contact me when you can', 'Other')
  and not ('principal' = any(allowed_sender_roles));
