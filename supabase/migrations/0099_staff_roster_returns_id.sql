-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- STAFF LIFECYCLE STAGE 1, fix: get_institution_staff_roster() gains its
-- own row id in the return shape. Found live, in the browser: a
-- principal's client code has no way to resolve a colleague's
-- institution_staff.id -- the table's only SELECT policy is
-- auth.uid() = user_id, so a direct query for someone else's row
-- returns zero rows under RLS, not an error. This RPC already exists
-- specifically to see past that; it just didn't return the one column
-- callers actually need to act on a row afterward (deactivate, preview).
-- DROP first: CREATE OR REPLACE cannot change a RETURNS TABLE column
-- shape. Both existing consumers (useInstitutionRoster.ts, the incident
-- detail page) destructure only user_id/full_name/role -- confirmed
-- backward-compatible, neither breaks.

drop function if exists public.get_institution_staff_roster(uuid, boolean);

create function public.get_institution_staff_roster(
  p_institution_id uuid,
  p_include_inactive boolean default false
)
returns table (
  id uuid,
  user_id uuid,
  full_name text,
  role text,
  is_active boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.id,
    s.user_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    s.role,
    (s.deactivated_at is null) as is_active
  from public.institution_staff s
  join auth.users u on u.id = s.user_id
  where s.institution_id = p_institution_id
    and (p_include_inactive or s.deactivated_at is null)
    and exists (
      select 1 from public.institution_staff s2
      where s2.institution_id = p_institution_id
        and s2.user_id = auth.uid()
    )
  order by full_name;
$$;

grant execute on function public.get_institution_staff_roster(uuid, boolean) to authenticated;
