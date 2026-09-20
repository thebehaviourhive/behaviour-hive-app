-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 8, STAGE 3 -- the stagnation queue. Section 6, Daniel's own
-- framing: "the single most valuable thing in PRD 8 and the only
-- feature in the product that could not exist on any other platform."
-- Clients with active clinic involvement AND a rising incident or
-- restraint rate at school since their current plan was signed.
--
-- Recon-first (recorded in CLAUDE.md), then three decisions, all
-- Daniel's own, built here exactly as recorded:
--
--   1. WITHHELD INCIDENTS -- Option A, compute on what the clinic can
--      see. See get_institution_incidents_for_director()'s own header
--      below for the full reasoning and the limitation stated plainly,
--      in code, not only in CLAUDE.md.
--   2. THE EVIDENCE FLOOR -- a single named constant
--      (v_min_evidence, declared once, inside
--      get_institution_stagnation_queue() below), a conservative
--      starting value, never tuned to make the queue fire. The real
--      number is deferred to the trial's own data.
--   3. clinical_plans-ONLY CLIENTS ARE OUT OF SCOPE, no calendar
--      fallback -- a client with no signed BSP has no intervention to
--      evaluate. Surfaced as queue_status = 'no_signed_plan', never
--      silently dropped from the result set.
--
-- TWO STRUCTURAL FINDINGS FROM RECON THAT SHAPE THIS, RECORDED HERE
-- SO THE REASONING TRAVELS WITH THE CODE:
--
--   - cross_organisation_grants (0245) cannot reach incidents under any
--     circumstance -- scope_items is a CHECK-enumerated allow-list of
--     exactly {'fba_report', 'bsp'}, and the grant's own direction is
--     clinic-to-school, the reverse of what this feature needs. The
--     only path that ever reached incidents is clinician_access, via
--     get_clinician_incidents() -- unrelated to Stage 1, live since the
--     clinician track shipped.
--   - That path has no caller shaped like a director surveying a whole
--     clinic roster -- get_clinician_incidents() authorizes ONE
--     clinician reading their OWN caseload, and clinician_access itself
--     has no institution scoping at all (a 'parent'-engaged clinician,
--     no clinic tie whatsoever, gets identical visibility to an
--     'institution'-engaged one). get_institution_incidents_for_director()
--     below is genuinely new shape, not a copy of the five PRD 8 Stage 2
--     director-read RPCs -- same POSTURE (director-only, clinic-only,
--     institution_staff_has_current_standing), different SHAPE
--     (institution-roster-scoped via episodes_of_care, not
--     passport-scoped like the existing five).

-- =====================================================================
-- 1. get_institution_incidents_for_director() -- the new director-
-- facing incident read. Bulk, institution-scoped (not passport-scoped
-- like the five existing director-read RPCs, per this migration's own
-- header) -- returns the minimum needed to compute a rate, not full
-- incident content. This is a deliberate scoping choice, not an
-- oversight: Decision 1 endorsed computing a COUNT on visible incidents,
-- not building a general "clinic director browses school incident
-- narratives" surface, which would be a materially bigger and different
-- decision nobody has made.
--
-- THE WITHHOLDING LIMITATION, STATED HERE IN CODE, NOT ONLY IN
-- CLAUDE.md, PER DANIEL'S OWN EXPLICIT INSTRUCTION: this function
-- computes on what the clinic can see. `withheld_from_clinic = false`
-- below is the entire mechanism -- an incident a principal withholds at
-- countersign is invisible to this function, and therefore invisible to
-- every computation built on it, by design. This was a deliberate
-- choice (PRD 8 Stage 1): withholding is a real gate, not a redaction,
-- built on the reasoning that it is only meaningful if nothing crossed
-- first. The cost, named plainly: a school minimising a problem makes
-- this queue quieter, which is the one case it most exists to catch.
-- Reversing this would be a separate decision about what withholding is
-- FOR -- not made here, not to be inferred from this feature's own
-- stated purpose, however good the argument. A related, genuinely
-- different question -- should a clinician know THAT a withhold
-- happened on a given child, without seeing what or why -- is
-- deliberately NOT answered by this migration. Flagged, not built.
--
-- `is_restraint` is derived from restrictive_practices row existence
-- (a structured record of an actual physical intervention), not
-- incident_action_types.is_restraint (an action-selection flag on the
-- broader incident) -- the more precise, more direct signal of the two
-- for this purpose.
-- =====================================================================

