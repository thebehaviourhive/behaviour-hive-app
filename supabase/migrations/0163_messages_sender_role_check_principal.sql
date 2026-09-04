-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- SECOND real bug found in the same live-verification pass as 0162,
-- one level lower. 0161 added a principal branch to send_message()'s
-- own v_sender_role determination and correctly walked it through
-- get_message_recipient_candidates()'s cross-check -- but never
-- touched the TABLE's own check constraint, still exactly as 0061
-- first wrote it:
--
--   sender_role text not null check (sender_role in ('parent', 'class_teacher', 'clinician'))
--
-- So a principal composing a message now resolves v_sender_role =
-- 'principal' correctly inside send_message(), passes every RLS/
-- authorization check 0161 added, and then the INSERT itself is
-- refused at the database level:
--
--   new row for relation "messages" violates check constraint "messages_sender_role_check"
--
-- Caught live, testing the actual principal-composes-to-a-parent send
-- (not just the candidate lookup 0162 fixed) -- this is the second
-- layer of the same "principal doesn't exist in this model yet" gap,
-- underneath the one 0162 closed. Fix: widen the constraint to include
-- 'principal'. SNA deliberately excluded -- SNA messaging is parked,
-- unbuilt, and unrelated to this fix (see CLAUDE.md, "SNA MESSAGING --
-- STILL NOT BUILT").
--
-- Found the same bug's TWIN on the sibling table before it could bite
-- live: message_recipients.recipient_role carries the identical
-- unwidened constraint from the same 0061 migration. Every message a
-- principal RECEIVES (a parent or teacher writing to them, the read
-- side 0161 built first) inserts a message_recipients row with
-- recipient_role = 'principal' -- exactly the same INSERT-time refusal
-- as the sender side, just not yet hit by this verification pass
-- because the send it was testing failed one step earlier. Fixed here
-- in the same migration rather than waiting to trip over it separately.

alter table public.messages drop constraint if exists messages_sender_role_check;
alter table public.messages add constraint messages_sender_role_check
  check (sender_role in ('parent', 'class_teacher', 'clinician', 'principal'));

alter table public.message_recipients drop constraint if exists message_recipients_recipient_role_check;
alter table public.message_recipients add constraint message_recipients_recipient_role_check
  check (recipient_role in ('parent', 'class_teacher', 'clinician', 'principal'));
