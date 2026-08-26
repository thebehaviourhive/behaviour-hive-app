-- Fixes a real gap in 0090: school_notices.notice_type has a check
-- constraint enumerating its allowed values (verified live before this
-- fix -- 'incident_parent_call', 'attestation_withdrawn'), which was
-- never checked before 0090's notify_owning_teacher_of_amendment()
-- trigger tried to insert a third value. Caught by the adversarial
-- suite (CHECK R13/R14), not by eye -- the trigger itself was correct,
-- the constraint just didn't know about its new value yet.

alter table public.school_notices
  drop constraint school_notices_notice_type_check;

alter table public.school_notices
  add constraint school_notices_notice_type_check
  check (notice_type = any (array['incident_parent_call'::text, 'attestation_withdrawn'::text, 'incident_amendment_added'::text]));
