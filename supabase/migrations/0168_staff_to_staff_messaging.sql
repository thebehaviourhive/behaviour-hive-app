-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Staff-to-staff messaging, SMALL VERSION per Daniel's own decision:
-- institution-wide reach, SNA included as a staff-thread participant,
-- flat list (no triage screen), SNA-on-CHILD-threads deliberately
-- deferred as its own piece -- see CLAUDE.md's deferred-work entry for
-- why that's a parked decision (0065), not scope this feature created.
--
-- =====================================================================
-- SHAPE: one table, not two. messages.passport_id becomes nullable;
-- a new messages.institution_id carries the staff-thread case. A
-- constraint enforces exactly one of the two is ever set -- never
-- both, never neither -- so the two kinds of message are told apart
-- by two columns being POSITIVELY set, not by one being absent.
--
-- Every existing can_view_message() branch is already keyed on
-- m.passport_id (owns_passport(m.passport_id), pa.passport_id =
-- m.passport_id, etc.) -- in SQL, comparing or joining against NULL is
-- never true, so a null-passport_id row is already structurally
-- invisible to all of them, before the new branch below is even
-- written. The new staff branch is the only one that can ever fire on
-- such a row, and it requires m.institution_id is not null explicitly
-- -- so even if the CHECK constraint were somehow bypassed, a
-- real-passport_id row still can't satisfy the staff branch (needs
-- institution_id) and a real-institution_id row still can't satisfy
-- any child branch (needs passport_id). Two locks, neither depending
-- on the other.
--
-- One table keeps every existing role-blind RPC role-blind for free:
-- acknowledge_message(), reply_to_message(), close_message(), and
-- get_messages_awaiting_action_count() all key purely on message_id /
-- sender_id / recipient_id, with zero passport_id reference (read and
-- confirmed against each live body before writing this) -- a staff
-- thread becomes a real row those already correctly count, with no
-- change to any of the four.
--
-- =====================================================================
-- ROLE CONSTRAINTS: swept every CHECK constraint on a *_role column in
-- the whole schema before writing this (the 0161/0163 lesson -- two
-- independent constraints refused that pass, the second found only by
-- looking). Full list found: strategy_feedback.rater_role ('parent',
-- 'teacher' -- unrelated table, untouched), abc_logs.logged_by_role
-- (already has 'sna', untouched), institution_staff.role (already has
-- 'sna', untouched), passport_access.actor_role (already has 'sna',
-- untouched), principal_handovers.staying_role (already has 'sna',
-- unrelated to messaging, untouched). Exactly two govern this feature
-- -- messages.sender_role and message_recipients.recipient_role, both
-- still missing 'sna' since 0163 only added 'principal' -- both widened
-- below.
--
-- =====================================================================
-- CATEGORIES: three, not one -- Daniel's own call ("General alone is a
-- chat channel with a label"). applies_to ties a category to which
-- kind of message it's valid on -- nothing stopped a "Wellbeing note"
-- (a CHILD category) being picked on a staff thread before this;
-- send_message() below checks it. Existing ten default to 'child', no
-- backfill needed -- ADD COLUMN ... DEFAULT ... NOT NULL fills existing
-- rows automatically.
--
-- =====================================================================
-- send_message(): p_passport_id keeps its EXACT existing signature (no
-- default added to it) -- deliberately, to sidestep any question about
-- whether adding a default to a previously-required parameter is a
-- safe CREATE OR REPLACE. p_institution_id is a brand new TRAILING
-- parameter with a default, the same safe pattern 0161 already used
-- adding p_abc_log_id/p_strategy_update. Every caller (old and new)
-- must still explicitly pass p_passport_id -- a staff send passes
-- p_passport_id: null, p_institution_id: <id>. Exactly one of the two
-- must be non-null, enforced at the top of the function body.
--
-- get_institution_staff_candidates() is a NEW function, not a variant
-- of get_message_recipient_candidates() -- there's no passport to
-- authorize a candidate list against, the same reasoning that kept
-- get_institution_child_roster()/get_institution_staff_roster()
-- separate rather than one overloaded thing.
-- =====================================================================

