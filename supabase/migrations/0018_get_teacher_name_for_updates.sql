/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   Wiring the parent dashboard's afternoon card to real teacher_updates data
   needs the submitting teacher's display name. The existing SELECT policy
   on teacher_updates (migration 0007, "Teachers and the child's parent can
   view an update") already lets a parent read the row itself -- confirmed
   live against the real database with a disposable parent/teacher/passport
   set up for this -- so no new policy on that table is needed.

   What's missing is resolving teacher_id into a name: parents have no
   grant on auth.users (confirmed earlier this project -- "permission
   denied for table users"), and a broad grant would let any authenticated
   user read anyone's full name. This function is scoped narrowly: it only
   returns a name for a teacher_id that the CALLER can already legitimately
   see via an existing teacher_updates row -- either they're that teacher,
   or they're the parent on the passport that update belongs to. It adds
   no new exposure beyond what the caller could already infer from the
   teacher_updates row they're allowed to read (they can already see
   teacher_id itself; this just resolves it to a name). full_name lives in
   user_metadata for both roles (only "role" was migrated to app_metadata
   during the earlier RLS security fix), with app_metadata checked as a
   fallback in case that ever changes. */

create or replace function public.get_teacher_name(p_teacher_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    u.raw_user_meta_data ->> 'full_name',
    u.raw_app_meta_data ->> 'full_name'
  )
  from auth.users u
  where u.id = p_teacher_id
    and exists (
      select 1
      from public.teacher_updates tu
      join public.passports p on p.id = tu.passport_id
      where tu.teacher_id = p_teacher_id
        and (auth.uid() = tu.teacher_id or p.user_id = auth.uid())
    );
$$;

grant execute on function public.get_teacher_name(uuid) to authenticated;
