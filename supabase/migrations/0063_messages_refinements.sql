-- MESSAGES -- post-launch refinements: sender-only closure (Change 2)
-- and the waiting-count badge's backing RPC (Change 3).

-- =====================================================================
-- Change 2: only the sender may close a response-required message --
-- the person who requested the exchange decides when it's resolved.
-- Recipients keep every other action (acknowledge, reply) but lose
-- Close. Existing conversations a recipient already closed under the
-- old rule stay closed -- this only changes who CAN close from now on,
-- nothing retroactive.
-- =====================================================================
create or replace function public.close_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  update public.messages
  set status = 'closed'
  where id = p_message_id
    and response_required = true
    and status <> 'closed'
    and sender_id = v_uid;

  if not found then
    raise exception 'This message cannot be closed (not found, not response-required, already closed, or you are not the sender).';
  end if;
end;
$$;

grant execute on function public.close_message(uuid) to authenticated;

-- =====================================================================
-- Change 3: the waiting-count badge's single source of truth, shared by
-- all three dashboards (and, for teacher/clinician, the same number
-- their existing "Unopened/Open Messages" stat card shows -- one
-- authoritative count computed here instead of two slightly different
-- approximations).
--
-- Counts DISTINCT messages needing this caller's action:
--  - they're a recipient, haven't acknowledged, and it isn't closed; OR
--  - it's a response-required, non-closed thread they're a participant
--    in (sender or recipient), AND the most recent reply (if any) was
--    posted by someone else -- "the ball is in your court". A thread
--    with no replies yet that they've already acknowledged does NOT
--    count again here (nothing new to see); one they replied to last
--    doesn't count either (they're the one waiting now, not acting).
--
-- Self-scoped to auth.uid() throughout, so a clinician's read-only
-- parent<->teacher "Viewing only" traffic never contributes -- they're
-- neither sender nor recipient of those rows, full stop, the same rule
-- can_view_message already enforces for visibility.
-- =====================================================================
create or replace function public.get_messages_awaiting_action_count()
returns integer
language sql
security definer
set search_path = public
stable
as $$
  with my_recipient_unacked as (
    select m.id
    from public.messages m
    join public.message_recipients mr on mr.message_id = m.id
    where mr.recipient_id = auth.uid()
      and mr.acknowledged_at is null
      and m.status <> 'closed'
  ),
  my_rr_participant as (
    select m.id, m.sender_id
    from public.messages m
    where m.response_required = true
      and m.status <> 'closed'
      and (
        m.sender_id = auth.uid()
        or exists (
          select 1 from public.message_recipients mr2
          where mr2.message_id = m.id and mr2.recipient_id = auth.uid()
        )
      )
  ),
  latest_reply as (
    select distinct on (message_id) message_id, author_id
    from public.message_replies
    order by message_id, created_at desc
  ),
  rr_needs_my_action as (
    select p.id
    from my_rr_participant p
    join latest_reply lr on lr.message_id = p.id
    where lr.author_id <> auth.uid()
  )
  select count(*)::integer
  from (
    select id from my_recipient_unacked
    union
    select id from rr_needs_my_action
  ) combined;
$$;

grant execute on function public.get_messages_awaiting_action_count() to authenticated;
