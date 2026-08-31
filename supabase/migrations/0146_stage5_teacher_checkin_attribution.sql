-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 3, Stage 5, teacher-side attribution. useTeacherMorningCheckins.ts
-- already reads morning_checkins correctly scoped (has_child_access(),
-- .in("passport_id", [...])) -- that part was never broken. What it
-- couldn't do is resolve a submitter's name (a plain client select
-- can't join auth.users, same reason as every other feature in this
-- build) or return more than one row per child -- its own "most recent
-- wins" reduction, correct when two rows meant a resubmission, now
-- silently discards a second guardian's real, different account.
--
-- This RPC returns EVERY check-in from today, for every requested
-- passport, attributed by name. No "most recent wins" reduction here --
-- that decision moves to the client, which needs to keep every row to
-- show a genuine disagreement rather than silently pick one.

create or replace function public.get_todays_checkins_for_passports(
  p_passport_ids uuid[],
  p_start_of_today timestamptz
)
returns table (
  passport_id uuid,
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
    c.passport_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as submitted_by_name,
    c.sleep_quality, c.regulation_state, c.morning_stressors, c.heads_up, c.submitted_at
  from public.morning_checkins c
  join auth.users u on u.id = c.user_id
  where c.passport_id = any(p_passport_ids)
    and c.checked_in_at >= p_start_of_today
    and public.has_child_access(auth.uid(), c.passport_id)
  order by c.submitted_at asc;
$$;

grant execute on function public.get_todays_checkins_for_passports(uuid[], timestamptz) to authenticated;
