-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 5 Stage 7's own screen, finally built (the RPC layer has been
-- live since 0227; nothing consumed it until now). One fix and three
-- genuinely new buckets, all following that migration's own established
-- shape exactly: a director-only caller check (role = 'principal',
-- current standing, verified type = 'clinic'), independently re-derived
-- per function rather than shared, ordered oldest-first.
--
-- =====================================================================
-- 1. get_institution_caseload_sizes() -- REORDERED, same signature and
-- return shape, so a bare CREATE OR REPLACE is correct here (unlike
-- 0255's widening of get_institution_clinicians(), this doesn't change
-- the RETURNS TABLE shape at all).
--
-- WHY, so nobody "improves" this back to sorting by size: this is a
-- COUNT for safely assigning new referrals -- "who has room" -- never a
-- ranking. Intent does not survive presentation: `order by
-- caseload_size desc` renders, the instant it becomes a list on a
-- screen, as a leaderboard of who is carrying the most, regardless of
-- what the number is FOR. Ordered by name instead -- alphabetical,
-- carrying no signal about load at all. The count itself is unchanged;
-- only the row order is.
-- =====================================================================

create or replace function public.get_institution_caseload_sizes(p_institution_id uuid)
returns table (
  clinician_id uuid,
  full_name text,
  caseload_size integer
)
language sql
security definer
set search_path = public
stable
as $$
  with counts as (
    select ca.clinician_id, count(*)::integer as caseload_size
    from public.clinician_access ca
    where ca.engaged_by = 'institution'
      and ca.engaged_by_institution_id = p_institution_id
      and ca.is_active = true
      and public.is_verified_clinician(ca.clinician_id)
    group by ca.clinician_id
  )
  select c.clinician_id, coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name, c.caseload_size
  from counts c
  join auth.users u on u.id = c.clinician_id
  where exists (
    select 1 from public.institution_staff caller
    join public.institutions inst on inst.id = caller.institution_id
    where caller.institution_id = p_institution_id
      and caller.user_id = auth.uid()
      and caller.role = 'principal'
      and inst.status = 'verified'
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(caller.user_id, caller.institution_id)
  )
  order by full_name;
$$;

grant execute on function public.get_institution_caseload_sizes(uuid) to authenticated;

-- =====================================================================
-- 2. get_institution_draft_bsps() -- the exact shape of Stage 7's own
-- get_institution_draft_fbas(), for the artefact type that didn't exist
-- when that migration was written (bsp, migration 0238, postdates
-- 0227). bsp carries its own institution_id directly (unlike
-- fba_reports, which has none, hence draft FBAs resolving via the
-- clinician's own institution_staff membership instead) -- filtered on
-- that column directly, simpler and more exactly correct: a plan
-- genuinely tied to THIS clinic, not merely authored by someone who
-- happens to work there.
-- =====================================================================

create or replace function public.get_institution_draft_bsps(p_institution_id uuid)
returns table (
  bsp_id uuid,
  passport_id uuid,
  child_name text,
  clinician_id uuid,
  clinician_name text,
  status text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select b.id, b.passport_id, p.child_name, b.clinician_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'), b.status, b.created_at
  from public.bsp b
  join public.passports p on p.id = b.passport_id
  join auth.users u on u.id = b.clinician_id
  where b.status = 'draft'
    and b.institution_id = p_institution_id
    and exists (
      select 1 from public.institution_staff caller
      join public.institutions inst on inst.id = caller.institution_id
      where caller.institution_id = p_institution_id
        and caller.user_id = auth.uid()
        and caller.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(caller.user_id, caller.institution_id)
    )
  order by b.created_at;
$$;

grant execute on function public.get_institution_draft_bsps(uuid) to authenticated;

-- =====================================================================
-- 3. get_institution_incomplete_assessments() -- same shape again, for
-- assessments (migration 0231, also postdates 0227). assessments has no
-- institution_id column at all -- resolved via the clinician's own
-- institution_staff membership, the same shape get_institution_draft_
-- fbas() already uses for the identical reason. "Not completed" is the
-- RPC's own filter (completed_at is null) -- no threshold, no "overdue,"
-- matching every other bucket's own "still open" framing.
-- =====================================================================

create or replace function public.get_institution_incomplete_assessments(p_institution_id uuid)
returns table (
  assessment_id uuid,
  passport_id uuid,
  child_name text,
  clinician_id uuid,
  clinician_name text,
  instrument_name text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select a.id, a.passport_id, p.child_name, a.clinician_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'), ai.name, a.created_at
  from public.assessments a
  join public.passports p on p.id = a.passport_id
  join public.assessment_instruments ai on ai.id = a.instrument_id
  join auth.users u on u.id = a.clinician_id
  where a.completed_at is null
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = p_institution_id
        and s.user_id = a.clinician_id
        and s.role = 'clinician'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
    and exists (
      select 1 from public.institution_staff caller
      join public.institutions inst on inst.id = caller.institution_id
      where caller.institution_id = p_institution_id
        and caller.user_id = auth.uid()
        and caller.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(caller.user_id, caller.institution_id)
    )
  order by a.created_at;
$$;

grant execute on function public.get_institution_incomplete_assessments(uuid) to authenticated;

-- =====================================================================
-- 4. get_institution_pending_cross_org_grants() -- cross_organisation_
-- grants (migration 0245, also postdates 0227). A director proposed
-- sharing something with a school and it's sitting unconfirmed by the
-- family -- a genuinely new fact to surface, scoped to grants THIS
-- clinic proposed (granting_institution_id), status = 'proposed' only
-- (active/declined/revoked are all resolved, nothing outstanding).
-- =====================================================================

create or replace function public.get_institution_pending_cross_org_grants(p_institution_id uuid)
returns table (
  grant_id uuid,
  passport_id uuid,
  child_name text,
  receiving_institution_name text,
  scope_items text[],
  proposed_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select g.id, g.passport_id, p.child_name, inst2.name, g.scope_items, g.proposed_at
  from public.cross_organisation_grants g
  join public.passports p on p.id = g.passport_id
  join public.institutions inst2 on inst2.id = g.receiving_institution_id
  where g.granting_institution_id = p_institution_id
    and g.status = 'proposed'
    and exists (
      select 1 from public.institution_staff caller
      join public.institutions inst on inst.id = caller.institution_id
      where caller.institution_id = p_institution_id
        and caller.user_id = auth.uid()
        and caller.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(caller.user_id, caller.institution_id)
    )
  order by g.proposed_at;
$$;

grant execute on function public.get_institution_pending_cross_org_grants(uuid) to authenticated;
