/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   Migration 0010's fix queried auth.users directly from a policy, which
   failed with "permission denied for table users" -- the authenticated
   Postgres role has no SELECT grant on auth.users in this project (that
   table is intentionally locked down by Supabase). The fix is the same
   technique already used for owns_passport: a SECURITY DEFINER function
   runs with its owner's privileges, bypassing that grant restriction,
   without needing to grant broad auth.users access to authenticated. */

create or replace function public.current_user_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select raw_user_meta_data ->> 'role' from auth.users where id = auth.uid();
$$;

drop policy if exists "Institution admins can create an institution" on public.institutions;

create policy "Institution admins can create an institution"
  on public.institutions
  for insert
  to authenticated
  with check (public.current_user_role() = 'institution_admin');

drop policy if exists "Institution admins and class teachers can self-link" on public.institution_staff;

create policy "Institution admins and class teachers can self-link"
  on public.institution_staff
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and public.current_user_role() in ('institution_admin', 'class_teacher')
  );
