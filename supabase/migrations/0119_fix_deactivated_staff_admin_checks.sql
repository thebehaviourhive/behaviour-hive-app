-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Stage 1 gap, found and fixed ahead of Stage 6 -- not part of Stage 6
-- itself. Surfaced by a sweep prompted by a false alarm (the incidents
-- edit policy, which turned out to be already correct via
-- can_own_incident()): the real question that false alarm raised was
-- "are there OTHER institution_staff checks missing this?" An exhaustive
-- sweep of every function and RLS policy that queries institution_staff,
-- resolved to each one's LIVE (highest-numbered) definition, found three
-- genuine, confirmed gaps -- all three personally re-verified against
-- the live SQL before this migration was written, not taken on a
-- sweep's word alone.
--
-- All three are fixed the same way: adding
-- institution_staff_has_current_standing() (already built in 0105,
-- already correct, used in exactly one place until now) alongside each
-- site's existing role check, rather than hand-writing a fourth
-- deactivated_at/approved_at condition from scratch. That is the actual
-- lesson here -- not just three bugs, but three INDEPENDENT,
-- unconnected lineages that each rolled their own raw institution_staff
-- check instead of sharing one, and this is the general-purpose
-- eligibility helper that already existed to prevent exactly that.
--
-- =====================================================================
-- GAP 1 -- institution_permissions' own three policies (view/grant/
-- revoke). The more severe of the three: institution_staff.role is
-- never cleared on departure (deactivate_institution_staff() and
-- hand_over_principal() only ever set deactivated_at), so a departed
-- principal's row still reads role = 'principal' forever. None of these
-- three policies checked deactivated_at, so a departed or handed-over
-- principal retained the ability to view every countersign-delegation
-- grant at their old institution, GRANT countersign authority to any
-- current staff member, and REVOKE existing grants -- indefinitely,
-- with no time limit after leaving.
--
-- 0078's own header comment (the migration that created this table)
-- explicitly flagged a forward dependency: "the day institution_staff
-- gains deactivated_at, BOTH can_countersign_incident() and
-- guard_institution_permissions_grantee_is_staff() must be updated to
-- require ACTIVE membership." Both of those WERE updated correctly
-- (0107, 0100) -- that note was honoured, not dropped. But it named the
-- GRANTEE side only (does the grant itself still count). It never
-- named the GRANTER side -- these three policies, which check whether
-- the CALLER is currently a valid principal before letting them
-- administer anyone's grant at all. That's not the same gap recurring;
-- it's a related one the original note never covered.
-- =====================================================================

alter policy "Principal or the grant holder can view institution_permissions"
  on public.institution_permissions
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = institution_permissions.institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and inst.status = 'verified'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  );

alter policy "Principal can grant institution_permissions"
  on public.institution_permissions
  with check (
    granted_by = auth.uid()
    and user_id <> auth.uid()
    and exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = institution_permissions.institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and inst.status = 'verified'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  );

alter policy "Principal can revoke institution_permissions"
  on public.institution_permissions
  using (
    revoked_at is null
    and exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = institution_permissions.institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and inst.status = 'verified'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  )
  with check (revoked_by = auth.uid());

-- =====================================================================
-- GAP 2 -- institutions' own UPDATE policy for institution_admin
-- (0033). Same missing check, lower present-day risk: institution_admin
-- onboarding has never shipped (CLAUDE.md's own open item, C-08, since
-- 0033) -- nobody currently holds this role, so there is no live
-- deactivated_at scenario to exploit TODAY. Fixed anyway, on the same
-- reasoning as everywhere else in this migration: it is live, reachable
-- code (the role value is valid, the policy is real), and it needs to
-- be correct before institution_admin onboarding gives it a caller, not
-- discovered as a gap after it does.
-- =====================================================================

alter policy "Institution admins can update their own institution"
  on public.institutions
  using (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = institutions.id
        and s.user_id = auth.uid()
        and s.role = 'institution_admin'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  )
  with check (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = institutions.id
        and s.user_id = auth.uid()
        and s.role = 'institution_admin'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  );

-- =====================================================================
-- GAP 3 -- passport_institution_links' own teacher-view policy. The
-- weakest of the three: it has never checked deactivated_at OR
-- approved_at, across its entire history (0014 -> 0035 -> 0112) -- a
-- deactivated staff member, or someone with a still-pending, never-
-- approved join request, could SELECT every link row for that
-- institution, i.e. see which children are linked there at all. This
-- exact policy was directly, deliberately edited twice before (0035 for
-- the parent-approval-disclosure question, 0112 for the roster-
-- visibility question) and both times the staff-standing gap survived,
-- because each fix pass was reading for a different concern. That
-- recurrence, on the same named policy, across two dedicated fix
-- passes, is the clearest evidence for why this needs a shared
-- helper rather than a fourth hand-written check.
-- =====================================================================

alter policy "Teachers can view links for their institution"
  on public.passport_institution_links
  using (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = passport_institution_links.institution_id
        and s.user_id = auth.uid()
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  );

-- =====================================================================
-- NOT fixed here, deliberately -- a fourth, DIFFERENT finding from the
-- same sweep, presented separately because it is not an oversight:
-- get_institution_child_roster() and get_institution_staff_roster()
-- both check approved_at is not null but not deactivated_at, on
-- purpose, per 0100's own comment -- reasoned as "a deactivated person
-- was once genuinely active and may be legitimately named on real
-- historical records." The sweep's own finding is that the live code's
-- actual reach is broader than that stated intent: both RPCs query
-- CURRENT rows, not a historical snapshot, so a long-departed staff
-- member can still call either RPC today and get the school's CURRENT
-- full child or staff roster, not just names attached to records they
-- were genuinely once part of. A considered prior decision whose
-- blast radius may have outgrown its own reasoning is a product
-- question, not a bug to silently reverse in the same migration as
-- three unambiguous ones -- left open for a separate decision.
-- =====================================================================
