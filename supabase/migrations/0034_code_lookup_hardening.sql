/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SECURITY FIX (C-04, plus C-09's brute-force shape on the clinician
   lookup) -- confirmed live during the audit: lookup_passport_by_code
   returned a real child's FULL name to a caller using only the public
   anon key, with no Authorization header at all, despite the function's
   own grant being "to authenticated" only (migration 0015) -- and did so
   for 5 rapid sequential guesses with no throttling. Codes are low-
   entropy (3-letter name-derived prefix + 4 digits), so this is a live,
   practical child-name enumeration path, not a theoretical one.

   BEFORE RUNNING THE FIX -- run this diagnostic first and look at the
   result grid. It shows the grants Postgres actually has on these two
   functions right now, which is the authoritative source (not the
   migration file's stated intent):

     select routine_name, grantee, privilege_type
     from information_schema.role_routine_grants
     where routine_name in ('lookup_passport_by_code', 'lookup_clinician_by_code')
     order by routine_name, grantee;

   Whatever that shows, the fix below makes the actual grant state
   explicit and correct regardless of how it drifted: revoke from PUBLIC,
   anon, and authenticated, then grant execute to authenticated only.
   (Postgres unions every applicable grant -- see migration 0021's own
   note on the same failure mode with a table-level grant -- so revoking
   only from "public" isn't enough if anon or authenticated somehow picked
   up a separate direct grant along the way; this revokes all three
   explicitly before re-granting.)

   THREE CHANGES to each of the two lookup functions:

   1. Explicit auth.uid() IS NULL check inside the function body -- belt
      and suspenders underneath the grant fix, so even if the grant ever
      drifts again, the function itself refuses an unauthenticated caller.
   2. Rate limiting: a new code_lookup_attempts table records every FAILED
      lookup (no match found), keyed by (user_id, lookup_type). Before
      doing the real lookup, the function counts this caller's failures
      in the last hour for this lookup type and refuses with an error once
      that reaches 10 -- a real cap on brute-forcing either code space.
      The table has RLS enabled with no policies at all (same pattern as
      clinician_government_id): no client role can read or clear anyone's
      attempt history, only these SECURITY DEFINER functions touch it.
   3. lookup_passport_by_code specifically also stops returning the
      child's full name. The Add Child flow only needs enough for the
      teacher's UI to say "Child found -- request sent to parent"; full
      identity confirmation is the parent's approval step, not this
      pre-relationship lookup. Returns first name + last initial instead
      (the same "Sammy T." convention as getChildDisplayName() in
      src/lib/childDisplayName.ts, reimplemented here since this runs
      server-side). lookup_clinician_by_code's returned columns are
      unchanged -- only the rate limit is added there, since the task
      that flagged it (C-09) was about brute-force exposure, not the
      shape of what a *successful* lookup returns. */

create table if not exists public.code_lookup_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  lookup_type text not null check (lookup_type in ('passport', 'clinician')),
  attempted_at timestamptz not null default now()
);

create index if not exists code_lookup_attempts_user_type_time_idx
  on public.code_lookup_attempts (user_id, lookup_type, attempted_at);

alter table public.code_lookup_attempts enable row level security;
-- Deliberately no policies at all -- see clinician_government_id
-- (migration 0026) for the same pattern. With RLS enabled and no
-- matching policy, PostgREST can never return or modify this data
-- through any client role; only the SECURITY DEFINER functions below
-- (which bypass RLS) can touch it.

create or replace function public.lookup_passport_by_code(code text)
returns table (id uuid, child_name text, passport_code_active boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_recent_failures integer;
  v_id uuid;
  v_child_name text;
  v_active boolean;
  v_parts text[];
  v_display_name text;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  select count(*) into v_recent_failures
  from public.code_lookup_attempts
  where user_id = v_uid
    and lookup_type = 'passport'
    and attempted_at > now() - interval '1 hour';

  if v_recent_failures >= 10 then
    raise exception 'Too many failed lookups. Please try again later.';
  end if;

  select p.id, p.child_name, p.passport_code_active
  into v_id, v_child_name, v_active
  from public.passports p
  where p.passport_code ilike code
  limit 1;

  if v_id is null then
    insert into public.code_lookup_attempts (user_id, lookup_type) values (v_uid, 'passport');
    return;
  end if;

  v_parts := regexp_split_to_array(trim(v_child_name), '\s+');
  if array_length(v_parts, 1) = 1 then
    v_display_name := v_parts[1];
  else
    v_display_name := v_parts[1] || ' ' || upper(left(v_parts[array_length(v_parts, 1)], 1)) || '.';
  end if;

  return query select v_id, v_display_name, v_active;
end;
$$;

revoke all on function public.lookup_passport_by_code(text) from public;
revoke all on function public.lookup_passport_by_code(text) from anon;
revoke all on function public.lookup_passport_by_code(text) from authenticated;
grant execute on function public.lookup_passport_by_code(text) to authenticated;

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
  where user_id = v_uid
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

revoke all on function public.lookup_clinician_by_code(text) from public;
revoke all on function public.lookup_clinician_by_code(text) from anon;
revoke all on function public.lookup_clinician_by_code(text) from authenticated;
grant execute on function public.lookup_clinician_by_code(text) to authenticated;
