/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   The diagnostic query showed the institutions insert policy is exactly
   what migration 0011 set: WITH CHECK = (current_user_role() = 'institution_admin').
   That function provably returns the correct role when called directly
   (confirmed via RPC with the same token that fails the insert), so
   something about its evaluation inside this specific WITH CHECK isn't
   resolving the same way. Rather than revert to a pure auth.jwt() claim
   check -- already proven to fail the same way in migration 0009, even
   against a hand-decoded token confirmed to contain the right claim --
   this combines both mechanisms with OR, so whichever one actually
   resolves correctly in this context lets the insert through. Also adds
   an update policy for institution_admin, which didn't exist yet. */

drop policy if exists "Institution admins can create an institution" on public.institutions;

create policy "Institution admins can create an institution"
  on public.institutions
  for insert
  to authenticated
  with check (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'institution_admin'
    or public.current_user_role() = 'institution_admin'
  );

create policy "Institution admins can update their own institution"
  on public.institutions
  for update
  to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = institutions.id
        and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = institutions.id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists "Institution admins and class teachers can self-link" on public.institution_staff;

create policy "Institution admins and class teachers can self-link"
  on public.institution_staff
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and (
      (auth.jwt() -> 'user_metadata' ->> 'role') in ('institution_admin', 'class_teacher')
      or public.current_user_role() in ('institution_admin', 'class_teacher')
    )
  );
