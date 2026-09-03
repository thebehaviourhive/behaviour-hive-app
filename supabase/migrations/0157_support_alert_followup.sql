-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Support Button, item 7 -- the principal's outstanding-actions bucket.
-- The NINTH bucket, not the eighth: PRD 3 Stage 3 already added
-- passport completions outstanding after PRD 2 Stage 7's original
-- "seven categories" text was written, so this dashboard already has
-- eight. Correcting the count here rather than silently absorbing it.
--
-- WHAT MAKES IT STOP BEING OUTSTANDING: option 2 (principal explicitly
-- marks followed up, with a required note) with option 3 auto-
-- satisfying it (a non-draft incident logged that references this exact
-- alert, via incidents.support_alert_id from 0156). The raiser closing
-- the alert does NOT clear this -- rejected outright, per Daniel: "the
-- point is that a principal who was absent still needs to follow up
-- after it is over."
--
-- CANCELLED ALERTS NEVER APPEAR HERE. is_likely_mistap is computed once
-- at close time (0153) and filtered out below -- a mis-tap never
-- propagated live to begin with, and putting one on a principal's
-- must-clear list trains them to dismiss the panel. It still shows in
-- the activity feed (0155), which is history, not a task.
--
-- ONLY CLOSED ALERTS APPEAR. A still-open alert is already visible via
-- the transformed nav bar itself (alertSlot, useSupportButtonNavSlots)
-- -- surfacing it a second time on the dashboard while still live would
-- be noise, not information. It becomes an outstanding action once it's
-- over and someone has to have followed up on it.

alter table public.support_alerts
  add column followed_up_at timestamptz,
  add column followed_up_by uuid references auth.users (id),
  add column followed_up_note text,
  add constraint support_alerts_followup_paired check (
    (followed_up_at is null and followed_up_by is null and followed_up_note is null)
    or (followed_up_at is not null and followed_up_by is not null and followed_up_note is not null)
  );

-- =====================================================================
-- mark_support_alert_followed_up() -- principal only, own institution,
-- required note. One record, not an append log -- matches this
-- bucket's own "clear it once" shape; refuses a second follow-up on an
-- already-followed-up alert.
-- =====================================================================

create or replace function public.mark_support_alert_followed_up(
  p_support_alert_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alert public.support_alerts;
begin
  select * into v_alert from public.support_alerts where id = p_support_alert_id;

  if v_alert.id is null then
    raise exception 'Support alert not found.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    where s.user_id = auth.uid()
      and s.institution_id = v_alert.institution_id
      and s.role = 'principal'
  ) or not public.institution_staff_has_current_standing(auth.uid(), v_alert.institution_id) then
    raise exception 'Only a principal at this school can mark this followed up.';
  end if;

  if v_alert.followed_up_at is not null then
    raise exception 'This alert has already been marked followed up.';
  end if;

  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'A note is required.';
  end if;

  update public.support_alerts
  set followed_up_at = now(), followed_up_by = auth.uid(), followed_up_note = trim(p_note)
  where id = p_support_alert_id;
end;
$$;

grant execute on function public.mark_support_alert_followed_up(uuid, text) to authenticated;

-- =====================================================================
-- get_institution_outstanding_support_alerts() -- the bucket's own
-- query. Principal-only (matches every other bucket source on this
-- dashboard), own institution, closed + not a mistap + not yet followed
-- up + no non-draft incident already referencing it. Name resolution
-- matches get_my_support_alert_status()'s own pattern (0154) exactly.
-- =====================================================================

create or replace function public.get_institution_outstanding_support_alerts(
  p_institution_id uuid
)
returns table (
  id uuid,
  raised_by_name text,
  room_names text[],
  raised_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    sa.id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name', 'A staff member'),
    sa.room_names,
    sa.raised_at
  from public.support_alerts sa
  left join auth.users u on u.id = sa.raised_by
  where sa.institution_id = p_institution_id
    and exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.institution_id = p_institution_id
        and s.role = 'principal'
    )
    and public.institution_staff_has_current_standing(auth.uid(), p_institution_id)
    and sa.closed_at is not null
    and sa.is_likely_mistap = false
    and sa.followed_up_at is null
    and not exists (
      select 1 from public.incidents i
      where i.support_alert_id = sa.id and i.status <> 'draft'
    )
  order by sa.raised_at asc;
$$;

grant execute on function public.get_institution_outstanding_support_alerts(uuid) to authenticated;
