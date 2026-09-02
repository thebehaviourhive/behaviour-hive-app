-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Support Button, nav rework -- the polling status RPC. Everything else
-- (support_alerts, support_alert_acknowledgements, raise/acknowledge/
-- close, get_active_support_alerts) is unchanged from 0153; this adds
-- one new function for the client's own poll loop (every 20-30s while
-- the nav is mounted, paused on visibilitychange, per the client build
-- alongside this).
--
-- PURPOSE-BUILT, NOT get_active_support_alerts() REUSED: a poll firing
-- every 20-30s per active session wants the smallest possible row, not
-- the fuller per-alert jsonb shape (acknowledgements as named jsonb
-- array) that function already returns for the "I want the full detail
-- now" case, unchanged and still used for that. This returns ONE row
-- (or none), backed by the existing partial index
-- (support_alerts_open_idx, institution_id where closed_at is null) --
-- close to a free index-only check when nothing is open, which is the
-- overwhelmingly common case.
--
-- MOST-RECENTLY-RAISED, PLUS A COUNT: raise_support_alert() only
-- refuses a SECOND open alert from the SAME raiser -- nothing stops two
-- DIFFERENT people each having one open at once, and a nav can only
-- show one alert's own detail. Resolved to the latest by raised_at,
-- with other_open_alert_count so the client can render "+N more" --
-- Daniel's own instruction: a nav naming one room while two need help
-- is a false statement, in the case it matters most.
create or replace function public.get_my_support_alert_status(p_institution_id uuid)
returns table (
  alert_id uuid,
  is_own boolean,
  i_acknowledged boolean,
  acknowledgement_count integer,
  room_names text[],
  raised_by_name text,
  raised_at timestamptz,
  other_open_alert_count integer
)
language sql
security definer
set search_path = public
stable
as $$
  with open_alerts as (
    select sa.*
    from public.support_alerts sa
    where sa.institution_id = p_institution_id
      and sa.closed_at is null
      and exists (
        select 1 from public.institution_staff s
        where s.institution_id = p_institution_id
          and s.user_id = auth.uid()
          and s.deactivated_at is null
          and s.approved_at is not null
      )
  ),
  latest as (
    select * from open_alerts order by raised_at desc limit 1
  )
  select
    latest.id as alert_id,
    (latest.raised_by = auth.uid()) as is_own,
    exists (
      select 1 from public.support_alert_acknowledgements ack
      where ack.support_alert_id = latest.id and ack.acknowledged_by = auth.uid()
    ) as i_acknowledged,
    (
      select count(*)::integer from public.support_alert_acknowledgements ack
      where ack.support_alert_id = latest.id
    ) as acknowledgement_count,
    latest.room_names,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as raised_by_name,
    latest.raised_at,
    ((select count(*) from open_alerts) - 1)::integer as other_open_alert_count
  from latest
  left join auth.users u on u.id = latest.raised_by;
$$;

grant execute on function public.get_my_support_alert_status(uuid) to authenticated;
