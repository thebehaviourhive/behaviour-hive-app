-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Fixes a real, live bug found running Stage 1c's own adversarial
-- coverage, not introduced by this stage's migration: derive_
-- countersign_fields() (migration 0090, unchanged since) resolves the
-- countersigning caller's role with
--
--   select s.role into v_role from institution_staff s
--   where s.institution_id = new.institution_id and s.user_id = auth.uid();
--
-- no deactivated_at/approved_at filter, no ORDER BY, no LIMIT. This was
-- silently safe in 0090's own era, when a person could only ever hold
-- ONE institution_staff row per institution. Migration 0097 (Stage 1
-- deactivation/rejoin) made a second row per (institution, user)
-- possible for the first time, and Stage 1c's hand_over_principal()
-- makes it certain on every promotion/demotion -- the person's OLD row
-- (closed, deactivated_at set, original role) and NEW row (active,
-- current role) both exist at the same institution simultaneously,
-- genuinely differing in role. Without a filter, PostgreSQL's
-- unqualified "SELECT ... INTO" against multiple matching rows returns
-- an unspecified one -- observed live: a freshly-promoted principal's
-- FIRST countersign after handover was attributed countersigned_via=
-- 'grant', countersigned_role_at_time='class_teacher' -- their OLD,
-- closed row's role, not their new active one. can_countersign_
-- incident() itself was never wrong (it's correctly filtered, confirmed
-- separately) -- only this trigger's own role LOOKUP was ambiguous.
--
-- Fix: filter to the caller's CURRENT active row, the same "who is this
-- person right now" shape used everywhere else in this schema
-- (deactivated_at is null and approved_at is not null), plus an
-- explicit "order by created_at desc limit 1" as defence in depth --
-- institution_staff_one_active_per_institution already guarantees at
-- most one row can match that filter per (institution, user), but a
-- future change to that guarantee should not silently reopen this exact
-- bug a second time.

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
  end if;
  return new;
end;
$function$;
