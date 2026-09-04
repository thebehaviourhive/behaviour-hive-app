-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Message read state -- a genuinely new column, not a repurposing of
-- acknowledged_at. Daniel's own reasoning, confirmed: collapsing the
-- two would silently change what "Acknowledge" has meant since 0061,
-- and a response-required thread is plausibly read long before anyone
-- replies. "Seen it" and "dealt with it" are different claims.
--
-- =====================================================================
-- read_at: stamped when a recipient opens a message, via a new
-- mark_message_read() RPC -- same idempotent shape as
-- acknowledge_message() (safe to retry from the offline-retry queue,
-- a no-op if already read or if the caller isn't actually a recipient
-- of this message, never a spurious error).
--
-- The nav badge (get_messages_awaiting_action_count()) is UNCHANGED --
-- it's correctly named for what it counts (awaiting your action), not
-- what it was mistaken for (unread). No SQL change to it in this
-- migration.
--
-- =====================================================================
-- SEPARATE, RELATED BUG, fixed in the same migration: reply_to_message()
-- has never stamped acknowledged_at for the replying user. Someone who
-- replies has unambiguously dealt with the message, but the awaiting-
-- action count keeps showing it -- confirmed empirically while building
-- 0168's own CHECK NNN (acknowledge_message() clears
-- my_recipient_unacked; reply_to_message() alone does not, since it
-- only ever touches message_replies/messages.status, never
-- message_recipients.acknowledged_at). This is a real fix to the
-- counting mechanism this migration is already touching, not scope
-- creep -- flagged here rather than folded in silently. If you'd rather
-- ship it separately, this block is easy to cut before running.
-- =====================================================================

alter table public.message_recipients add column read_at timestamptz;

create or replace function public.mark_message_read(p_message_id uuid)
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

  -- The WHERE clause IS the authorization, same idiom as
  -- acknowledge_message(): only a row where this caller is genuinely
  -- the recipient can ever be touched. Not a recipient, or already
  -- read -- both safe no-ops, never a spurious failure on retry.
  update public.message_recipients
  set read_at = now()
  where message_id = p_message_id
    and recipient_id = v_uid
    and read_at is null;
end;
$$;

grant execute on function public.mark_message_read(uuid) to authenticated;

-- reply_to_message() -- CREATE OR REPLACE, same signature (p_message_id
-- uuid, p_body text unchanged) -- adding a stamp to an existing table
-- this function already writes near, not a parameter change, so no
-- overload risk (see CLAUDE.md's own corrected gotcha on this exact
-- class of mistake). Only new statement: acknowledge the replying
-- user's own recipient row, if they have one and haven't already.
create or replace function public.reply_to_message(p_message_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_reply_id uuid;
  v_is_participant boolean;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  if p_body is null or char_length(trim(p_body)) = 0 then
    raise exception 'Reply cannot be empty.';
  end if;
  if char_length(p_body) > 200 then
    raise exception 'Reply must be 200 characters or fewer.';
  end if;

  select exists (
    select 1 from public.messages m
    where m.id = p_message_id
      and m.response_required = true
      and m.status <> 'closed'
      and (
        m.sender_id = v_uid
        or exists (
          select 1 from public.message_recipients mr
          where mr.message_id = m.id and mr.recipient_id = v_uid
        )
      )
  ) into v_is_participant;

  if not v_is_participant then
    raise exception 'You cannot reply to this message.';
  end if;

  insert into public.message_replies (message_id, author_id, body)
  values (p_message_id, v_uid, p_body)
  returning id into v_reply_id;

  update public.messages
  set status = 'in_discussion'
  where id = p_message_id and status <> 'closed';

  -- NEW: replying is unambiguous engagement -- acknowledge (and read,
  -- while we're touching this row) the replying user's own recipient
  -- row, same as acknowledge_message() would. A no-op for the sender
  -- (no message_recipients row of their own) and harmless if already
  -- acknowledged/read.
  update public.message_recipients
  set acknowledged_at = coalesce(acknowledged_at, now()),
      read_at = coalesce(read_at, now())
  where message_id = p_message_id
    and recipient_id = v_uid;

  return v_reply_id;
end;
$$;

grant execute on function public.reply_to_message(uuid, text) to authenticated;
