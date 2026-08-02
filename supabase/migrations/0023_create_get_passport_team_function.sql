/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   Needed for the new parent dashboard "Your Team" card, which lists the
   teachers linked to a child's passport by name. Same problem as
   migration 0018 (get_teacher_name): parents have no grant on auth.users
   (confirmed earlier this project -- "permission denied for table
   users"), so resolving passport_access.teacher_id into a display name
   needs a SECURITY DEFINER function rather than a client-side join.

   This isn't just get_teacher_name reused, though -- that function only
   returns a name for a teacher who has ALREADY submitted a
   teacher_updates row for this child, which a newly-linked teacher won't
   have done yet. This one is scoped to passport_access + is_active
   instead (the actual "linked to this passport" relationship), and
   returns every linked teacher in one call rather than resolving one id
   at a time.

   role is pulled from institution_staff (falling back to 'class_teacher'
   -- the column's own default -- if no staff row is found, since that's
   the only role that can create a passport_access row today per
   AddChildSheet.tsx). Kept as its own column rather than hardcoded so
   this keeps working once other roles (e.g. clinician) can link too. */

create or replace function public.get_passport_team(p_passport_id uuid)
returns table (
  teacher_id uuid,
  full_name text,
  role text,
  linked_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    pa.teacher_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    coalesce(s.role, 'class_teacher') as role,
    pa.linked_at
  from public.passport_access pa
  join auth.users u on u.id = pa.teacher_id
  left join public.institution_staff s
    on s.user_id = pa.teacher_id and s.institution_id = pa.institution_id
  where pa.passport_id = p_passport_id
    and pa.is_active = true
    and public.owns_passport(p_passport_id);
$$;

grant execute on function public.get_passport_team(uuid) to authenticated;
