/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   Fixes a real bug caught during live testing of the new activity_log
   feature: passport_access has no UPDATE policy for teachers at all
   (migration 0014 only gave parents an UPDATE policy, for revoking).
   So when AddChildSheet.tsx tries to reactivate a previously-revoked
   row (is_active: true), RLS silently matches zero rows -- PostgREST
   still reports success (204) since the WHERE clause is syntactically
   valid, it just filters out every row, so the app had no way to tell
   the update didn't actually happen.

   This policy is deliberately narrow, mirroring the INSERT policy's
   full authorization chain (migration 0014) rather than just checking
   "is this your row":

   - USING only exposes a row to UPDATE at all if it already belongs to
     this teacher (teacher_id = auth.uid()) AND is currently revoked
     (is_active = false) -- a teacher can never touch another teacher's
     row, and can never use this policy to flip an ACTIVE row to
     inactive (that stays parent-only) or do anything else with it.

   - WITH CHECK re-proves the exact same authorization a fresh INSERT
     would require -- current institution_staff membership at
     institution_id, and a still-approved passport_institution_links
     row for that passport_id/institution_id -- so a teacher whose
     institution access or parental approval was revoked in the
     meantime can't reactivate old access to bypass that. It also
     re-asserts teacher_id = auth.uid() on the resulting row, so even
     if a client tried to smuggle a different teacher_id/institution_id/
     passport_id into the update, the row can never end up assigned to
     someone else or granting access nobody currently approved. */

create policy "Teachers can reactivate their own revoked access"
  on public.passport_access
  for update
  to authenticated
  using (
    teacher_id = auth.uid()
    and is_active = false
  )
  with check (
    teacher_id = auth.uid()
    and is_active = true
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = passport_access.institution_id
        and s.user_id = auth.uid()
    )
    and exists (
      select 1 from public.passport_institution_links pil
      where pil.passport_id = passport_access.passport_id
        and pil.institution_id = passport_access.institution_id
        and pil.approved_by_parent = true
    )
  );
