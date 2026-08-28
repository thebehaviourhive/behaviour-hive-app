-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- FIX, urgent: 0105's own edit-policy tightening overreached and broke
-- real, already-shipped functionality. Caught by the adversarial suite
-- itself within the hour, not assumed safe -- CHECK S/T (Phase 4/5,
-- unrelated to Stage 3) started failing at "Sign-off failed -- only
-- this incident's creator or owning teacher can sign it off." for an
-- ordinary teacher on an incident they genuinely, legitimately own.
--
-- ROOT CAUSE: 0105 added a has_child_access() requirement to "Owning
-- teacher can edit before teacher sign-off", reasoning that Stage 2's
-- "removed mid-day" protection should extend to in-progress incidents.
-- That reasoning doesn't hold. Incident ownership has NEVER depended on
-- passport-level child access in this schema -- create_incident_
-- stamp() lets any active institution staff member create and own an
-- incident for ANY child at their institution, with no passport_access/
-- class-membership/assignment requirement at all (this is deliberate,
-- documented precedent: incident-log visibility is institution-roster-
-- wide, independent of the per-child grant system). A teacher can
-- legitimately own an incident about a child they have zero ongoing
-- passport-level relationship with -- that's by design, not a gap.
-- has_child_access() conflates two systems that were always meant to
-- stay separate, and broke the ordinary case for real users.
--
-- Also incorrect, found alongside this: being removed from ONE class
-- (Stage 2's class_teachers.ended_at) does not and should not touch
-- institution_staff.role -- a class teacher removed from a single
-- class is still, generally, an active class_teacher, still eligible
-- to own incidents. There is no "Stage 2 extension" here; that framing
-- in 0105's own comments was wrong and is corrected below.
--
-- THE ACTUAL FIX for Stage 3's real need stays exactly as it was:
-- can_own_incident() (genuine class_teacher standing, OR a currently-
-- active temporary grant) correctly replaces the old bare role lookup,
-- and correctly has no deactivated_at/approved_at gap any more. Only
-- the has_child_access() clause is removed here -- nothing else about
-- 0105 was wrong.

alter policy "Owning teacher can edit before teacher sign-off"
  on public.incidents
  using (
    teacher_signed_at is null
    and owning_teacher_id = auth.uid()
    and public.can_own_incident(auth.uid(), incidents.institution_id)
  )
  with check (
    owning_teacher_id = auth.uid()
  );
