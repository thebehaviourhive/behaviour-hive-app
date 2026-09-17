-- PRD 5 Stage 2: consents_role_check widened for clinical_lead and
-- clinic_admin. Deliberately its own migration, pushed and confirmed
-- run BEFORE any client code (the four consent screens) depends on it
-- -- the same discipline this stage's own ordering incident (recorded
-- in CLAUDE.md) exists to hold to. Held until now specifically because
-- the copy those two roles' own consent screens need did not exist yet
-- -- widening the constraint first would have let someone consent to
-- nothing meaningful (Daniel's own instruction, this session).
--
-- 'clinician' already present (it's always been a valid consents.role
-- value, independent of this stage's own institution_staff premise
-- resolution). No CURRENT_CONSENT_VERSION bump alongside this --
-- existing school consenters' own copy is unchanged in substance, so
-- nothing about what they already agreed to has changed; a version
-- bump would re-prompt every one of them for copy that isn't new to
-- them. A clinic user's own first-ever consent is simply recorded at
-- whatever version is current when they consent, the same as any
-- brand-new consenter today -- there is no existing clinic consenter
-- for a version bump to protect against re-prompting incorrectly.
alter table public.consents
  drop constraint if exists consents_role_check;
alter table public.consents
  add constraint consents_role_check
  check (role in ('parent', 'class_teacher', 'sna', 'principal', 'clinician', 'clinical_lead', 'clinic_admin'));
