-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Respite UI Stage 2b -- Messages. Three things established by reading
-- the live schema before writing anything, per Daniel's own explicit
-- instruction, none of them assumed:
--
-- 1. READ/UNREAD STATE ALREADY EXISTS, no migration needed for it.
--    message_recipients.read_at (0170) -- a genuinely separate column
--    from acknowledged_at, added specifically because "seen it" and
--    "dealt with it" are different claims (0170's own header). Stamped
--    by the existing mark_message_read() RPC, already generic, never
--    special-cased by category -- it works for Handover unchanged.
--
-- 2. SCOPING IS NARROWER THAN "manager across the centre, care staff
--    for placements" -- READ IT DIRECTLY (can_view_message(), live def
--    0302) rather than assumed: a handover is readable by BOTH roles
--    identically, gated on a CURRENTLY OPEN respite_activations row for
--    that specific child, not centre_manager's own wider placement-
--    scoped reach used everywhere else in this PRD. Quoted verbatim
--    from the live policy:
--
--      -- NEW: a respite worker (either role) with an open activation
--      -- for this child -- handover is inside-the-stay content, so
--      -- this deliberately does NOT match Stage 4's placement-scoped
--      -- manager reach; both roles read it the same, narrower way.
--      or (
--        m.passport_id is not null
--        and exists (
--          select 1 from public.institution_staff s
--          where s.user_id = auth.uid()
--            and s.role in ('centre_manager', 'care_staff')
--            and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
--            and exists (
--              select 1 from public.respite_activations a
--              where a.passport_id = m.passport_id
--                and a.institution_id = s.institution_id
--                and a.closed_at is null
--            )
--        )
--        and (
--          m.sender_id = auth.uid()
--          or exists (
--            select 1 from public.message_recipients mr
--            where mr.message_id = m.id and mr.recipient_id = auth.uid()
--          )
--        )
--      )
--
--    Consequence, load-bearing for this whole feature: a handover
--    genuinely stops being readable -- by anyone, including the centre
--    manager -- the moment its child's activation closes (report
--    finalised, manually closed, or expired). This inbox can only ever
--    list handovers for children currently on-site, never a full
--    history. That is not a limitation of this migration; it is what
--    the read policy has always meant, and it is the correct behaviour
--    -- handover is inside-the-stay content, not report material.
--
-- 3. GENERAL STAFF-TO-STAFF MESSAGING REMAINS OUT OF SCOPE, confirmed
--    by grepping every message_categories insert across every
--    migration: exactly one category exists for centre_manager/
--    care_staff -- 'Handover', applies_to 'child' (0302). No
--    applies_to 'staff' category has ever been widened to admit either
--    role. "Messages" here means handovers, nothing else.
--
-- get_my_handover_messages() -- a genuinely new RPC, because nothing in
-- this schema lists messages across MULTIPLE passports for one caller;
-- every existing reader (useMessageThread, MessageList) is per-passport.
-- Restates can_view_message()'s own real gate directly (activation
-- open, sender-or-recipient) rather than approximating it, and resolves
-- the child's own name the established safe way (a server-side join
-- inside a SECURITY DEFINER function, same as get_my_centre_active_
-- children()/get_respite_child_summary()) -- never a raw client-side
-- embedded join into passports, which this schema's own standing
-- gotcha says returns silently empty for a caller with no direct grant
-- on that table.
create or replace function public.get_my_handover_messages(p_institution_id uuid)
returns table (
  message_id uuid,
  passport_id uuid,
  child_name text,
  sender_id uuid,
  sender_name text,
  body text,
  created_at timestamptz,
  is_read boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not exists (
    select 1 from public.institution_staff s
    where s.user_id = auth.uid()
      and s.institution_id = p_institution_id
      and s.role in ('centre_manager', 'care_staff')
      and public.institution_staff_has_current_standing(s.user_id, p_institution_id)
  ) then
    raise exception 'Not authorized for this institution.';
  end if;

  return query
  select
    m.id,
    m.passport_id,
    p.child_name,
    m.sender_id,
    coalesce(su.raw_user_meta_data ->> 'full_name', su.raw_app_meta_data ->> 'full_name'),
    m.body,
    m.created_at,
    (m.sender_id = auth.uid() or mr.read_at is not null) as is_read
  from public.messages m
  join public.message_categories mc on mc.id = m.category_id and mc.label = 'Handover'
  join public.passports p on p.id = m.passport_id
  join auth.users su on su.id = m.sender_id
  left join public.message_recipients mr on mr.message_id = m.id and mr.recipient_id = auth.uid()
  where exists (
      select 1 from public.respite_activations a
      where a.passport_id = m.passport_id
        and a.institution_id = p_institution_id
        and a.closed_at is null
    )
    and (
      m.sender_id = auth.uid()
      or exists (
        select 1 from public.message_recipients mr2
        where mr2.message_id = m.id and mr2.recipient_id = auth.uid()
      )
    )
  order by m.created_at desc;
end;
$$;

grant execute on function public.get_my_handover_messages(uuid) to authenticated;
