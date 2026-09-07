-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- SUPPLY TEACHER PROMPT TO REVIEW THE CLASS'S PASSPORTS.
--
-- Scoped to three of the four sections Daniel's own brief named:
-- triggers (passport_section_b.hard_triggers), calming approaches
-- (passport_section_d.during_distress/after_distress), and
-- communication needs (passport_section_c.communication_methods/
-- phrases_to_avoid) -- all three confirmed reachable through the exact
-- access a live temporary_access ('sna' tier) grant already provides,
-- traced end to end through has_sna_access() -> has_child_access() ->
-- each section table's own SELECT policy before writing a line of this.
--
-- MEDICAL AND INTIMATE CARE NEEDS ARE DELIBERATELY NOT PART OF THIS --
-- neither field exists anywhere in the passport schema, under any name,
-- confirmed by a full search of every migration and every passport
-- section's client code. Not a scope decision made here; a pre-existing
-- product gap, named in CLAUDE.md's own deferred-work list, going to
-- Catherine separately. This prompt's own copy says so plainly rather
-- than silently covering three of four and implying completeness.
--
-- Tracking table: scoped to the SPECIFIC temporary_access grant, not
-- the person or the class in general -- a new day is a new grant is a
-- new "walking into the room" moment, and the card is meant to resurface
-- then even for someone who covers this class regularly (the point is
-- today's information, not a one-time induction). "Dismiss" is
-- implemented as marking every currently-unviewed child reviewed in one
-- write, on the SAME table -- no separate dismissed flag needed, and a
-- dismissed card and a fully-read-through card are genuinely the same
-- end state: nothing left to review for this grant.
--
-- All access goes through SECURITY DEFINER RPCs, not direct table
-- reads/writes -- RLS on the table itself only ever grants a viewer
-- their own rows back, nothing else, matching this schema's own
-- established pattern for tables whose write logic needs to check
-- something (a genuinely active, live-window covering grant) that a
-- bare RLS policy can't cleanly express alongside a straightforward
-- self-scoped SELECT.

create table public.passport_review_views (
  id uuid primary key default gen_random_uuid(),
  temporary_access_id uuid not null references public.temporary_access (id) on delete cascade,
  passport_id uuid not null references public.passports (id) on delete cascade,
  viewed_by uuid not null references auth.users (id),
  viewed_at timestamptz not null default now(),
  unique (temporary_access_id, passport_id)
);

create index passport_review_views_temporary_access_id_idx on public.passport_review_views (temporary_access_id);

alter table public.passport_review_views enable row level security;

create policy "A viewer can see their own review records"
  on public.passport_review_views for select to authenticated
  using (viewed_by = auth.uid());

-- No insert/update/delete policy -- every write goes through
-- mark_passport_reviewed()/dismiss_passport_review() below, both
-- SECURITY DEFINER, both re-deriving the live-window grant check
-- themselves rather than trusting a client-passed temporary_access_id.

-- =====================================================================
-- 1. mark_passport_reviewed() -- called once, on mount, from /sna/
--    passport/[passportId] itself. Silently does nothing if the caller
--    has no currently-active covering grant for this child's class --
--    a permanent SNA (or a class teacher) opening the same page is
--    simply not what this tracks, no error, no visible effect.
-- =====================================================================

create or replace function public.mark_passport_reviewed(p_passport_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_temporary_access_id uuid;
begin
  select ta.id into v_temporary_access_id
  from public.temporary_access ta
  join public.class_children cc on cc.class_id = ta.class_id
  join public.institutions inst on inst.id = ta.institution_id
  where cc.passport_id = p_passport_id
    and cc.ended_at is null
    and ta.granted_to = auth.uid()
    and ta.access_tier = 'sna'
    and ta.revoked_at is null
    and ta.granted_for_date = (now() at time zone public.app_local_timezone())::date
    and (now() at time zone public.app_local_timezone())::time >= inst.temporary_access_start_time
    and (now() at time zone public.app_local_timezone())::time < inst.temporary_access_cutoff_time
  limit 1;

  if v_temporary_access_id is null then
    return;
  end if;

  insert into public.passport_review_views (temporary_access_id, passport_id, viewed_by)
  values (v_temporary_access_id, p_passport_id, auth.uid())
  on conflict (temporary_access_id, passport_id) do nothing;
end;
$$;

grant execute on function public.mark_passport_reviewed(uuid) to authenticated;

-- =====================================================================
-- 2. get_covering_passport_review_status(p_class_id) -- the card's own
--    data source: every child in this class, for the caller's own
--    active grant on it, and whether reviewed yet. Empty array (not an
--    error) when the caller holds no active grant for this class --
--    the card simply doesn't render, same as activeCoverage today.
-- =====================================================================

create or replace function public.get_covering_passport_review_status(p_class_id uuid)
returns table (
  passport_id uuid,
  child_name text,
  viewed_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_temporary_access_id uuid;
begin
  select ta.id into v_temporary_access_id
  from public.temporary_access ta
  join public.institutions inst on inst.id = ta.institution_id
  where ta.class_id = p_class_id
    and ta.granted_to = auth.uid()
    and ta.access_tier = 'sna'
    and ta.revoked_at is null
    and ta.granted_for_date = (now() at time zone public.app_local_timezone())::date
    and (now() at time zone public.app_local_timezone())::time >= inst.temporary_access_start_time
    and (now() at time zone public.app_local_timezone())::time < inst.temporary_access_cutoff_time
  limit 1;

  if v_temporary_access_id is null then
    return;
  end if;

  return query
  select
    cc.passport_id,
    p.child_name,
    prv.viewed_at
  from public.class_children cc
  join public.passports p on p.id = cc.passport_id
  left join public.passport_review_views prv
    on prv.temporary_access_id = v_temporary_access_id and prv.passport_id = cc.passport_id
  where cc.class_id = p_class_id
    and cc.ended_at is null
  order by p.child_name;
end;
$$;

grant execute on function public.get_covering_passport_review_status(uuid) to authenticated;

-- =====================================================================
-- 3. dismiss_passport_review(p_class_id) -- marks every currently-
--    unviewed child in this class, for the caller's own active grant,
--    reviewed in one write. Same table, same end state as reading
--    through each one -- "dismissed" and "fully read" are not
--    different facts once this returns.
-- =====================================================================

create or replace function public.dismiss_passport_review(p_class_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_temporary_access_id uuid;
begin
  select ta.id into v_temporary_access_id
  from public.temporary_access ta
  join public.institutions inst on inst.id = ta.institution_id
  where ta.class_id = p_class_id
    and ta.granted_to = auth.uid()
    and ta.access_tier = 'sna'
    and ta.revoked_at is null
    and ta.granted_for_date = (now() at time zone public.app_local_timezone())::date
    and (now() at time zone public.app_local_timezone())::time >= inst.temporary_access_start_time
    and (now() at time zone public.app_local_timezone())::time < inst.temporary_access_cutoff_time
  limit 1;

  if v_temporary_access_id is null then
    return;
  end if;

  insert into public.passport_review_views (temporary_access_id, passport_id, viewed_by)
  select v_temporary_access_id, cc.passport_id, auth.uid()
  from public.class_children cc
  where cc.class_id = p_class_id
    and cc.ended_at is null
  on conflict (temporary_access_id, passport_id) do nothing;
end;
$$;

grant execute on function public.dismiss_passport_review(uuid) to authenticated;
