/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   Bug fix: the parent dashboard's "Your Team" card (YourTeamCard.tsx) calls
   get_passport_team(), which was written in migration 0023 -- before the
   Clinician Track existed -- and only ever queried passport_access (the
   teacher-linking table). It has no knowledge of clinician_access (added in
   migration 0026), so a clinician connected via the clinician-code flow
   shows up correctly in the parent's Manage Access "Clinical Team" section
   (get_passport_clinicians(), also from 0026) but never appears on the
   dashboard's "Your Team" card.

   Fix is a pure additive UNION ALL: the existing teacher branch is
   untouched, and a second branch pulls active clinician_access rows,
   returning them in the same (teacher_id, full_name, role, linked_at) shape
   so the client needs no changes -- YourTeamCard.tsx already has
   ROLE_STYLE/ROLE_LABEL entries and sort handling for role = 'clinician'
   from the original Clinician Track build, they just never had a row to
   render. is_active = true on the clinician branch means a revoked
   clinician stops appearing, same as a deactivated teacher link. */

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
    and public.owns_passport(p_passport_id)

  union all

  select
    ca.clinician_id as teacher_id,
    coalesce(c.full_name, u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    'clinician' as role,
    ca.linked_at
  from public.clinician_access ca
  join auth.users u on u.id = ca.clinician_id
  left join public.clinicians c on c.user_id = ca.clinician_id
  where ca.passport_id = p_passport_id
    and ca.is_active = true
    and public.owns_passport(p_passport_id);
$$;

grant execute on function public.get_passport_team(uuid) to authenticated;
