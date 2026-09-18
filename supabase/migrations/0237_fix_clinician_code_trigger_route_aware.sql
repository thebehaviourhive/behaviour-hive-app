-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- A REAL, LIVE BUG, FOUND BY A REAL BROWSER CHECK DURING PRD 7 STAGE 3,
-- CHASED DOWN BEFORE STAGE 4 PER DANIEL'S OWN INSTRUCTION. `ensure_
-- clinician_code_on_verify` (0031, "BEFORE INSERT OR UPDATE ON
-- clinicians") fires whenever a row's own verification_status reaches
-- 'verified' with clinician_code still null -- with NO awareness of
-- verification_route, because that column did not exist for another
-- seven months (0221). Its own header comment at the time said it
-- exists to guarantee a code "regardless of whether that happened via
-- approve_clinician(), a direct Table Editor edit, or any other future
-- path" -- correct as written, but nobody revisited it when 0222 added
-- a genuine second future path (a clinic practitioner approved via
-- approve_staff_join(), verification_route = 'organisation') that was
-- always meant to stay code-less: bulk_grant_clinician_access()'s own
-- roster path (0224) resolves a practitioner directly via institution_
-- staff, never by code, and src/app/more/page.tsx has copy built on
-- exactly that premise ("You don't need a code -- your director
-- assigns your caseload directly").
--
-- The trigger's own INSERT statement inside approve_staff_join()'s
-- clinic branch (verification_status = 'verified' from the moment the
-- row is created) was enough to fire it -- confirmed live: a genuine
-- self-link + approve_staff_join() test on the deployed app produced a
-- real, non-null clinician_code for an organisation-route practitioner,
-- contradicting the /more page's own copy for that exact state.
--
-- CHECKED BEFORE FIXING, NOT ASSUMED: queried production directly for
-- clinicians.verification_route = 'organisation' AND clinician_code is
-- not null -- ZERO real rows. The only account this ever hit was this
-- session's own already-torn-down verification fixture. No backfill
-- needed; this is a pure forward fix.
--
-- THE FIX: teach the trigger about verification_route, the same way it
-- would have been written if that column had existed on day one --
-- generate a code only when the route is NOT 'organisation'. The
-- independent path (verification_route null, mid-review, or
-- 'behaviour_hive') is completely unaffected -- approve_clinician()'s
-- own explicit generation, and this trigger's own safety net for any
-- other path that reaches 'verified' without going through it, both
-- keep working exactly as before.
-- ===========================================================================

create or replace function public.ensure_clinician_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verification_status = 'verified'
     and new.clinician_code is null
     and new.verification_route is distinct from 'organisation'
  then
    loop
      new.clinician_code := 'CL-' || upper(substr(md5(random()::text), 1, 4));
      exit when not exists (
        select 1 from public.clinicians
        where clinician_code = new.clinician_code
          and id is distinct from new.id
      );
    end loop;
  end if;
  return new;
end;
$$;
