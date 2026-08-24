/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SCHOOL INCIDENT LOG -- Phase 3 groundwork: two roster RPCs the
   15-second stamp UI needs, neither reachable through existing RLS.

   1. get_institution_child_roster() -- decision 5 requires stage-one
      child selection to draw from the INSTITUTION roster, not the
      creator's own passport_access, and decision 1 requires no
      approved_by_parent gate. But passports' own SELECT policies are
      all scoped to passport_access/clinician_access/ownership -- none
      of them cover "any child linked to this institution, full stop".
      passport_institution_links itself already has a "Teachers can view
      links for their institution" policy with exactly the right shape
      (any institution_staff member, no approval gate) -- this function
      joins through it to get names, the one piece that policy alone
      can't supply.

   2. get_institution_staff_roster() -- the stamp's "staff present"
      picker needs to list colleagues by name, but institution_staff's
      only SELECT policy is "Users can view their own staff link" --
      nobody can see a colleague's row at all today. This function opens
      that up, but only to fellow staff at the SAME institution, and
      only for the columns needed to name someone (id, name, role) --
      nothing else about the row.

   Both restricted to callers who are themselves institution_staff at
   the institution being queried -- same shape as every other roster-ish
   RPC in this module. */

create or replace function public.get_institution_child_roster(p_institution_id uuid)
returns table (
  passport_id uuid,
  child_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select p.id as passport_id, p.child_name
  from public.passports p
  join public.passport_institution_links pil on pil.passport_id = p.id
  where pil.institution_id = p_institution_id
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
    )
  order by p.child_name;
$$;

grant execute on function public.get_institution_child_roster(uuid) to authenticated;


create or replace function public.get_institution_staff_roster(p_institution_id uuid)
returns table (
  user_id uuid,
  full_name text,
  role text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.user_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    s.role
  from public.institution_staff s
  join auth.users u on u.id = s.user_id
  where s.institution_id = p_institution_id
    and exists (
      select 1 from public.institution_staff s2
      where s2.institution_id = p_institution_id
        and s2.user_id = auth.uid()
    )
  order by full_name;
$$;

grant execute on function public.get_institution_staff_roster(uuid) to authenticated;
