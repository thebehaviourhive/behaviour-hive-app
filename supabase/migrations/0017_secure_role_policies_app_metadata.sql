/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   Fixes two Supabase advisor errors: the RLS policies on public.institutions
   and public.institution_staff referenced auth.jwt() -> 'user_metadata'.
   Worse, even the "fixed" version from migration 0011 -- which wrapped the
   check in the current_user_role() SECURITY DEFINER function -- still read
   auth.users.raw_user_meta_data under the hood, the exact same user-editable
   column, just fetched a different way. Any authenticated user can rewrite
   their own raw_user_meta_data at any time via
   supabase.auth.updateUser({ data: { role: 'institution_admin' } }), which
   would satisfy both the flagged auth.jwt() branch AND the function-wrapped
   branch, letting them create institution rows or self-link as
   institution_admin / class_teacher for any institution.

   raw_app_meta_data is the column GoTrue guarantees end users cannot write
   themselves -- it's only settable via the service role (e.g.
   supabase.auth.admin.updateUserById from a trusted server context). This
   migration:
     1. Backfills every existing user's role from raw_user_meta_data into
        raw_app_meta_data, so nobody loses access when the policies switch
        over.
     2. Repoints current_user_role() at raw_app_meta_data instead of
        raw_user_meta_data.
     3. Drops the auth.jwt() -> 'user_metadata' OR-branch from both
        policies entirely, leaving current_user_role() -- now backed by the
        secure column -- as the sole check. Same operations permitted as
        before (institution_admin can create an institution;
        institution_admin and class_teacher can self-link themselves),
        just checked securely.

   This SQL alone closes the escalation path immediately: from the moment
   it runs, current_user_role() reads raw_app_meta_data, and nothing
   client-side (updateUser, signUp) can write to that column. A follow-up
   app-code change is still needed so that *future* role assignments (e.g.
   a parent picking their role on /role-select) get written into
   app_metadata instead of user_metadata -- see the accompanying notes for
   exactly what that involves. Until that ships, new role selections will
   keep writing to user_metadata as before and will have no effect on
   these two policies (current_user_role() no longer looks there), so
   that follow-up should not be left indefinitely. */

-- 1. Backfill: copy each user's current role into app_metadata, merging
--    with whatever GoTrue already stores there (provider, providers, etc.)
--    rather than overwriting it.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('role', raw_user_meta_data ->> 'role')
where raw_user_meta_data ->> 'role' is not null
  and raw_app_meta_data ->> 'role' is distinct from raw_user_meta_data ->> 'role';

-- 2. Repoint the existing SECURITY DEFINER helper at the secure column.
create or replace function public.current_user_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select raw_app_meta_data ->> 'role' from auth.users where id = auth.uid();
$$;

-- 3. Replace both flagged policies. Functionally identical to the
--    originals, minus the insecure user_metadata fallback.
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
