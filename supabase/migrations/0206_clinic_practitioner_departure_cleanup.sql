-- PRD 5 Stage 2 -- a real gap found while resolving this stage's own
-- premise, not asked for by name but a direct consequence of it: now
-- that a clinic's own practitioners are institution_staff rows (0203),
-- their deactivation goes through deactivate_institution_staff() ->
-- _close_child_access_for_departure(), exactly like a class_teacher's
-- own departure. That function closes passport_access,
-- class_teachers, and child_assignments on departure -- all
-- school-specific mechanisms -- but never touched clinician_access at
-- all, because no clinician had ever gone through this path before
-- (school-engaged clinicians were never institution_staff, and their
-- own access revocation goes through a separate, clinician-specific
-- mechanism). Without this fix, deactivating a clinic practitioner
-- would leave every client on their caseload fully accessible to them
-- indefinitely -- the exact "access granted but never actually closed"
-- shape CLAUDE.md already warns about elsewhere in this build.
--
-- Scoped narrowly: only the departing user's own engaged_by =
-- 'institution' rows AT THIS institution are closed -- their own
-- engaged_by = 'parent' engagements (if any, from working
-- independently elsewhere) are untouched, matching the existing
-- revoke_clinician_access() precedent's own engaged_by-scoped
-- reasoning (0123).
--
-- DOES NOT CONTRADICT 0123's own "deactivate_institution_staff() and
-- hand_over_principal() are NOT touched... the engagement belongs to
-- the institution, not the staff member who happened to click grant"
-- -- that passage is about a GRANTOR's departure (a principal who
-- approved a clinician leaving) never affecting the GRANTEE's
-- continued access, "the same way a class survives its teacher
-- leaving." This migration answers a different question: does the
-- GRANTEE's own departure end their own access, when the grantee IS
-- the institution_staff member being deactivated (a clinic
-- practitioner leaving). That's the same shape passport_access already
-- gets a few lines above -- the departing person's OWN grants close,
-- not anyone else's.
create or replace function public._close_child_access_for_departure(
  p_user_id uuid,
  p_institution_id uuid,
  p_actor_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_name text;
  v_grants_revoked integer := 0;
  v_grant record;
begin
  select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name')
  into v_target_name
  from auth.users u
  where u.id = p_user_id;

  for v_grant in
    select id, passport_id
    from public.passport_access
    where teacher_id = p_user_id
      and institution_id = p_institution_id
      and is_active = true
  loop
    update public.passport_access set is_active = false where id = v_grant.id;

    insert into public.activity_log (passport_id, actor_id, event_type, event_description)
    values (
      v_grant.passport_id,
      p_actor_id,
      'access_revoked',
      'Access removed for ' || coalesce(v_target_name, 'a staff member') || ' (staff member deactivated)'
    );

    v_grants_revoked := v_grants_revoked + 1;
  end loop;

  update public.class_teachers ct
  set ended_at = now(), ended_by = p_actor_id, end_reason = 'Staff member deactivated.'
  from public.classes c
  where ct.class_id = c.id
    and c.institution_id = p_institution_id
    and ct.user_id = p_user_id
    and ct.ended_at is null;

  update public.child_assignments
  set ended_at = now(), ended_by = p_actor_id, end_reason = 'Staff member deactivated.'
  where institution_id = p_institution_id
    and user_id = p_user_id
    and ended_at is null;

  -- NEW: a clinic practitioner's own institution-engaged caseload,
  -- closed the same way passport_access is above.
  for v_grant in
    select id, passport_id
    from public.clinician_access
    where clinician_id = p_user_id
      and engaged_by = 'institution'
      and engaged_by_institution_id = p_institution_id
      and is_active = true
  loop
    update public.clinician_access set is_active = false where id = v_grant.id;

    insert into public.activity_log (passport_id, actor_id, event_type, event_description)
    values (
      v_grant.passport_id,
      p_actor_id,
      'access_revoked',
      'Access removed for ' || coalesce(v_target_name, 'a staff member') || ' (staff member deactivated)'
    );

    v_grants_revoked := v_grants_revoked + 1;
  end loop;

  return v_grants_revoked;
end;
$$;