create or replace function public.get_institution_incidents_for_director(p_institution_id uuid)
returns table (
  passport_id uuid,
  incident_id uuid,
  occurred_at timestamptz,
  is_restraint boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    ic.passport_id,
    i.id,
    i.occurred_at,
    exists (select 1 from public.restrictive_practices rp where rp.incident_id = i.id)
  from public.incidents i
  join public.incident_children ic on ic.incident_id = i.id
  join public.episodes_of_care e
    on e.passport_id = ic.passport_id
    and e.institution_id = p_institution_id
    and e.ended_at is null
  where i.countersigned_at is not null
    and i.withheld_from_clinic = false
    and exists (
      select 1
      from public.institution_staff director
      join public.institutions inst on inst.id = director.institution_id
      where director.user_id = auth.uid()
        and director.institution_id = p_institution_id
        and director.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
    )
  order by i.occurred_at desc;
$$;

grant execute on function public.get_institution_incidents_for_director(uuid) to authenticated;

-- =====================================================================
-- 2. get_institution_stagnation_queue() -- the actual computation.
-- Calls get_institution_incidents_for_director() internally rather than
-- re-deriving the visibility/withholding filter a second time (this
-- schema's own standing "one shared chokepoint, not six hand-rolled
-- copies" lesson) -- auth.uid() propagates through unchanged across
-- nested SECURITY DEFINER calls, so the inner function's own director
-- check still authorizes correctly against the real caller.
--
-- Roster: every passport with a currently-open episode at this clinic
-- (episodes_of_care.ended_at is null) -- confirmed as the right anchor
-- specifically because clinician_access has no institution scoping of
-- its own to lean on.
--
-- Split point: the CURRENT active bsp's own signed_at (status='active',
-- institution_id = this clinic) -- a real, non-client-writable
-- timestamp, set only by sign_bsp(). Not the plan's own full revision
-- history (supersedes_id) -- a revision is itself evidence the prior
-- version was already judged not working, so re-litigating against the
-- original signing date would dilute, not sharpen, the question this
-- queue asks about the CURRENT plan.
--
-- clinical_plans-only clients (no bsp at all for this passport at this
-- institution) get queue_status = 'no_signed_plan' -- present in the
-- result set, never silently dropped (Decision 3).
--
-- Rate, not raw count -- before/after windows are different lengths
-- (episode start to signing; signing to now), so a count comparison
-- between them would be apples to oranges. Unit is incidents (or
-- restraints) per week of real elapsed time on each side.
-- =====================================================================

create or replace function public.get_institution_stagnation_queue(p_institution_id uuid)
returns table (
  passport_id uuid,
  child_name text,
  bsp_id uuid,
  bsp_signed_at timestamptz,
  queue_status text,
  incidents_before_count integer,
  incidents_after_count integer,
  incidents_before_rate numeric,
  incidents_after_rate numeric,
  incidents_rising boolean,
  restraints_before_count integer,
  restraints_after_count integer,
  restraints_before_rate numeric,
  restraints_after_rate numeric,
  restraints_rising boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  -- DECISION 2, Daniel's own instruction: a single named constant, a
  -- conservative starting value, documented here as arbitrary and
  -- trivial to change -- never tuned to make the queue fire. "A queue
  -- that fires at n=3 teaches people to ignore it, and then it is
  -- worthless in the case it was built for." Applies identically to
  -- both the general-incident and the restraint comparison: each side
  -- (before AND after) of EACH signal must independently reach this
  -- count before that signal is evaluated at all. At real clinic scale
  -- (Daniel's own example: five incidents, two children, one term),
  -- most comparisons will correctly fail to clear this and report
  -- 'insufficient_evidence' -- that is correct behaviour, not a bug to
  -- fix by lowering the number. THE REAL VALUE COMES FROM THE TRIAL'S
  -- OWN DATA, once there is enough real incident volume to know what
  -- "conservative" should actually mean here. Change only this line.
  v_min_evidence constant integer := 5;
begin
  if not exists (
    select 1
    from public.institution_staff director
    join public.institutions inst on inst.id = director.institution_id
    where director.user_id = auth.uid()
      and director.institution_id = p_institution_id
      and director.role = 'principal'
      and inst.status = 'verified'
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
  ) then
    return;
  end if;

  return query
  with roster as (
    select e.passport_id, e.started_at as episode_started_at
    from public.episodes_of_care e
    where e.institution_id = p_institution_id
      and e.ended_at is null
  ),
  active_plan as (
    select b.passport_id, b.id as bsp_id, b.signed_at
    from public.bsp b
    where b.institution_id = p_institution_id
      and b.status = 'active'
  ),
  visible_incidents as (
    select * from public.get_institution_incidents_for_director(p_institution_id)
  ),
  per_child as (
    select
      r.passport_id,
      ap.bsp_id,
      ap.signed_at as bsp_signed_at,
      count(*) filter (where vi.occurred_at < ap.signed_at)::integer as incidents_before_count,
      count(*) filter (where vi.occurred_at >= ap.signed_at)::integer as incidents_after_count,
      count(*) filter (where vi.occurred_at < ap.signed_at and vi.is_restraint)::integer as restraints_before_count,
      count(*) filter (where vi.occurred_at >= ap.signed_at and vi.is_restraint)::integer as restraints_after_count,
      -- Real elapsed wall-clock weeks on each side of the split, floored
      -- at one day so a plan signed the same day engagement began can
      -- never produce a division-by-near-zero inflated rate. A
      -- technical safety floor only -- distinct from v_min_evidence
      -- above, which is the actual "is this worth comparing at all"
      -- gate. Explicitly null (not a floored value) when there is no
      -- signed plan, so a 'no_signed_plan' row never carries a
      -- misleadingly real-looking rate.
      case when ap.signed_at is not null
        then greatest(extract(epoch from (ap.signed_at - r.episode_started_at)) / 604800.0, 1.0 / 7)
        else null end as before_weeks,
      case when ap.signed_at is not null
        then greatest(extract(epoch from (now() - ap.signed_at)) / 604800.0, 1.0 / 7)
        else null end as after_weeks
    from roster r
    left join active_plan ap on ap.passport_id = r.passport_id
    left join visible_incidents vi on vi.passport_id = r.passport_id
    group by r.passport_id, ap.bsp_id, ap.signed_at, r.episode_started_at
  )
  select
    pc.passport_id,
    p.child_name,
    pc.bsp_id,
    pc.bsp_signed_at,
    case
      when pc.bsp_id is null then 'no_signed_plan'
      when (pc.incidents_before_count < v_min_evidence or pc.incidents_after_count < v_min_evidence)
       and (pc.restraints_before_count < v_min_evidence or pc.restraints_after_count < v_min_evidence)
        then 'insufficient_evidence'
      when (
        pc.incidents_before_count >= v_min_evidence and pc.incidents_after_count >= v_min_evidence
        and (pc.incidents_after_count::numeric / pc.after_weeks) > (pc.incidents_before_count::numeric / pc.before_weeks)
      ) or (
        pc.restraints_before_count >= v_min_evidence and pc.restraints_after_count >= v_min_evidence
        and (pc.restraints_after_count::numeric / pc.after_weeks) > (pc.restraints_before_count::numeric / pc.before_weeks)
      ) then 'rising'
      else 'not_rising'
    end,
    pc.incidents_before_count,
    pc.incidents_after_count,
    round(pc.incidents_before_count::numeric / nullif(pc.before_weeks, 0), 3),
    round(pc.incidents_after_count::numeric / nullif(pc.after_weeks, 0), 3),
    (
      pc.incidents_before_count >= v_min_evidence and pc.incidents_after_count >= v_min_evidence
      and (pc.incidents_after_count::numeric / pc.after_weeks) > (pc.incidents_before_count::numeric / pc.before_weeks)
    ),
    pc.restraints_before_count,
    pc.restraints_after_count,
    round(pc.restraints_before_count::numeric / nullif(pc.before_weeks, 0), 3),
    round(pc.restraints_after_count::numeric / nullif(pc.after_weeks, 0), 3),
    (
      pc.restraints_before_count >= v_min_evidence and pc.restraints_after_count >= v_min_evidence
      and (pc.restraints_after_count::numeric / pc.after_weeks) > (pc.restraints_before_count::numeric / pc.before_weeks)
    )
  from per_child pc
  join public.passports p on p.id = pc.passport_id
  -- Alphabetical, never by rate or severity -- matching
  -- get_institution_caseload_sizes()'s own established precedent
  -- (0257). This is a prompt to look, never a ranking.
  order by p.child_name asc;
end;
$$;

grant execute on function public.get_institution_stagnation_queue(uuid) to authenticated;
