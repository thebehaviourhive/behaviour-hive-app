-- PRD 5 Stage 2: the three clinic-only institution_staff role values.
-- 'clinician' resolves this stage's own premise question -- PRD section
-- 4 says "reuse institution_staff entirely" for clinic staff, and a
-- clinic practitioner is internal staff who joins by code and is
-- approved by the director, precisely what this table already does for
-- class_teacher/sna. Membership (this table) and caseload
-- (clinician_access, engaged_by = 'institution') are separate
-- questions -- this migration answers the first; the second is already
-- answered, unchanged, by migration 0123.
--
-- 'clinical_lead' and 'clinic_admin' are genuinely new values -- no
-- school role has authority over a slice of an organisation (lead), and
-- admin's "broad access to little" is semantically distinct from an
-- SNA's "deep access to few" (PRD section 9's own reasoning for not
-- reusing sna).
--
-- No new AUTHORITY is granted by this migration alone -- every function
-- below still gates on the SPECIFIC role values it always has. This
-- migration only makes the three values legal to store.
alter table public.institution_staff
  drop constraint if exists institution_staff_role_check;
alter table public.institution_staff
  add constraint institution_staff_role_check
  check (role in (
    'class_teacher', 'institution_admin', 'sna', 'principal',
    'clinician', 'clinical_lead', 'clinic_admin'
  ));

-- The self-link INSERT policy is the one place this stage's own recon
-- named as a real security finding, not just a widening: the policy had
-- no institution-TYPE awareness at all, so a flat wider list would let
-- someone self-link as clinical_lead at a SCHOOL, or -- more
-- consequentially -- as 'clinician' at a school, bypassing that
-- institution's own real, verification-gated clinician mechanism (the
-- clinicians table + specialty selection) entirely. Client-side
-- branching (the role-picker only offering type-appropriate tiles) is
-- not a gate; this is the gate. Made explicitly type-aware: a school
-- institution accepts exactly the four values it always has, a clinic
-- institution accepts principal (as clinical director) plus the three
-- clinic-only values, and neither type accepts the other's exclusive
-- set. A flat wider list here would have been a regression dressed as a
-- feature.
alter policy "Institution admins and class teachers can self-link"
  on public.institution_staff
  with check (
    auth.uid() = user_id
    and public.current_user_role() = role
    and (
      (
        (select type from public.institutions where id = institution_id) = 'school'
        and role in ('institution_admin', 'class_teacher', 'sna', 'principal')
      )
      or (
        (select type from public.institutions where id = institution_id) = 'clinic'
        and role in ('clinician', 'clinical_lead', 'clinic_admin', 'principal')
      )
    )
  );

-- Everything else about joining a clinic works unchanged, confirmed by
-- reading each live definition rather than assumed:
-- derive_staff_join_approval() only special-cases role = 'principal'
-- (first-principal bootstrap) -- every other role value, clinic-only
-- ones included, already falls through to pending-by-default, matching
-- PRD section 3's "approved by the director" exactly. approve_staff_join()/
-- reject_staff_join() are role-agnostic about what's being approved --
-- only the CALLER's own principal standing is checked.
-- institution_staff_has_current_standing() is role-agnostic (confirmed,
-- PRD 5 Stage 1 recon). get_institution_staff_roster() (0125) returns
-- every institution_staff row with no role filter at all. None of these
-- needed touching.