-- 1. messages -- the shape.
alter table public.messages alter column passport_id drop not null;
alter table public.messages add column institution_id uuid references public.institutions (id);

alter table public.messages add constraint messages_exactly_one_scope
  check (
    (passport_id is not null and institution_id is null)
    or (passport_id is null and institution_id is not null)
  );

create index if not exists messages_institution_id_idx on public.messages (institution_id);

-- 2. Role constraints -- add 'sna'.
alter table public.messages drop constraint if exists messages_sender_role_check;
alter table public.messages add constraint messages_sender_role_check
  check (sender_role in ('parent', 'class_teacher', 'clinician', 'principal', 'sna'));

alter table public.message_recipients drop constraint if exists message_recipients_recipient_role_check;
alter table public.message_recipients add constraint message_recipients_recipient_role_check
  check (recipient_role in ('parent', 'class_teacher', 'clinician', 'principal', 'sna'));

-- 3. message_categories -- applies_to, plus the three new staff rows.
alter table public.message_categories
  add column applies_to text not null default 'child' check (applies_to in ('child', 'staff'));

insert into public.message_categories (label, description, allowed_sender_roles, applies_to, sort_order, is_active)
values
  ('Cover / Rota', 'A cover arrangement, scheduling, or rota question.', array['class_teacher', 'sna', 'principal'], 'staff', 10, true),
  ('Class / Roster', 'Something about a class or pupil roster, not clinical or behavioural.', array['class_teacher', 'sna', 'principal'], 'staff', 20, true),
  ('General', 'Anything else.', array['class_teacher', 'sna', 'principal'], 'staff', 30, true)
on conflict do nothing;

-- 4. can_view_message() -- CREATE OR REPLACE, same signature. New
--    branch only; every existing branch is untouched and, per the
--    header comment above, structurally cannot fire on a staff
--    message regardless.
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

        -- NEW: staff-to-staff. Requires m.institution_id is not null
        -- explicitly (not merely "passport_id is null") -- keyed to
        -- the POSITIVE presence of the new column, matching every
        -- other branch's own shape (a real relationship AND
        -- sender-or-recipient), never a bare institution-membership
        -- check.
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

-- 5. get_institution_staff_candidates() -- NEW. Who a staff-thread
--    sender can pick from: active class_teacher/sna/principal at the
--    caller's own institution, excluding self. institution_admin
--    deliberately excluded from the role list -- that role exists only
--    in the institution_staff CHECK constraint for a self-service
--    onboarding flow (C-08) that isn't built and has no real users yet
--    (see CLAUDE.md), not a live participant to offer here.
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
    and s.role in ('class_teacher', 'sna', 'principal')
    and public.institution_staff_has_current_standing(s.user_id, p_institution_id)
    and s.user_id <> auth.uid();
$$;

grant execute on function public.get_institution_staff_candidates(uuid) to authenticated;

-- 6. send_message() -- CREATE OR REPLACE, new trailing p_institution_id
--    param (default null), p_passport_id's own signature untouched.
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

  -- Exactly one of passport_id / institution_id -- the same guarantee
  -- the table's own CHECK constraint enforces, checked here first so a
  -- malformed call fails with a clear message rather than a raw
  -- constraint-violation error.
  if (p_passport_id is null) = (p_institution_id is null) then
    raise exception 'Exactly one of a child or a staff conversation must be specified.';
  end if;

  if p_institution_id is not null then
    -- Staff-to-staff branch.
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
    -- Existing child-conversation branch, untouched.
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

  -- Response Required cap, same 3-open-conversations rule, scoped by
  -- whichever of passport_id/institution_id this message belongs to.
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
