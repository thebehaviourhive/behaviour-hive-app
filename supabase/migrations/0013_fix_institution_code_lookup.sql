/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   The only SELECT policy on institutions required the caller to already
   have an institution_staff row for that institution -- a chicken-and-egg
   problem for /teacher/join-institution, whose entire purpose is looking
   up an institution BEFORE that staff row exists. Confirmed via a real
   (non-service-role) teacher session: the lookup silently returned an
   empty array rather than an error, since RLS just filters the row out.

   institutions only holds a name, a share-to-join code, and a status --
   nothing sensitive -- so any authenticated user can look one up. This
   replaces the old policy rather than adding a second one, since it
   fully subsumes it. */

drop policy if exists "Staff can view their own institution" on public.institutions;

create policy "Authenticated users can look up an institution"
  on public.institutions
  for select
  to authenticated
  using (true);
