-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PASSPORT ID, DISPLAY SURFACES. Migration 0289 stored the reference
-- and guaranteed it unique; nothing yet returns it to a client. Widens
-- the three RPCs that already resolve a name for the four requested
-- surfaces (Directory, the practitioner's client file, the admin's
-- client record, the clinician's caseload cards, the director's client
-- detail), plus get_institution_child_roster() -- ChildDetail.tsx's own
-- roster call for BOTH institution types, resolved this way
-- deliberately to avoid a race against the async institutionType hook
-- (that component's own comment explains why) -- widened the same way
-- rather than adding a second fetch. Returning passport_reference from
-- a roster call a SCHOOL also uses is harmless: the column exists on
-- every passport regardless of type, and "clinic side only" is a
-- DISPLAY decision the client makes (institutionType === 'clinic'),
-- the same gating this codebase already uses for every other type-
-- conditional field on a shared RPC -- nothing here exposes it TO a
-- school, it just travels alongside a payload nothing renders it from
-- on that branch.
--
-- All three RETURNS TABLE shapes change -- DROP FUNCTION IF EXISTS then
-- CREATE throughout, never a bare CREATE OR REPLACE, per this schema's
-- own standing rule. Every existing column, predicate, and ordering is
-- read from each function's own live (highest-numbered) definition and
-- kept byte-for-byte -- only passport_reference is added, appended at
-- the end of each column list so no positional caller of these
-- language-sql functions (none exist; every real caller destructures
-- by name) is at risk either way.

drop function if exists public.get_institution_episode_roster(uuid, boolean);

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
  end_reason text,
  passport_reference text
)
language sql
security definer
set search_path = public
stable
as $$
  select e.id as episode_id, p.id as passport_id, p.child_name, e.started_at, e.ended_at, e.end_reason, p.passport_reference
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

drop function if exists public.get_institution_child_roster(uuid);

create function public.get_institution_child_roster(p_institution_id uuid)
returns table (
  passport_id uuid,
  child_name text,
  enrolment_ended_at timestamptz,
  current_class_id uuid,
  passport_reference text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id as passport_id,
    p.child_name,
    e.ended_at as enrolment_ended_at,
    cc.class_id as current_class_id,
    p.passport_reference
  from public.passports p
  join public.passport_institution_links pil on pil.passport_id = p.id
  left join lateral (
    select en.ended_at
    from public.enrolments en
    where en.passport_id = p.id
      and en.institution_id = p_institution_id
    order by en.started_at desc
    limit 1
  ) e on true
  left join public.class_children cc
    on cc.passport_id = p.id
    and cc.ended_at is null
    and cc.class_id in (select cl.id from public.classes cl where cl.institution_id = p_institution_id)
  where pil.institution_id = p_institution_id
    and public.institution_staff_has_current_standing(auth.uid(), p_institution_id)
  order by p.child_name;
$$;

grant execute on function public.get_institution_child_roster(uuid) to authenticated;

drop function if exists public.get_clinician_passports();

create function public.get_clinician_passports()
returns table (
  clinician_access_id uuid,
  passport_id uuid,
  child_name text,
  date_of_birth date,
  diagnoses text[],
  diagnosis_other text,
  last_review_date date,
  linked_at timestamptz,
  engaged_by text,
  engaged_by_institution_name text,
  passport_reference text,
  -- A clinician's own caseload isn't inherently clinic-context the way
  -- the other three surfaces are -- a school-engaged clinician (a real,
  -- still-live track) or a parent-engaged/independent one both come
  -- through this same RPC. "Clinic side only" (Daniel's own instruction)
  -- needs the ENGAGING institution's own type, not just its name, so
  -- the caseload card can show Passport ID only for a genuine clinic
  -- engagement -- never for a school-engaged case reusing this identical
  -- list, and never for a parent-engaged one with no institution at all.
  engaged_by_institution_type text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    ca.id, p.id, p.child_name, p.date_of_birth, p.diagnoses, p.diagnosis_other, ca.last_review_date, ca.linked_at,
    ca.engaged_by, inst.name, p.passport_reference, inst.type
  from public.clinician_access ca
  join public.passports p on p.id = ca.passport_id
  left join public.institutions inst on inst.id = ca.engaged_by_institution_id
  where ca.clinician_id = auth.uid()
    and ca.is_active = true
    and public.is_verified_clinician(auth.uid())
  order by ca.linked_at desc;
$$;

grant execute on function public.get_clinician_passports() to authenticated;
