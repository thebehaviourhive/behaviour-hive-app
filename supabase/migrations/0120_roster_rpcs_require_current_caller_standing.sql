-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Stage 1 gap, second pass -- follow-up to 0119, same sweep, deliberately
-- separated because this one is NOT an oversight, it's a considered prior
-- decision whose actual reach turned out broader than its own stated
-- reasoning.
--
-- get_institution_child_roster() and get_institution_staff_roster() each
-- do TWO separate things that were never actually the same question:
--   1. WHICH ROWS are returned -- get_institution_staff_roster() already
--      has p_include_inactive/p_include_pending for exactly this, and it
--      is correct and stays untouched here. A currently-active caller can
--      legitimately ask for departed staff to be included (the "Removed
--      teachers" section on /principal/classes/[classId], the full
--      active+deactivated+pending view on /principal/staff, both already
--      pass p_include_inactive: true today and both keep working
--      identically after this migration).
--   2. WHETHER THE CALLER may invoke the function AT ALL -- the final
--      EXISTS clause, keyed on auth.uid(). This checked
--      approved_at is not null and NEVER deactivated_at is null -- so a
--      caller only ever needed to have ONCE been approved, not to
--      CURRENTLY be. A long-departed principal or teacher can still call
--      either RPC today, with p_include_inactive/p_include_pending set to
--      true, and get back the institution's CURRENT full child or staff
--      roster -- not just names on records they authored, the live
--      roster itself, indefinitely, with no time limit after leaving.
--
-- 0100's own comment reasoned about #1 (why a deactivated person can
-- legitimately be a NAMED ROW in these results -- "may be legitimately
-- named on real historical records") and never separately asked #2 (does
-- the CALLER need to still be active). That's the actual gap: not the
-- row content, the caller check. Fixed by adding exactly the same
-- deactivated_at is null this migration's own predecessor (0119) added
-- at three other sites -- these functions predate
-- institution_staff_has_current_standing() (0105) by one migration each
-- (0097/0100 vs 0105), so they were never retrofitted to use it.
--
-- Checked every real client caller before writing this (not assumed):
-- every one is invoked by a currently-active principal or teacher
-- viewing their own institution's own screens
-- (/principal/staff, /principal/classes/[classId], /principal/passports
-- and its [passportId] detail, /teacher/class, /teacher/incidents/
-- [incidentId], useInstitutionRoster.ts) -- none is ever legitimately
-- invoked BY a departed person. Tightening the caller check breaks
-- nothing among real, current use.
--
-- NOT built here, because nothing needs it: a separate "resolve one
-- departed person's name by id" function. p_include_inactive/
-- p_include_pending already is that mechanism for any CURRENTLY-active
-- caller -- two of the seven call sites above already use it correctly
-- for exactly this (removed-teacher names, the full staff list). One
-- call site does NOT (teacher/incidents/[incidentId]/page.tsx passes
-- neither flag, so a departed signer's name already silently degrades to
-- a generic fallback there today) -- a real, separate, pre-existing
-- CLIENT gap, not caused by this migration and not fixed by it; flagged
-- for its own follow-up, not bundled in here.

create or replace function public.get_institution_child_roster(p_institution_id uuid)
returns table (
  passport_id uuid,
  child_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select p.id as passport_id, p.child_name
  from public.passports p
  join public.passport_institution_links pil on pil.passport_id = p.id
  where pil.institution_id = p_institution_id
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and s.approved_at is not null
        and s.deactivated_at is null
    )
  order by p.child_name;
$$;

create or replace function public.get_institution_staff_roster(
  p_institution_id uuid,
  p_include_inactive boolean default false,
  p_include_pending boolean default false
)
returns table (
  id uuid,
  user_id uuid,
  full_name text,
  role text,
  is_active boolean,
  is_pending boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.id,
    s.user_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    s.role,
    (
      s.approved_at is not null and s.deactivated_at is null
      and (
        s.approval_source is distinct from 'temporary_grant'
        or public.has_active_temporary_grant(s.user_id, s.institution_id)
      )
    ) as is_active,
    (s.approved_at is null and s.deactivated_at is null) as is_pending
  from public.institution_staff s
  join auth.users u on u.id = s.user_id
  where s.institution_id = p_institution_id
    and s.rejected_at is null
    and (
      (s.approved_at is not null and (p_include_inactive or s.deactivated_at is null))
      or (p_include_pending and s.approved_at is null and s.deactivated_at is null)
    )
    and exists (
      select 1 from public.institution_staff s2
      where s2.institution_id = p_institution_id
        and s2.user_id = auth.uid()
        and s2.approved_at is not null
        and s2.deactivated_at is null
    )
  order by full_name;
$$;
