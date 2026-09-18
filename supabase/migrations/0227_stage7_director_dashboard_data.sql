-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 5 Stage 7 -- the clinical director's dashboard, DATA ONLY. Every
-- prior stage in this build has been backend-only; this one matches,
-- per PRD section 10's own explicit instruction to design the screen
-- later, after the foundation is used. Four things, per Daniel's own
-- scoping, all of them director-only (role = 'principal', current
-- standing, at a verified type = 'clinic' institution -- the same
-- caller-authorization shape onboard_clinic_client() already uses):
--
--   1. THE TEAM FIX -- no SQL. get_passport_clinicians() (0124, reused
--      unchanged by 0221) already answers "which practitioner(s) are
--      engaged with this client" for a clinic director -- Stage 6's own
--      verification proved it live. get_passport_team() stays exactly
--      as broken as it is for clinic clients -- see this file's own
--      dedicated entry on why that's correct, not a gap: a principal is
--      not on their own school's team listing either, because
--      institution-wide oversight and per-client team membership are
--      already two different things in this schema. Recorded here so
--      the reasoning travels with the migration that would have been
--      the wrong fix, not just in prose elsewhere.
--
--   2. get_episode_overseeing_leads() -- "which leads cover this
--      client", the reverse of every existing scope question. Every
--      scope function until now (_lead_episode_in_scope, 0215/0226)
--      answers "is THIS ONE caller in scope" -- this answers "which
--      leads, across the whole institution, are in scope for THIS ONE
--      episode". Deliberately a SEPARATE implementation of Stage 4's
--      own AND-across-dimensions/OR-within-a-dimension rule, not a loop
--      that calls _lead_episode_in_scope() per lead -- the point of
--      building a second implementation is to have something to check
--      the first one against, not to duplicate it. GROUP BY / HAVING
--      instead of the original's two-CTE-and-compare-counts shape:
--      lead_dims collapses each lead's own scope rows to their DISTINCT
--      dimensions (matching institution_tags to resolve dimension name,
--      same as 0226); matched_dims does the same but only for scope
--      rows whose institution_tag_id appears among THIS episode's own
--      tags; a lead is in scope exactly when their own matched-dimension
--      count equals their own total-dimension count -- one dimension
--      short (out of scope, this episode is missing what that dimension
--      needed) is refused, any single value matching within a dimension
--      is enough (OR), and every one of a lead's own distinct dimensions
--      still has to be covered (AND). Verified live against
--      _lead_episode_in_scope() itself (via the real caller,
--      get_institution_episode_roster_for_lead()), not assumed to agree
--      because the English description matches.
--
--   3. THE OUTSTANDING-WORK BUCKETS. Three genuinely new listing RPCs
--      (episodes with no active institution-engaged practitioner,
--      pending clinic staff joins, FBAs in draft owned by this clinic's
--      own practitioners) -- get_pending_tag_change_requests() (0220)
--      already exists and is already correctly institution-scoped, so
--      the fourth bucket reuses it rather than duplicating a working
--      RPC, matching this file's own standing rule against hand-rolling
--      a second copy of something that already works. All three new
--      ones follow the same shape: a director-only caller check, a
--      client-facing result set with enough context to be useful (not
--      a bare count), ordered oldest-first (the thing that's been
--      waiting longest surfaces first).
--
--   4. get_institution_caseload_sizes() -- a COUNT, not a capacity.
--      No denominator exists anywhere in this schema (checked during
--      Stage 7's own recon) and this migration does not invent one --
--      current caseload size per practitioner is a real, useful number
--      on its own, distinct from "how full are they relative to a
--      limit nobody set".
--
-- Every one of the five new functions below independently re-derives
-- the director-authorization check (role = 'principal', current
-- standing, verified clinic) rather than sharing a helper -- matching
-- the shape every other director-facing RPC in this schema already
-- uses (onboard_clinic_client, grant_clinician_access, etc.), not a
-- new pattern invented for this migration.

-- ===========================================================================
-- 2. get_episode_overseeing_leads()
-- ===========================================================================

create or replace function public.get_episode_overseeing_leads(p_episode_id uuid)
returns table (
  institution_staff_id uuid,
  lead_user_id uuid,
  full_name text
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_institution_id uuid;
begin
  select e.institution_id into v_institution_id
  from public.episodes_of_care e
  where e.id = p_episode_id;

  if v_institution_id is null then
    raise exception 'Episode of care not found.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = v_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and inst.status = 'verified'
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'Only this client''s own clinical director can see who oversees them.';
  end if;

  return query
  with lead_dims as (
    select cls.institution_staff_id, it.dimension
    from public.clinical_lead_scope cls
    join public.institution_tags it on it.id = cls.institution_tag_id
    join public.institution_staff s on s.id = cls.institution_staff_id
    where s.institution_id = v_institution_id
      and s.role = 'clinical_lead'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    group by cls.institution_staff_id, it.dimension
  ),
  matched_dims as (
    select cls.institution_staff_id, it.dimension
    from public.clinical_lead_scope cls
    join public.institution_tags it on it.id = cls.institution_tag_id
    join public.episode_tags et on et.institution_tag_id = cls.institution_tag_id
    where et.episode_id = p_episode_id
    group by cls.institution_staff_id, it.dimension
  ),
  in_scope as (
    select ld.institution_staff_id
    from lead_dims ld
    group by ld.institution_staff_id
    having count(*) = (
      select count(*) from matched_dims md where md.institution_staff_id = ld.institution_staff_id
    )
  )
  select s.id, s.user_id, coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name')
  from in_scope isc
  join public.institution_staff s on s.id = isc.institution_staff_id
  join auth.users u on u.id = s.user_id;
end;
$$;

grant execute on function public.get_episode_overseeing_leads(uuid) to authenticated;

-- ===========================================================================
-- 3a. get_institution_episodes_without_active_practitioner()
-- ===========================================================================

create or replace function public.get_institution_episodes_without_active_practitioner(p_institution_id uuid)
returns table (
  episode_id uuid,
  passport_id uuid,
  child_name text,
  started_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select e.id, p.id, p.child_name, e.started_at
  from public.episodes_of_care e
  join public.passports p on p.id = e.passport_id
  where e.institution_id = p_institution_id
    and e.ended_at is null
    and not exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = e.passport_id
        and ca.engaged_by = 'institution'
        and ca.engaged_by_institution_id = p_institution_id
        and ca.is_active = true
    )
    and exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  order by e.started_at;
$$;

grant execute on function public.get_institution_episodes_without_active_practitioner(uuid) to authenticated;

-- ===========================================================================
-- 3b. get_institution_pending_staff_joins()
-- ===========================================================================

create or replace function public.get_institution_pending_staff_joins(p_institution_id uuid)
returns table (
  institution_staff_id uuid,
  staff_user_id uuid,
  full_name text,
  role text,
  requested_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select s.id, s.user_id, coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'), s.role, s.created_at
  from public.institution_staff s
  join auth.users u on u.id = s.user_id
  where s.institution_id = p_institution_id
    and s.approved_at is null
    and s.rejected_at is null
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
  order by s.created_at;
$$;

grant execute on function public.get_institution_pending_staff_joins(uuid) to authenticated;

-- ===========================================================================
-- 3c. get_institution_draft_fbas()
-- ===========================================================================

create or replace function public.get_institution_draft_fbas(p_institution_id uuid)
returns table (
  fba_id uuid,
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
  select f.id, f.passport_id, p.child_name, f.clinician_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'), f.status, f.created_at
  from public.fba_reports f
  join public.passports p on p.id = f.passport_id
  join auth.users u on u.id = f.clinician_id
  where f.status <> 'completed'
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = p_institution_id
        and s.user_id = f.clinician_id
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
  order by f.created_at;
$$;

grant execute on function public.get_institution_draft_fbas(uuid) to authenticated;

-- ===========================================================================
-- 4. get_institution_caseload_sizes() -- a count, not a capacity.
-- ===========================================================================

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
  select c.clinician_id, coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'), c.caseload_size
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
  order by c.caseload_size desc;
$$;

grant execute on function public.get_institution_caseload_sizes(uuid) to authenticated;
