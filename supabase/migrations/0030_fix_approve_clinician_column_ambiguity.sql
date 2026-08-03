/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   Bug fix, found during adversarial verification of migration 0029:
   approve_clinician(text) declared `returns table (clinician_code text)`,
   which makes PL/pgSQL expose `clinician_code` as an implicit variable in
   the function's own namespace -- colliding with the real
   public.clinicians.clinician_code column. The collision was silent
   everywhere the column was referenced qualified (clinicians.clinician_code)
   or as an UPDATE ... SET target (always unambiguous, since a SET target
   is a plain column identifier by SQL syntax), but the code-generation
   loop's `where clinician_code = v_code` is an unqualified reference
   inside a WHERE clause -- exactly the context where PL/pgSQL's variable
   resolution collides with the column, and Postgres correctly refused to
   guess: "column reference \"clinician_code\" is ambiguous". Confirmed
   live: every approve_clinician(...) call failed with that error before
   ever reaching the UPDATE, so no clinician was ever left half-approved
   (verified with no code, or vice versa) by this bug -- it never got far
   enough to write anything.

   Fix: rename the output column to `code` (matching the naming already
   used by submit_clinician_verification originally, back when it
   returned a code) -- "code" isn't a column of clinicians or anything
   else this function touches, so no further collision is possible. The
   function's actual behaviour (atomically approve + generate on first
   approval) is unchanged; only the output column name differs, so
   nothing that already ran against 0029 needs any data fixed -- there
   was never a successful call to roll back. */

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
      clinician_code = v_code
  where id = v_clinician_id;

  return query select v_code;
end;
$$;

revoke all on function public.approve_clinician(text) from public;
revoke all on function public.approve_clinician(text) from authenticated, anon;
grant execute on function public.approve_clinician(text) to service_role;
