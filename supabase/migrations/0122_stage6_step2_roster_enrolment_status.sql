-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 1, Stage 6, Step 2 -- the client work needs one thing from the SQL
-- layer first: a way for /principal/passports' own roster list to tell
-- an actively-enrolled child apart from a departed one, so the page can
-- split them (active + a collapsed past-pupils section, matching this
-- app's own established convention -- Past Cover, Removed teachers,
-- Previously in this class).
--
-- get_institution_child_roster() extended with one new column,
-- enrolment_ended_at, rather than replaced or narrowed -- every existing
-- caller (principal/classes/[classId], principal/passports/[passportId],
-- teacher/incidents/[incidentId], GrantPassportAccessSheet,
-- AddClassChildSheet, teacher/class, useSnaChildren, useInstitutionRoster)
-- only ever destructures passport_id/child_name from these rows; none
-- breaks by an extra column being present, and none is silently narrowed
-- to active-only by this change -- they keep seeing every linked child,
-- same as before. Deliberately NOT filtering the roster RPC's own WHERE
-- clause to active-only here: several of those callers need departed
-- children to keep resolving (historical incident names, the "Removed
-- teachers"-equivalent name resolution on the class detail page) --
-- exactly the same reasoning that shaped 0120's own caller-vs-content
-- split for the staff roster RPC. Only /principal/passports/page.tsx
-- (Step 2's own client change) reads the new column to split its list;
-- everything else ignores it, unchanged.
--
-- NULL means "actively enrolled, or linked from before Stage 6 existed
-- and never given an enrolments row at all" -- both read the same to
-- this column, deliberately: a passport_institution_links row that
-- predates 0121 has no enrolment to reference, and treating that as
-- "departed" would wrongly hide every child linked before this stage,
-- including the one real passport currently in production (Saplings
-- Special School's own). Non-null means the most recent enrolment at
-- THIS institution has ended.
--
-- CREATE OR REPLACE cannot change a RETURNS TABLE column list -- DROP +
-- CREATE, matching 0113's own precedent for the identical constraint.
-- The caller-standing check 0120 already fixed here (deactivated_at is
-- null, via institution_staff_has_current_standing()) is preserved
-- below, not re-written by hand -- a DROP+CREATE replaces the whole
-- function body, so it would have been silently lost otherwise.

drop function if exists public.get_institution_child_roster(uuid);

create function public.get_institution_child_roster(p_institution_id uuid)
returns table (
  passport_id uuid,
  child_name text,
  enrolment_ended_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id as passport_id,
    p.child_name,
    e.ended_at as enrolment_ended_at
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
  where pil.institution_id = p_institution_id
    and public.institution_staff_has_current_standing(auth.uid(), p_institution_id)
  order by p.child_name;
$$;

grant execute on function public.get_institution_child_roster(uuid) to authenticated;
