/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SCHOOL INCIDENT LOG -- fixes a real bug in the original 0068 build,
   caught live while verifying Part 3.

   THE BUG: incident_actions has SELECT, INSERT, and DELETE policies --
   never an UPDATE policy. toggleAction() only ever inserts or deletes a
   row, so this went unnoticed until 0080 added other_detail (the
   "Other" action's free-text companion) and the client tried to UPDATE
   an existing row to set it. Live proof: selected "Other" in Actions
   Taken, typed a detail, blurred -- no error, the row existed with the
   right action_type_id -- but other_detail stayed null. RLS on UPDATE
   silently filters rather than erroring (this codebase's own CLAUDE.md,
   learned the hard way on this exact module) -- the write matched zero
   rows and nothing said so.

   THE FIX: an UPDATE policy matching the INSERT/DELETE policies already
   on this table exactly -- creator or owning teacher, before sign-off.
   No column-level restriction (this codebase doesn't use column GRANTs
   anywhere else; other_detail is the only field any client update ever
   touches on this table, same posture as incident_debriefs' completed_
   at/completed_by). */

create policy "Creator or owning teacher can edit an action before sign-off"
  on public.incident_actions for update to authenticated
  using (
    exists (
      select 1 from public.incidents i
      where i.id = incident_actions.incident_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.incidents i
      where i.id = incident_actions.incident_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  );
