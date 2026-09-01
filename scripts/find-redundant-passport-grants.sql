-- Finds every ACTIVE passport_access row that duplicates class-derived
-- access -- the live version of the bug fixed in migration 0148: a
-- manual grant stacked on top of already-working class membership,
-- which survives removal from the class because the manual row is
-- never touched by that removal.
--
-- Requires 0148 to be applied (uses resolve_class_derived_access()).
-- Read-only -- safe to run any time, including repeatedly, as a
-- standing check rather than a one-off. Right after the full wipe
-- (2026-09-01) this returns zero rows, correctly -- there is no data
-- left for the bug to have happened to. Worth re-running once real
-- trial data exists, and periodically after.

select
  pa.id as passport_access_id,
  pa.passport_id,
  p.child_name,
  pa.teacher_id as user_id,
  coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
  pa.actor_role,
  pa.linked_at as manually_granted_at,
  rca.source as duplicates_via,
  rca.source_detail as class_name,
  rca.linked_at as class_membership_started_at
from public.passport_access pa
join public.passports p on p.id = pa.passport_id
join auth.users u on u.id = pa.teacher_id
join public.resolve_class_derived_access(pa.passport_id, pa.teacher_id, pa.institution_id) rca on true
where pa.is_active = true
order by pa.linked_at desc;
