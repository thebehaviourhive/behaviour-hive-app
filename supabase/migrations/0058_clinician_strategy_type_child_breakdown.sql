/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   Closing the Loop, Stage 4 -- one new RPC. The ranked strategy-type
   list itself is already covered by get_clinician_strategy_type_insights
   (built ahead of time in migration 0055), but "tapping a type drills
   into the per-child breakdown" has no existing query to serve it --
   0055's RPC groups by strategy_type only, never by (strategy_type,
   child). This mirrors that RPC's own structure almost exactly (same
   active_cases/strategies/home_feedback/school_feedback/filtered CTEs,
   same setting/period filters, same live-revocation scoping), narrowed
   to one strategy type and grouped by passport instead.

   p_strategy_type_id is nullable and matched with IS NOT DISTINCT FROM
   (not `=`) specifically so passing NULL drills into the "Untagged"
   bucket the same way 0055's own list already surfaces it -- `=` would
   never match a NULL column, silently returning zero rows for the one
   type a clinician is most likely to tap first (an unlabelled type is
   the whole point of the "nudge to tag" language in the brief). */

create or replace function public.get_clinician_strategy_type_child_breakdown(
  p_strategy_type_id uuid,
  p_setting text default null, -- 'home' | 'school' | null (both)
  p_period_days integer default null -- null = all time
)
returns table (
  passport_id uuid,
  child_name text,
  rating_count integer,
  helped_count integer,
  partly_count integer,
  not_count integer,
  home_rating_count integer,
  home_helped_count integer,
  school_rating_count integer,
  school_helped_count integer
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_clinician_id uuid := auth.uid();
begin
  if not public.is_verified_clinician(v_clinician_id) then
    raise exception 'Not authorized';
  end if;

  if p_setting is not null and p_setting not in ('home', 'school') then
    raise exception 'Invalid setting filter';
  end if;

  return query
  with active_cases as (
    -- Same live, query-enforced scope as 0055's own insights RPC: a
    -- case revoked since the top-level list was fetched simply isn't in
    -- this set on this call, no caching to invalidate.
    select ca.passport_id
    from public.clinician_access ca
    where ca.clinician_id = v_clinician_id and ca.is_active = true
  ),
  strategies as (
    select
      pcc.id,
      pcc.passport_id,
      case pcc.item_type
        when 'strategy_home' then 'recommendationsHome'
        when 'strategy_school' then 'recommendationsSchool'
        when 'strategy_shared' then 'recommendationsShared'
      end as group_key,
      pcc.content ->> 'source_entry_id' as source_entry_id
    from public.passport_clinical_content pcc
    join active_cases ac on ac.passport_id = pcc.passport_id
    where pcc.item_type in ('strategy_home', 'strategy_school', 'strategy_shared')
      and nullif(pcc.content ->> 'strategy_type_id', '')::uuid is not distinct from p_strategy_type_id
  ),
  home_feedback as (
    select s.passport_id, sf.rating, 'home'::text as setting
    from strategies s
    join public.fba_reports fr on fr.passport_id = s.passport_id
    join public.fba_calm_cards fc
      on fc.fba_id = fr.id
      and s.source_entry_id is not null
      and fc.strategy_ref = s.group_key || ':' || s.source_entry_id
    join public.strategy_feedback sf on sf.calm_card_id = fc.id
    where p_period_days is null or sf.created_at >= now() - (p_period_days || ' days')::interval
  ),
  school_feedback as (
    select s.passport_id, sf.rating, 'school'::text as setting
    from strategies s
    join public.strategy_feedback sf on sf.strategy_content_id = s.id
    where p_period_days is null or sf.created_at >= now() - (p_period_days || ' days')::interval
  ),
  filtered as (
    select * from home_feedback where p_setting is null or p_setting = 'home'
    union all
    select * from school_feedback where p_setting is null or p_setting = 'school'
  )
  select
    f.passport_id,
    p.child_name,
    count(*)::integer,
    count(*) filter (where f.rating = 'helped')::integer,
    count(*) filter (where f.rating = 'partly')::integer,
    count(*) filter (where f.rating = 'not')::integer,
    count(*) filter (where f.setting = 'home')::integer,
    count(*) filter (where f.setting = 'home' and f.rating = 'helped')::integer,
    count(*) filter (where f.setting = 'school')::integer,
    count(*) filter (where f.setting = 'school' and f.rating = 'helped')::integer
  from filtered f
  join public.passports p on p.id = f.passport_id
  group by f.passport_id, p.child_name
  order by count(*) desc;
end;
$$;

grant execute on function public.get_clinician_strategy_type_child_breakdown(uuid, text, integer) to authenticated;
