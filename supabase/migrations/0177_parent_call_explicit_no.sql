-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PARENT CALL -- THE SCHEMA CANNOT REPRESENT AN EXPLICIT NO (found live,
-- real production data, 7 September 2026). incident_children.parent_
-- call_required is `boolean not null default false` -- one column,
-- meaning "never answered" and "explicitly reviewed and confirmed not
-- needed" are the same value. flag_parent_call_for_injury() and
-- flag_parent_call_for_restrictive_practice() (0068) both auto-raise the
-- flag to true on any injury/restrictive-practice insert, guarded only
-- by `and parent_call_required = false` -- which cannot tell a genuine
-- explicit No from an untouched default, so a real teacher decision gets
-- silently overwritten by a later trigger with no record it happened.
--
-- Confirmed against real data before this fix: a real incident whose
-- reporting teacher's own answer read "No" in the UI had parent_call_
-- required = true persisted, because an injury was logged in the same
-- session -- the trigger fired, blind to the fact that no one had
-- explicitly reviewed and confirmed "No" (in fact, checking the client
-- UI directly: there was no way to *explicitly* confirm No at all --
-- false was simply the untouched default, displayed as a "No" pill but
-- never affirmatively chosen. Fixed in the same client pass as this
-- migration -- see teacher/incidents/[incidentId]/page.tsx.
--
-- THE FIX, exactly as scoped:
--   1. parent_call_answered_at -- set ONLY by the teacher's own explicit
--      write (client now offers a real "No" confirm action, not just a
--      "Yes" raise), never by the auto-raise triggers.
--   2. Both auto-raise triggers gain `and parent_call_answered_at is
--      null` alongside their existing `and parent_call_required =
--      false` -- an explicit answer, in either direction, is never
--      silently overwritten again.
--   3. When that condition is met -- a real injury/restrictive practice
--      exists on an incident where the reporting teacher explicitly
--      answered No -- raise a DISTINCT signal to the principal, not
--      "call the parent" (false, they said no) and not silence (the
--      teacher's own No on a restraint is a decision worth recording).
--      A new institution-wide RPC, get_institution_restraints_with_
--      declined_parent_call(), mirrors get_institution_restraints_
--      needing_parent_call()'s own shape (0134) -- worded as a fact to
--      review on the dashboard's existing "Routine" bucket (actionLabel
--      "Review", not an instruction), never the urgent "Needs action
--      now" section that bucket's sibling uses.

alter table public.incident_children
  add column parent_call_answered_at timestamptz;

-- =====================================================================
-- 1. The two auto-raise triggers -- now respect an explicit answer.
-- =====================================================================

create or replace function public.flag_parent_call_for_injury()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.injured_party_type = 'student' and new.passport_id is not null then
    update public.incident_children
    set parent_call_required = true
    where incident_id = new.incident_id and passport_id = new.passport_id
      and parent_call_required = false
      and parent_call_answered_at is null;
  end if;
  return new;
end;
$$;

create or replace function public.flag_parent_call_for_restrictive_practice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.incident_children
  set parent_call_required = true
  where incident_id = new.incident_id and passport_id = new.passport_id
    and parent_call_required = false
    and parent_call_answered_at is null;
  return new;
end;
$$;

-- =====================================================================
-- 2. set_parent_call_answer() -- the new explicit-answer RPC. Replaces
--    the client's own raw .update({parent_call_required: true}) with a
--    real function so BOTH directions (Yes and No) are possible, and
--    parent_call_answered_at is set atomically with the value, from one
--    place, rather than trusting every future call site to remember it.
--    Deliberately does NOT allow answering after it's already true --
--    matches the client's own existing "one-way" rule (0068's comment:
--    "a physical injury or restrictive practice was used doesn't
--    un-happen") -- once required, an explicit "No" can no longer be
--    given; Yes stays reachable (a teacher can still raise it manually
--    after an initial No, unchanged from today).
-- =====================================================================

create or replace function public.set_parent_call_answer(p_incident_children_id uuid, p_required boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_incident_id uuid;
begin
  select ic.incident_id into v_incident_id
  from public.incident_children ic
  join public.incidents i on i.id = ic.incident_id
  where ic.id = p_incident_children_id
    and i.teacher_signed_at is null
    and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid());

  if v_incident_id is null then
    raise exception 'Could not update this record -- it may already be signed off, or you may not be its owning teacher.';
  end if;

  update public.incident_children
  set parent_call_required = case when p_required then true else parent_call_required end,
      parent_call_answered_at = now()
  where id = p_incident_children_id
    -- Once true, this stays a one-way flag -- an explicit "No" call
    -- here is simply a no-op rather than an error, matching the
    -- client's own established one-way UI rule.
    and (p_required = true or parent_call_required = false);
end;
$$;

grant execute on function public.set_parent_call_answer(uuid, boolean) to authenticated;

-- =====================================================================
-- 3. get_institution_restraints_with_declined_parent_call() -- new.
--    Mirrors get_institution_restraints_needing_parent_call()'s own
--    shape (0134) exactly, but the opposite fact: a real restraint or
--    injury exists, AND the reporting teacher explicitly answered No.
-- =====================================================================

create or replace function public.get_institution_restraints_with_declined_parent_call(p_institution_id uuid)
returns table (
  incident_children_id uuid,
  incident_id uuid,
  occurred_at timestamptz,
  location text,
  child_index text,
  child_name text,
  owning_teacher_name text,
  parent_call_answered_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    ic.id as incident_children_id,
    i.id as incident_id,
    i.occurred_at,
    loc.value as location,
    ic.child_index,
    p.child_name,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as owning_teacher_name,
    ic.parent_call_answered_at
  from public.incident_children ic
  join public.incidents i on i.id = ic.incident_id
  join public.incident_locations loc on loc.id = i.location_id
  join public.passports p on p.id = ic.passport_id
  left join auth.users u on u.id = i.owning_teacher_id
  where i.institution_id = p_institution_id
    and ic.parent_call_required = false
    and ic.parent_call_answered_at is not null
    and (
      exists (
        select 1 from public.incident_injuries ii
        where ii.incident_id = i.id and ii.injured_party_type = 'student' and ii.passport_id = ic.passport_id
      )
      or exists (
        select 1 from public.restrictive_practices rp
        where rp.incident_id = i.id and rp.passport_id = ic.passport_id
      )
    )
    and public.can_countersign_incident(auth.uid(), p_institution_id)
  order by i.occurred_at desc;
$$;

grant execute on function public.get_institution_restraints_with_declined_parent_call(uuid) to authenticated;
