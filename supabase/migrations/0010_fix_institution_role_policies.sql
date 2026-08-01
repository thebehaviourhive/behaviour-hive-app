/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   Fixes the two insert policies from migration 0009, which checked
   auth.jwt() -> 'user_metadata' ->> 'role' and failed even against a
   freshly issued token whose decoded claims genuinely contained the
   right role (verified by hand-decoding the JWT). Reading the role
   straight from auth.users.raw_user_meta_data -- the actual source of
   truth GoTrue writes to -- sidesteps whatever JWT-claim propagation
   quirk was causing that, and is the more standard, robust pattern. */

drop policy if exists "Institution admins can create an institution" on public.institutions;

create policy "Institution admins can create an institution"
  on public.institutions
  for insert
  to authenticated
  with check (
    exists (
      select 1 from auth.users u
      where u.id = auth.uid()
        and u.raw_user_meta_data ->> 'role' = 'institution_admin'
    )
  );

drop policy if exists "Institution admins and class teachers can self-link" on public.institution_staff;

create policy "Institution admins and class teachers can self-link"
  on public.institution_staff
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from auth.users u
      where u.id = auth.uid()
        and u.raw_user_meta_data ->> 'role' in ('institution_admin', 'class_teacher')
    )
  );

/* Second, unrelated bug found during testing: passports' teacher-read
   policy queries passport_access, and passport_access's parent-read
   policy queries passports -- a direct A-references-B, B-references-A
   cycle, which Postgres rejects outright as "infinite recursion detected
   in policy". A SECURITY DEFINER function checks passport ownership
   without re-triggering passports' own RLS, breaking the cycle. */

create or replace function public.owns_passport(check_passport_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.passports p
    where p.id = check_passport_id and p.user_id = auth.uid()
  );
$$;

drop policy if exists "Parents can view access granted on their own passport" on public.passport_access;

create policy "Parents can view access granted on their own passport"
  on public.passport_access
  for select
  to authenticated
  using (public.owns_passport(passport_access.passport_id));
