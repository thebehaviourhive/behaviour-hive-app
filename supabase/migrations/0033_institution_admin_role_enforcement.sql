/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SECURITY FIX (C-06 + C-07) -- any authenticated user who self-links into
   institution_staff (which any class_teacher can already do for any
   institution, by design -- institution codes are openly readable) can
   currently UPDATE that institution's row, including flipping status to
   'verified' or rewriting its name, because the UPDATE policy only checks
   that *some* institution_staff row exists for the caller -- it never
   checks that row's role is 'institution_admin'. Confirmed live: a plain
   class_teacher test account successfully re-verified and renamed a
   disposable test institution.

   Three changes, each additive/narrowing only -- nothing here removes an
   existing legitimate capability:

   1. The institutions UPDATE policy (0012) gets `and s.role =
      'institution_admin'` added to both its USING and WITH CHECK clauses,
      via ALTER POLICY -- same mechanism and same guarantee as migration
      0032, only this one existing policy is touched.
   2. institution_staff.role has never had a CHECK constraint (it's a
      free-text column with a default). This adds one limiting it to the
      two values the app actually uses -- matches the only value the
      client ever inserts today (class_teacher) plus the value the
      institution-admin-onboarding SQL would need whenever that becomes
      reachable (per C-08, it currently isn't, and this migration doesn't
      change that).
   3. CORRECTED after review -- see below. The self-link INSERT policy
      needs one more check so a class_teacher can't write
      role='institution_admin' for themselves, but it must be checked
      against a source the caller can't forge.

   ON POINT 3 -- important correction from the first draft of this file:
   my original version checked the written role against
   auth.users.raw_user_meta_data (i.e. Supabase's client-writable
   `user_metadata`). That's wrong, and this codebase already learned this
   lesson once: migration 0017's own comment documents that ANY
   authenticated user can rewrite their own raw_user_meta_data at any time
   via `supabase.auth.updateUser({ data: { role: 'institution_admin' } })`,
   and fixed an identical bug in current_user_role() by repointing it at
   raw_app_meta_data instead -- the column GoTrue guarantees end users
   cannot write themselves (only settable via the service role, e.g.
   /api/set-role's use of supabase.auth.admin.updateUserById). Checking
   the written institution_staff.role against raw_user_meta_data would
   have reintroduced exactly the bug 0017 already closed: an attacker
   could just set their own user_metadata.role to whatever they were
   about to write into institution_staff.role and pass both sides of the
   check trivially.

   The self-link policy's CURRENT live definition, as of migration 0017,
   already checks the caller's real role correctly:

     with check (
       auth.uid() = user_id
       and public.current_user_role() in ('institution_admin', 'class_teacher')
     )

   (current_user_role() reads raw_app_meta_data -- see 0011 and 0017.)
   The fix here adds exactly one more condition to that already-secure
   check: the role being WRITTEN must equal current_user_role() itself,
   not just be a member of the allowed set. This is also why item 1's
   institutions UPDATE fix is safe to leave as a check against
   institution_staff.role directly (not current_user_role() again) --
   once this fix is in place, a row in institution_staff can never hold a
   role its owner doesn't actually have, so institution_staff.role becomes
   a trustworthy value to key the UPDATE policy off. Confirmed via grep
   that institution_staff has no UPDATE or DELETE policy at all -- INSERT
   is the only write path, so fixing it here closes the loop completely. */

-- 1. institutions UPDATE -- require the institution_admin role, not just
--    any staff membership.
alter policy "Institution admins can update their own institution"
  on public.institutions
  using (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = institutions.id
        and s.user_id = auth.uid()
        and s.role = 'institution_admin'
    )
  )
  with check (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = institutions.id
        and s.user_id = auth.uid()
        and s.role = 'institution_admin'
    )
  );

-- 2. institution_staff.role -- restrict to legitimate values. Confirmed
--    via grep that the client only ever inserts 'class_teacher' today, so
--    this should apply cleanly against existing data.
alter table public.institution_staff
  add constraint institution_staff_role_check
  check (role in ('class_teacher', 'institution_admin'));

-- 3. institution_staff self-link INSERT -- the inserted role must match
--    the caller's own REAL role (current_user_role(), backed by
--    app_metadata), not the client-writable user_metadata.
alter policy "Institution admins and class teachers can self-link"
  on public.institution_staff
  with check (
    auth.uid() = user_id
    and public.current_user_role() in ('institution_admin', 'class_teacher')
    and public.current_user_role() = role
  );
