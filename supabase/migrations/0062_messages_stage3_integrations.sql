-- MESSAGES -- Stage 3 of 3: the two integrations (ABC incident
-- notifications, Strategy Update acknowledgments). No new tables, no
-- new columns -- messages.abc_log_id and messages.strategy_update
-- already exist from Stage 1 (0061), unused until now. The only
-- necessary change is letting the SEND flow actually set them: the
-- table is immutable by design (no UPDATE policy for authenticated on
-- messages, per 0061's own comment), so there is no later path to
-- backfill these two columns after insert -- they must be set inside
-- send_message itself, which means extending its signature.
--
-- CREATE OR REPLACE FUNCTION cannot change a function's parameter list
-- in place (Postgres treats a different parameter list as a distinct
-- overload, not a replacement) -- the old 5-arg send_message is
-- dropped explicitly first so exactly one version exists afterward.

drop function if exists public.send_message(uuid, uuid, text, boolean, uuid[]);

create or replace function public.send_message(
  p_passport_id uuid,
  p_category_id uuid,
  p_body text,
  p_response_required boolean,
  p_recipient_ids uuid[],
  -- Stage 3 additions, both optional/backward-compatible (existing
  -- callers that omit them get the same behaviour as before).
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

  -- Same authorization shape as get_message_recipient_candidates: a
  -- sender must be a genuine, currently-active participant.
  if public.owns_passport(p_passport_id) then
    v_sender_role := 'parent';
  elsif exists (
    select 1 from public.passport_access pa
    join public.passport_institution_links pil
      on pil.passport_id = pa.passport_id and pil.institution_id = pa.institution_id
    where pa.passport_id = p_passport_id
      and pa.teacher_id = v_uid
      and pa.is_active = true
      and pil.approved_by_parent = true
  ) then
    v_sender_role := 'class_teacher';
  elsif public.is_verified_clinician(v_uid) and exists (
    select 1 from public.clinician_access ca
    where ca.passport_id = p_passport_id
      and ca.clinician_id = v_uid
      and ca.is_active = true
  ) then
    v_sender_role := 'clinician';
  else
    raise exception 'You are not authorized to message about this child.';
  end if;

  -- Category must be active and available to this sender role -- the
  -- compose sheet's own chip filtering is a nicety, this is the
  -- guarantee. "Strategy update" being clinician-only in
  -- allowed_sender_roles is what actually blocks a teacher/parent from
  -- sending one, including via a direct RPC call (verify item 6).
  select allowed_sender_roles, label into v_category_roles, v_category_label
  from public.message_categories
  where id = p_category_id and is_active = true;

  if v_category_roles is null then
    raise exception 'Invalid or inactive category.';
  end if;
  if not (v_sender_role = any(v_category_roles)) then
    raise exception 'This category is not available to your role.';
  end if;

  -- Stage 3A: an attached incident log must belong to THIS passport --
  -- otherwise a sender could reference an unrelated child's log id
  -- (the log's own RLS still protects its content when a recipient
  -- later views it, but the reference itself must not be forgeable
  -- across passports).
  if p_abc_log_id is not null and not exists (
    select 1 from public.abc_logs where id = p_abc_log_id and passport_id = p_passport_id
  ) then
    raise exception 'That incident log does not belong to this child.';
  end if;

  -- Stage 3B: the strategy_update flag and the "Strategy update"
  -- category travel together -- both or neither, checked server-side
  -- rather than trusted from the client.
  if p_strategy_update and v_category_label is distinct from 'Strategy update' then
    raise exception 'strategy_update can only be set on a Strategy update message.';
  end if;

  -- Response Required cap: max 3 concurrent open response_required
  -- messages per sender per child, checked here so it holds even
  -- against a direct RPC call, not just the compose sheet's UI state.
  if p_response_required then
    select count(*) into v_open_rr_count
    from public.messages m
    where m.passport_id = p_passport_id
      and m.sender_id = v_uid
      and m.response_required = true
      and m.status <> 'closed';

    if v_open_rr_count >= 3 then
      raise exception 'You already have 3 open response-required messages for this child. Close one before sending another.';
    end if;
  end if;

  insert into public.messages (
    passport_id, sender_id, sender_role, category_id, body, response_required, status,
    abc_log_id, strategy_update
  )
  values (
    p_passport_id, v_uid, v_sender_role, p_category_id, p_body, p_response_required, 'open',
    p_abc_log_id, p_strategy_update
  )
  returning id into v_message_id;

  -- Recipients are validated by construction: only ids that appear in
  -- get_message_recipient_candidates' own result for this passport (the
  -- exact same set the compose sheet offered) can become a recipient
  -- row. A mismatch after the insert means the caller passed an id that
  -- isn't a genuine, currently-active participant -- reject outright
  -- rather than silently dropping it.
  insert into public.message_recipients (message_id, recipient_id, recipient_role)
  select v_message_id, c.recipient_id, c.role
  from public.get_message_recipient_candidates(p_passport_id) c
  where c.recipient_id = any(p_recipient_ids);

  select count(*) into v_recipient_count
  from public.message_recipients
  where message_id = v_message_id;

  if v_recipient_count <> array_length(p_recipient_ids, 1) then
    raise exception 'One or more recipients are not valid participants for this child.';
  end if;

  return v_message_id;
end;
$$;

grant execute on function public.send_message(uuid, uuid, text, boolean, uuid[], uuid, boolean) to authenticated;

-- =====================================================================
-- "Incident note" category -- data, not code (same status as the
-- original 10 seeded in 0061; editable later via the Table Editor,
-- never a code change). Parent + teacher only, per the brief: ABC-log
-- notifications are a parent/teacher touchpoint -- clinician-authored
-- logs are clinical workspace activity, not something this category
-- needs to cover, and "Strategy update" already exists from 0061 as
-- the clinician-only equivalent for Stage 3B.
-- =====================================================================
-- message_categories has no unique constraint on label (by design --
-- categories are freeform data), so a plain "on conflict do nothing"
-- would have no target and re-running this migration would insert a
-- duplicate row every time. Guard with an explicit existence check
-- instead, safe to run more than once.
insert into public.message_categories (label, description, allowed_sender_roles, sort_order, is_active)
select 'Incident note', 'Sharing an ABC incident log with the team.', array['parent', 'class_teacher'], 25, true
where not exists (select 1 from public.message_categories where label = 'Incident note');
