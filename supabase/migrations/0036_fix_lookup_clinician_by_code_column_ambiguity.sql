/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   Bug fix, found during Phase 1 adversarial verification of migration
   0034: lookup_clinician_by_code(text) declares `returns table (id uuid,
   user_id uuid, full_name text, specialty text)`, which makes `user_id`
   an implicit PL/pgSQL variable in the function's own namespace -- the
   exact same failure mode as approve_clinician before migration 0030's
   fix. The rate-limit check's `where user_id = v_uid` is an unqualified
   reference inside a WHERE clause, colliding with
   code_lookup_attempts.user_id, so every call failed with "column
   reference \"user_id\" is ambiguous" before ever reaching the real
   lookup -- confirmed live while re-testing a real clinician's code
   post-fix. No lookup ever succeeded under this bug, so no attempt row
   or lookup result was ever recorded incorrectly; this purely restores
   the function to working.

   lookup_passport_by_code was checked for the same pattern and is safe:
   none of its output columns (id, child_name, passport_code_active)
   collide with an unqualified reference anywhere in its body.

   Fix: qualify the rate-limit check's user_id reference with the table
   name, exactly as approve_clinician's fix qualified its own collision.
   Nothing else about the function changes -- same signature, same
   validation order, same rate limit, same grants (untouched, still
   revoked from public/anon/authenticated then re-granted to
   authenticated only from 0034). */

create or replace function public.lookup_clinician_by_code(code text)
returns table (
  id uuid,
  user_id uuid,
  full_name text,
  specialty text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_recent_failures integer;
  v_id uuid;
  v_clinician_user_id uuid;
  v_full_name text;
  v_specialty text;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  select count(*) into v_recent_failures
  from public.code_lookup_attempts
  where public.code_lookup_attempts.user_id = v_uid
    and lookup_type = 'clinician'
    and attempted_at > now() - interval '1 hour';

  if v_recent_failures >= 10 then
    raise exception 'Too many failed lookups. Please try again later.';
  end if;

  select c.id, c.user_id, c.full_name, c.specialty
  into v_id, v_clinician_user_id, v_full_name, v_specialty
  from public.clinicians c
  where c.clinician_code = code
    and c.verification_status = 'verified';

  if v_id is null then
    insert into public.code_lookup_attempts (user_id, lookup_type) values (v_uid, 'clinician');
    return;
  end if;

  return query select v_id, v_clinician_user_id, v_full_name, v_specialty;
end;
$$;
