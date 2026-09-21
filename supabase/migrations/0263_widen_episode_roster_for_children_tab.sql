-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- TIER 1, ITEMS 1 AND 3 OF THE CLINIC UI LAYER BUILD, 21 Sept 2026.
-- get_institution_episode_roster() (0211) was built minimal, on
-- purpose, as infrastructure end_clinic_episode() needed to have an
-- episode_id to call with at all -- active episodes only, no ended_at/
-- end_reason in the return shape, zero client callers until now.
--
-- It's the correct data source for a clinic-side Children tab (a
-- clinic client's own "active vs discharged" split can never come from
-- get_institution_child_roster()'s enrolment_ended_at -- that column is
-- sourced from `enrolments`, a table a clinic client never has a row
-- in) and for the reopen picker (which needs to find a discharged
-- client's own most recent episode, not just an active one). Widened
-- rather than a second function written, per this codebase's own
-- "resolve through ONE place" discipline.
--
-- RETURNS TABLE shape changes -- DROP FUNCTION IF EXISTS then CREATE,
-- never a bare CREATE OR REPLACE, per this schema's own standing rule.
-- p_include_ended defaults false, matching this codebase's established
-- p_include_inactive/p_include_pending precedent -- the one existing
-- (zero) caller's behaviour is unchanged by default.

drop function if exists public.get_institution_episode_roster(uuid);

create function public.get_institution_episode_roster(
  p_institution_id uuid,
  p_include_ended boolean default false
)
returns table (
  episode_id uuid,
  passport_id uuid,
  child_name text,
  started_at timestamptz,
  ended_at timestamptz,
  end_reason text
)
language sql
security definer
set search_path = public
stable
as $$
  select e.id as episode_id, p.id as passport_id, p.child_name, e.started_at, e.ended_at, e.end_reason
  from public.episodes_of_care e
  join public.passports p on p.id = e.passport_id
  where e.institution_id = p_institution_id
    and (p_include_ended or e.ended_at is null)
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and s.approved_at is not null
        and s.deactivated_at is null
    )
  order by p.child_name;
$$;

grant execute on function public.get_institution_episode_roster(uuid, boolean) to authenticated;
