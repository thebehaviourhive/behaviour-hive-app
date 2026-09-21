-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 10 v1.3, section 6.4 -- "a grant shares existing FBAs and BSPs,
-- not only future ones." has_cross_org_grant_access() (0245) applied a
-- forward-only date rule -- p_artefact_created_at >= g.confirmed_at --
-- to every artefact it gates. That rule belongs to the OTHER direction
-- (a school's incident history reaching a clinic that just connected,
-- so three years of incidents don't arrive at once) and was applied to
-- clinic-to-school grants by mistake.
--
-- Confirmed before touching anything: this function has exactly three
-- call sites, all FBA/BSP, all in 0245 -- the fba_reports SELECT
-- policy, the bsp SELECT policy, and _bsp_is_readable_by_caller()
-- (which bsp_strategies reads through). None of them are incidents.
-- cross_organisation_grants.scope_items is CHECK-constrained to
-- array['fba_report', 'bsp'] only -- a grant can never legally contain
-- 'incident', so there is no incident-shaped call this function could
-- ever receive. The PRD's own "keep it for school incidents reaching a
-- clinic, where it belongs" is naming which direction the rule was
-- ALWAYS meant for, not asking this function to keep a branch for
-- incidents it structurally cannot be called with -- that direction's
-- own forward-only behaviour lives entirely in PRD 8 Stage 1's
-- countersign-gate (get_clinician_incidents(), the
-- countersigned_at-is-not-null visibility rule), a completely separate
-- mechanism this migration does not touch.
--
-- PRD 8's own motivating case, restated directly: a school seeing an
-- FBA the clinic has already completed, so it does not commission a
-- second one. That FBA exists BEFORE any grant. Under the date rule, a
-- parent could consent to sharing their child's already-completed
-- assessment and the school would find nothing -- the feature
-- defeating itself at the one case it was built for.
--
-- The fix: drop both the null-check and the date comparison from the
-- WHERE clause. g.status = 'active' already guarantees the grant is
-- genuinely confirmed (confirm_cross_organisation_grant() sets both
-- status and confirmed_at together, atomically) -- confirmed_at is not
-- null was redundant with it even before this fix, not a second gate
-- being removed. p_artefact_created_at stays in the signature,
-- deliberately unused now, so none of the three call sites need
-- touching -- same signature, same grant, CREATE OR REPLACE is safe
-- since the return type and parameter list are both unchanged.

create or replace function public.has_cross_org_grant_access(
  p_user_id uuid,
  p_passport_id uuid,
  p_artefact_type text,
  p_artefact_created_at timestamptz
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.cross_organisation_grants g
    join public.institution_staff s on s.institution_id = g.receiving_institution_id
    where g.passport_id = p_passport_id
      and g.status = 'active'
      and p_artefact_type = any (g.scope_items)
      and s.user_id = p_user_id
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  );
$$;
