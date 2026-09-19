-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- SECOND INSTANCE OF "A REBUILD CAN SILENTLY DROP A GATE AND CLAIM IT DID
-- NOT" -- the first was 0060 dropping fba_afls_data's completed-lock.
-- Both times a function was rewritten from an earlier version and a
-- later, deliberate fix was lost in the rewrite.
--
-- 0103 (fix_derive_countersign_fields_multi_row) found and fixed a real
-- live bug: derive_countersign_fields()'s own role lookup --
--
--   select s.role into v_role from institution_staff s
--   where s.institution_id = new.institution_id and s.user_id = auth.uid();
--
-- -- has no deactivated_at/approved_at filter and no ORDER BY. This was
-- safe only while a person could hold at most one institution_staff row
-- per institution. Migration 0097 (deactivation/rejoin) and, certainly,
-- hand_over_principal() (0102) both make two rows for the same
-- (institution, user) pair a normal, expected state -- the person's OLD
-- (closed) row and their NEW (active) one, genuinely differing in role.
-- Postgres's unfiltered SELECT INTO against multiple matching rows
-- returns an unspecified one. 0103 fixed this with an explicit current-
-- standing filter plus "order by created_at desc limit 1" as defence in
-- depth, and its own header describes the exact symptom this produces:
-- a freshly-promoted principal's first countersign attributed
-- countersigned_via='grant', countersigned_role_at_time='class_teacher'
-- -- their OLD, closed row's role, not their new active one.
--
-- 0245 (this session's own PRD 8 Stage 1 work, incident withholding)
-- rewrote derive_countersign_fields() from scratch to add the withhold-
-- decision logic, working from a version of the function that predated
-- 0103's fix -- and silently reintroduced the exact bug 0103 closed.
-- Found by CHECK X's own adversarial coverage (X13b) during PRD 9 Stage
-- 1's own full-suite gate run, 19 Sept 2026 -- confirmed live, not
-- assumed: a real handover's successor, countersigning for the first
-- time as the newly-active principal, was attributed
-- countersigned_via='grant', countersigned_role_at_time='class_teacher',
-- word-for-word the same wrong shape 0103's own header describes.
--
-- THE RULE THIS EARNS, alongside "read the live definition, not the
-- first one you find": when rewriting a function from scratch rather
-- than extending its current body in place, read EVERY migration that
-- has ever touched it, not just the one the rewrite is based on. 0245
-- DID read the live definition -- it just read the wrong ONE, a version
-- that predated 0103's fix, and 0103's own header names the exact
-- symptom that came back. The check is mechanical: grep every migration
-- for the function's name, read them in order, and confirm each earlier
-- fix survives whatever the rewrite is about to replace it with.
--
-- SCOPE, CONFIRMED NOT ASSUMED: every other assertion in the adversarial
-- suite touching countersigned_role_at_time/countersigned_via was read
-- directly before writing this migration. Every one of them has a
-- countersigning caller holding exactly ONE institution_staff row at
-- that institution at the moment of their own countersign_incident()
-- call (a fixture's single-role principal, or a single-role class_
-- teacher grant-holder) -- or, in CHECK V's case, a value frozen BEFORE
-- a later deactivation creates a second row, not before it. CHECK X's
-- X13b, testing hand_over_principal()'s own successor, is the only
-- place a real handover produces two rows for the countersigning caller
-- before their own countersign call. It is the only affected assertion.
--
-- THE FIX: restore 0103's filter and ordering into 0245's current body.
-- Nothing about 0245's own withhold-decision logic changes -- same
-- shape, same columns, same "not available afterwards" enforcement.

create or replace function public.derive_countersign_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text;
begin
  if new.countersigned_at is not null and old.countersigned_at is null then
    select s.role into v_role
    from public.institution_staff s
    where s.institution_id = new.institution_id
      and s.user_id = auth.uid()
      and s.deactivated_at is null
      and s.approved_at is not null
    order by s.created_at desc
    limit 1;

    new.countersigned_by := auth.uid();
    new.countersigned_role_at_time := v_role;
    new.countersigned_via := case when v_role = 'principal' then 'principal_role' else 'grant' end;

    new.withheld_from_clinic_decided_at := now();
    new.withheld_from_clinic_decided_by := auth.uid();
  elsif old.countersigned_at is not null then
    new.withheld_from_clinic := old.withheld_from_clinic;
    new.withheld_from_clinic_reason := old.withheld_from_clinic_reason;
    new.withheld_from_clinic_decided_at := old.withheld_from_clinic_decided_at;
    new.withheld_from_clinic_decided_by := old.withheld_from_clinic_decided_by;
  else
    new.withheld_from_clinic := old.withheld_from_clinic;
    new.withheld_from_clinic_reason := old.withheld_from_clinic_reason;
  end if;
  return new;
end;
$function$;
