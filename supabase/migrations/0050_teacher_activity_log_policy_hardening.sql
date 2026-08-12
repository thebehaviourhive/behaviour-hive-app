-- SECURITY FIX, found via adversarial verification of migration 0049's
-- matrix (JWT-level check, not just UI filtering -- exactly what the
-- brief asked the audit to catch).
--
-- "Teachers can view activity for passports they access" (migration
-- 0028) has NO event_type filter at all -- it grants raw SELECT on
-- every event type for any passport the teacher has access to. That
-- policy predates fba_started/fba_completed/clinical_content_added
-- entirely (migration 0028 came before 0042), so it was never updated
-- when those event types were added: get_teacher_activity_feed()'s own
-- allow-list is a correct, careful convenience filter, but a teacher
-- calling supabase.from("activity_log").select(...) directly bypasses
-- it completely and could already see fba_completed and
-- clinical_content_added today, and would see fba_started,
-- questionnaire_sent, and questionnaire_completed as soon as migration
-- 0049 shipped -- a real "teacher: NEVER" violation at the data-access
-- level, not just a UI gap.
--
-- Fix: narrow the policy to an explicit ALLOW-list mirroring
-- get_teacher_activity_feed()'s own event_type list exactly (an
-- allow-list, not a deny-list of the four forbidden types, so a future
-- new event type fails closed -- excluded by default -- instead of
-- failing open the way this exact bug just did). No behaviour change
-- for any event type teachers could already correctly see.
--
-- Deliberately NOT touched here: the policy still lacks the RPC's
-- separate "not authored by a clinician" exclusion (so a teacher's
-- direct query can still see a clinician-authored abc_logged/
-- passport_updated/team_linked/strategy_logged row that the RPC itself
-- would hide). That's a real, pre-existing gap too, but it's outside
-- this task's clinical-event matrix (abc_logged etc. aren't in it) --
-- flagged, not fixed, so as not to silently change unrelated existing
-- behaviour without being asked.

alter policy "Teachers can view activity for passports they access"
  on public.activity_log
  using (
    event_type in (
      'passport_updated', 'abc_logged', 'team_linked', 'strategy_logged',
      'access_revoked', 'afternoon_update', 'clinical_content_added'
    )
    and exists (
      select 1
      from public.passport_access pa
      join public.passport_institution_links pil
        on pil.passport_id = pa.passport_id
        and pil.institution_id = pa.institution_id
        and pil.approved_by_parent = true
      where pa.passport_id = activity_log.passport_id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
    )
  );
