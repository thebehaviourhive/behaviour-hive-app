-- PRD 4, Stage 6: Term Overview -- the one genuinely new surface in this
-- PRD, and its only new SQL. Everything else in PRD 4 was presentation;
-- this is a real new aggregation, built on data that already exists
-- (nothing here required a schema change) but was never queryable in
-- this shape before.
--
-- Recon, agreed before this migration was written:
--
-- 1. "A term" is a principal-picked date range (p_start/p_end), not a
--    rolling window or a derived academic calendar -- nothing in this
--    schema knows about terms, and get_institution_incidents() already
--    established the date-range-filter pattern this reuses. The client
--    defaults to NOTHING (empty picker) -- a pre-filled default would
--    silently answer a question nobody asked, and this report gets
--    printed. This function enforces that at the data layer too: both
--    dates are required, not optional-with-a-server-side-default.
--
-- 2. ONE function, comparison computed server-side against a "prior
--    period" of identical length immediately preceding p_start -- not
--    two calls with client-side date maths that could drift from this
--    function's own definition of "prior".
--
-- 3. Grouping is by CHILD and by CLASS, never by staff member -- per
--    the brief, a class-level view read carelessly becomes a staff
--    comparison one step removed in a school where a class is several
--    teachers and a handful of children. Nothing in this function's
--    output is keyed by, or attributable to, a single staff member.
--
-- 4. Class grouping resolves each incident's class HISTORICALLY -- the
--    class a child was actually in on the day, via class_children's own
--    started_at/ended_at, not their class right now. A child who moved
--    class in November must not have September's incidents attributed
--    to their current room in a document going to a board -- this is
--    the one surface in the whole app where historical accuracy is the
--    entire point, agreed explicitly over the simpler current-class
--    join get_institution_child_roster() uses for other purposes.
--
-- 5. An incident counts as an "unplanned" restraint if ANY of its
--    restrictive_practices rows has planning_status = 'not_planned' --
--    the conservative reading for a document an inspector may read: one
--    unplanned hold within an otherwise-planned incident still means an
--    unplanned physical intervention happened. "Planned vs unplanned" is
--    a breakdown OF the restraint count, not of all incidents --
--    planning_status only exists on restrictive_practices, there is no
--    such concept at the general-incident level, and the brief's own
--    phrasing ("how many involved restraint, how many were in a BSP
--    versus unplanned") reads it the same way. Both rules must be
--    stated in words in the printed output -- a raw "12 restraints, 4
--    unplanned" is uninterpretable to a board member without knowing
--    what "unplanned" counts as. That's the client's job; this function
--    only needs to compute the numbers consistently.
--
-- 6. Drafts (status = 'draft') are excluded from every count here.
--    get_institution_incidents() deliberately does NOT filter status --
--    it's a management tool and a principal needs to see an
--    in-progress stamp. This is a formal report a board or inspector
--    may read; an abandoned stage-one stamp with no narrative and no
--    signoff is not a real, countable incident. Matches
--    get_parent_incidents()'s own status <> 'draft' precedent, for the
--    same reason (a different function, same judgment).
--
-- 7. Real child names, unlike get_institution_incidents(). That
--    function anonymises to child_index deliberately, for ITS OWN
--    callers (the plain incident list/print, where a principal is
--    reading individual incident detail and the anonymisation was
--    about not needlessly widening what that specific view surfaces).
--    This function's whole purpose is grouping BY child for a summary
--    report -- a principal already sees every child's real name
--    throughout Directory, the work queue, and Passports. Showing it
--    here crosses no boundary that function's anonymisation was
--    protecting; the two functions are answering different questions,
--    not disagreeing with each other. Written here explicitly so a
--    future reader doesn't find get_institution_incidents() returning
--    child_index and this function returning child_name and "fix" one
--    to match the other.


-- =====================================================================
-- 1. class_at_time() -- resolves which class a child was in at a given
-- moment, using class_children's own started_at/ended_at (0104). Not a
-- direct current_class_id read (that's get_institution_child_roster()'s
-- job, for a different purpose) -- this is the historical join Stage 6
-- needs and nothing before it did. Returns null if the child had no
-- class membership covering that moment (the "Unassigned" bucket below
-- groups on that null the same way NULL already groups in SQL).
--
-- security definer: called only from inside get_institution_term_
-- overview() below, which has already verified the caller is the
-- institution's current-standing principal before this is ever reached
-- -- but declared definer anyway, matching this schema's general
-- convention for small derivation helpers, so it behaves correctly
-- regardless of what calls it in future rather than relying on today's
-- one caller's own RLS visibility into class_children.
-- =====================================================================

create or replace function public.class_at_time(p_passport_id uuid, p_at timestamptz)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select cc.class_id
  from public.class_children cc
  where cc.passport_id = p_passport_id
    and cc.started_at <= p_at
    and (cc.ended_at is null or cc.ended_at > p_at)
  order by cc.started_at desc
  limit 1;
$$;

grant execute on function public.class_at_time(uuid, timestamptz) to authenticated;


-- =====================================================================
-- 2. get_institution_term_overview() -- the summary itself. Single
-- jsonb return (matching this schema's established summary-RPC shape --
-- get_countersign_summary(), incident_signoff_issues(), etc. -- rather
-- than a returns table, since the shape is genuinely one nested object,
-- not rows), principal-only, verified-institution-only, current-
-- standing-only.
--
-- Shape:
--   { period: {start, end}, prior_period: {start, end},
--     current: {total_incidents, total_restraints, planned_restraints,
--               unplanned_restraints},
--     prior: {same four fields},
--     by_child: [{passport_id, child_name, incident_count,
--                 restraint_count, unplanned_restraint_count}, ...],
--     by_class: [{class_id, class_name, incident_count,
--                 restraint_count, unplanned_restraint_count}, ...] }
--
-- by_child and by_class only ever describe the CURRENT period -- the
-- brief asked for a top-line trend ("the term's shape... whether the
-- trend is falling"), not a per-child or per-class trend, so the prior
-- period is only ever computed at the top-line.
--
-- by_class's incident_count figures can sum to MORE than
-- current.total_incidents -- deliberately. An incident with children
-- from two different classes touches both classes' own provision, and
-- is counted once for each; it is never double-counted WITHIN one
-- class (a single incident with three children from the same class
-- counts once for that class, not three times) -- both counted as
-- distinct incident ids, never as distinct child-incident rows. The
-- client's printed methodology note (agreed, not built here) should
-- say this, the same way it states the unplanned-restraint rule.
-- =====================================================================

create or replace function public.get_institution_term_overview(
  p_institution_id uuid,
  p_start date,
  p_end date
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_period_days integer;
  v_prior_start date;
  v_prior_end date;

  v_total_incidents_current integer;
  v_total_restraints_current integer;
  v_unplanned_restraints_current integer;

  v_total_incidents_prior integer;
  v_total_restraints_prior integer;
  v_unplanned_restraints_prior integer;

  v_by_child jsonb;
  v_by_class jsonb;
begin
  if p_start is null or p_end is null then
    raise exception 'A start and end date are both required.';
  end if;
  if p_end < p_start then
    raise exception 'End date cannot be before start date.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and inst.status = 'verified'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'Not authorized for this institution.';
  end if;

  -- Prior period: the same number of days, immediately preceding
  -- p_start, computed here rather than left to the client so both
  -- periods share one definition. E.g. Sept 1-30 (30 days) -> prior is
  -- Aug 2-31 (also 30 days).
  v_period_days := (p_end - p_start) + 1;
  v_prior_end := p_start - 1;
  v_prior_start := v_prior_end - (v_period_days - 1);

  select count(*) into v_total_incidents_current
  from public.incidents i
  where i.institution_id = p_institution_id
    and i.status <> 'draft'
    and i.occurred_at::date between p_start and p_end;

  select count(*) into v_total_restraints_current
  from public.incidents i
  where i.institution_id = p_institution_id
    and i.status <> 'draft'
    and i.occurred_at::date between p_start and p_end
    and exists (select 1 from public.restrictive_practices rp where rp.incident_id = i.id);

  select count(*) into v_unplanned_restraints_current
  from public.incidents i
  where i.institution_id = p_institution_id
    and i.status <> 'draft'
    and i.occurred_at::date between p_start and p_end
    and exists (
      select 1 from public.restrictive_practices rp
      where rp.incident_id = i.id and rp.planning_status = 'not_planned'
    );

  select count(*) into v_total_incidents_prior
  from public.incidents i
  where i.institution_id = p_institution_id
    and i.status <> 'draft'
    and i.occurred_at::date between v_prior_start and v_prior_end;

  select count(*) into v_total_restraints_prior
  from public.incidents i
  where i.institution_id = p_institution_id
    and i.status <> 'draft'
    and i.occurred_at::date between v_prior_start and v_prior_end
    and exists (select 1 from public.restrictive_practices rp where rp.incident_id = i.id);

  select count(*) into v_unplanned_restraints_prior
  from public.incidents i
  where i.institution_id = p_institution_id
    and i.status <> 'draft'
    and i.occurred_at::date between v_prior_start and v_prior_end
    and exists (
      select 1 from public.restrictive_practices rp
      where rp.incident_id = i.id and rp.planning_status = 'not_planned'
    );

  -- By child -- current period only. restraint_count/unplanned_
  -- restraint_count are scoped to THIS child's own restrictive_
  -- practices row(s) (rp.passport_id = p.id), not "was present at an
  -- incident where anyone was restrained".
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'passport_id', t.passport_id,
      'child_name', t.child_name,
      'incident_count', t.incident_count,
      'restraint_count', t.restraint_count,
      'unplanned_restraint_count', t.unplanned_restraint_count
    )
    order by t.incident_count desc, t.child_name
  ), '[]'::jsonb)
  into v_by_child
  from (
    select
      p.id as passport_id,
      p.child_name,
      count(distinct i.id) as incident_count,
      count(distinct i.id) filter (
        where exists (
          select 1 from public.restrictive_practices rp
          where rp.incident_id = i.id and rp.passport_id = p.id
        )
      ) as restraint_count,
      count(distinct i.id) filter (
        where exists (
          select 1 from public.restrictive_practices rp
          where rp.incident_id = i.id and rp.passport_id = p.id and rp.planning_status = 'not_planned'
        )
      ) as unplanned_restraint_count
    from public.incident_children ic
    join public.incidents i on i.id = ic.incident_id
    join public.passports p on p.id = ic.passport_id
    where i.institution_id = p_institution_id
      and i.status <> 'draft'
      and i.occurred_at::date between p_start and p_end
    group by p.id, p.child_name
  ) t;

  -- By class -- current period only, historical class-at-incident-time.
  -- presence: every (class, incident) pair touched by any child present
  -- (from incident_children) -- this is the incident_count source.
  -- restraint/unplanned: the SAME resolution but keyed off the
  -- specifically restrained child (restrictive_practices.passport_id),
  -- which may resolve to a different class than another child in the
  -- same multi-child incident -- each attributed to its own class, not
  -- merged.
  with presence as (
    select distinct
      public.class_at_time(ic.passport_id, i.occurred_at) as class_id,
      i.id as incident_id
    from public.incident_children ic
    join public.incidents i on i.id = ic.incident_id
    where i.institution_id = p_institution_id
      and i.status <> 'draft'
      and i.occurred_at::date between p_start and p_end
  ),
  restraint as (
    select distinct
      public.class_at_time(rp.passport_id, i.occurred_at) as class_id,
      i.id as incident_id
    from public.restrictive_practices rp
    join public.incidents i on i.id = rp.incident_id
    where i.institution_id = p_institution_id
      and i.status <> 'draft'
      and i.occurred_at::date between p_start and p_end
  ),
  unplanned as (
    select distinct
      public.class_at_time(rp.passport_id, i.occurred_at) as class_id,
      i.id as incident_id
    from public.restrictive_practices rp
    join public.incidents i on i.id = rp.incident_id
    where i.institution_id = p_institution_id
      and i.status <> 'draft'
      and i.occurred_at::date between p_start and p_end
      and rp.planning_status = 'not_planned'
  ),
  class_totals as (
    select
      presence.class_id,
      count(distinct presence.incident_id) as incident_count,
      count(distinct restraint.incident_id) as restraint_count,
      count(distinct unplanned.incident_id) as unplanned_restraint_count
    from presence
    left join restraint
      on restraint.class_id is not distinct from presence.class_id
      and restraint.incident_id = presence.incident_id
    left join unplanned
      on unplanned.class_id is not distinct from presence.class_id
      and unplanned.incident_id = presence.incident_id
    group by presence.class_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'class_id', ct.class_id,
      'class_name', coalesce(cls.name, 'Unassigned'),
      'incident_count', ct.incident_count,
      'restraint_count', ct.restraint_count,
      'unplanned_restraint_count', ct.unplanned_restraint_count
    )
    order by ct.incident_count desc, coalesce(cls.name, 'Unassigned')
  ), '[]'::jsonb)
  into v_by_class
  from class_totals ct
  left join public.classes cls on cls.id = ct.class_id;

  return jsonb_build_object(
    'institution_id', p_institution_id,
    'period', jsonb_build_object('start', p_start, 'end', p_end),
    'prior_period', jsonb_build_object('start', v_prior_start, 'end', v_prior_end),
    'current', jsonb_build_object(
      'total_incidents', v_total_incidents_current,
      'total_restraints', v_total_restraints_current,
      'planned_restraints', v_total_restraints_current - v_unplanned_restraints_current,
      'unplanned_restraints', v_unplanned_restraints_current
    ),
    'prior', jsonb_build_object(
      'total_incidents', v_total_incidents_prior,
      'total_restraints', v_total_restraints_prior,
      'planned_restraints', v_total_restraints_prior - v_unplanned_restraints_prior,
      'unplanned_restraints', v_unplanned_restraints_prior
    ),
    'by_child', v_by_child,
    'by_class', v_by_class
  );
end;
$$;

grant execute on function public.get_institution_term_overview(uuid, date, date) to authenticated;
