/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   Live-tested the teacher-side "Add a Child" flow end to end just now:
   the passport_access row is created correctly, but the activity_log
   insert that should follow it (team_linked) is rejected with a genuine
   RLS 42501, confirmed by replaying the exact insert with a real
   teacher JWT outside the app too. The parent-side insert policy
   (migration 0022) works correctly, confirmed the same way -- only the
   teacher one is failing, and its shape is otherwise identical to the
   already-working abc_logs teacher insert policy (migration 0019).

   Re-creating it here rather than debugging further in place: this is
   an idempotent drop-and-recreate of just the one policy, safe to run
   even if migration 0022 partially applied for an unknown reason. */

drop policy if exists "Teachers can insert activity for passports they access" on public.activity_log;

create policy "Teachers can insert activity for passports they access"
  on public.activity_log
  for insert
  to authenticated
  with check (
    actor_id = auth.uid()
    and exists (
      select 1 from public.passport_access pa
      where pa.passport_id = activity_log.passport_id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
    )
  );
