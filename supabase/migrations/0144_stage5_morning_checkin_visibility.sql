-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 3, Stage 5 -- morning check-in visibility. Each guardian keeps
-- their own check-in (separated parents describe different mornings at
-- different houses) -- what changes is what a guardian SEES before they
-- submit: the state of the CHILD's morning, not their own submission
-- history.
--
-- The real fix is at the RLS layer, not just the client query shape.
-- "Users can view their own check-ins" (live since 0006) has always been
-- auth.uid() = user_id -- a co-guardian genuinely cannot read another
-- guardian's row today, not just "the client never asked the right way."
-- Widened to owns_passport(passport_id), the same pattern already used
-- for Sections A-D and ABC logs' own parent branch. INSERT is
-- deliberately untouched: auth.uid() = user_id stays exactly as it is --
-- each guardian still only ever submits as themselves.
--
-- No unique constraint exists on this table and none is added here --
-- multiple rows per child per day were already structurally possible,
-- confirmed empirically before writing this migration, not assumed.

alter policy "Users can view their own check-ins"
  on public.morning_checkins
  using (
    public.owns_passport(morning_checkins.passport_id)
  );

-- get_todays_checkin() -- the priority ordering IS the three-state UI:
-- the caller's own row wins if one exists today (regardless of whether
-- a co-guardian also submitted); otherwise the most recent row from
-- ANY guardian; otherwise no row at all. p_start_of_today is passed in
-- rather than computed server-side, matching the existing client's own
-- device-local-midnight boundary (new Date(); setHours(0,0,0,0)) --
-- computing "today" in the database's own timezone would silently
-- disagree with what the parent's own device considers today.
create or replace function public.get_todays_checkin(
  p_passport_id uuid,
  p_start_of_today timestamptz
)
returns table (
  id uuid,
  is_mine boolean,
  submitted_by_name text,
  sleep_quality text,
  regulation_state text,
  morning_stressors text[],
  heads_up text,
  submitted_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    c.id,
    c.user_id = auth.uid() as is_mine,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as submitted_by_name,
    c.sleep_quality, c.regulation_state, c.morning_stressors, c.heads_up, c.submitted_at
  from public.morning_checkins c
  join auth.users u on u.id = c.user_id
  where c.passport_id = p_passport_id
    and c.checked_in_at >= p_start_of_today
    and public.owns_passport(p_passport_id)
  order by (c.user_id = auth.uid()) desc, c.checked_in_at desc
  limit 1;
$$;

grant execute on function public.get_todays_checkin(uuid, timestamptz) to authenticated;
