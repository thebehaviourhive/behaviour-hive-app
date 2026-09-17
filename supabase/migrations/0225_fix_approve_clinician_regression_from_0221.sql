-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 5 Stage 6 verification -- a real regression, found by the
-- verification fixture doing exactly its job. 0221 rewrote
-- approve_clinician() from 0029's own original text (to add
-- verification_route = 'behaviour_hive' to the SET clause) without
-- checking for a superseding migration first -- and 0030 already
-- exists, fixing the exact function this migration touched: 0029's
-- `returns table (clinician_code text)` makes PL/pgSQL expose
-- `clinician_code` as an implicit variable in the function's own
-- namespace, colliding with the unqualified `where clinician_code =
-- v_code` inside the code-generation loop -- "column reference
-- \"clinician_code\" is ambiguous", every single time a genuinely new
-- clinician (no existing code) was approved. 0030's fix: rename the
-- output column to `code` (so no PostgreSQL identifier collides with
-- it) and table-qualify the WHERE reference as belt-and-braces. 0221
-- silently reverted BOTH -- confirmed live, re-run against the
-- deployed schema: approve_clinician() failed with the exact
-- "ambiguous" error on the very first genuinely-new clinician it was
-- asked to approve, and every downstream RPC caller that reads
-- `.code` off the return value (the adversarial suite included) would
-- have silently received `undefined` instead, since 0221 renamed the
-- column back to `clinician_code`.
--
-- This is exactly the "READ THE LIVE DEFINITION, NOT THE FIRST ONE YOU
-- FIND" mistake CLAUDE.md already has a dedicated entry for -- made
-- here despite that, because the grep that found approve_clinician()
-- stopped at 0029 without checking whether anything later touched the
-- same function. Fixed the same way 0030 fixed it the first time:
-- restore the `code` output column and the table-qualified WHERE
-- clause, keep 0221's own genuine addition (verification_route).

drop function if exists public.approve_clinician(text);

create or replace function public.approve_clinician(clinician_email text)
returns table (code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_clinician_id uuid;
  v_status text;
  v_code text;
begin
  select u.id into v_user_id from auth.users u where u.email = clinician_email;
  if v_user_id is null then
    raise exception 'No user found with email %', clinician_email;
  end if;

  select id, clinicians.verification_status, clinicians.clinician_code
  into v_clinician_id, v_status, v_code
  from public.clinicians
  where user_id = v_user_id;

  if v_clinician_id is null then
    raise exception 'No clinician profile found for %', clinician_email;
  end if;

  if v_status <> 'pending' then
    raise exception 'Clinician % is not pending verification (current status: %)', clinician_email, v_status;
  end if;

  if v_code is null then
    loop
      v_code := 'CL-' || upper(substr(md5(random()::text), 1, 4));
      exit when not exists (select 1 from public.clinicians where public.clinicians.clinician_code = v_code);
    end loop;
  end if;

  update public.clinicians
  set verification_status = 'verified',
      verification_route = 'behaviour_hive',
      clinician_code = v_code
  where id = v_clinician_id;

  return query select v_code;
end;
$$;

revoke all on function public.approve_clinician(text) from public;
revoke all on function public.approve_clinician(text) from authenticated, anon;
grant execute on function public.approve_clinician(text) to service_role;
