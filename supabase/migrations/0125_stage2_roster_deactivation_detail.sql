-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 2, Stage 2 -- get_institution_staff_roster() widened with
-- deactivated_at and deactivation_reason. The design's own requirement:
-- "Deactivated staff are never hidden. Their name stays on everything
-- they wrote. DEACTIVATED [DATE] in Golden Brown Quicksand." The
-- roster's own live return shape (0120) has no deactivation date or
-- reason at all -- only the derived is_active/is_pending booleans.
--
-- Checked before writing this, not assumed: institution_staff's own
-- SELECT RLS policy (0009, still live) is "Users can view their own
-- staff link" -- auth.uid() = user_id, self only. A principal reading
-- another staff member's row directly gets silently filtered to zero
-- rows, not an error -- there is no raw-table way to get this data for
-- anyone but yourself. The roster RPC (SECURITY DEFINER, the same
-- reason it exists at all) is the only correct path.
--
-- CREATE OR REPLACE cannot change a RETURNS TABLE column list -- DROP +
-- CREATE, matching 0122's own precedent for widening
-- get_institution_child_roster() the same way. Everything else below is
-- reproduced verbatim from 0120's own live body (the caller-standing
-- check, the row-inclusion logic, the ordering) -- only the two new
-- columns and their one additional select-list entry are new.

drop function if exists public.get_institution_staff_roster(uuid, boolean, boolean);

create function public.get_institution_staff_roster(
  p_institution_id uuid,
  p_include_inactive boolean default false,
  p_include_pending boolean default false
)
returns table (
  id uuid,
  user_id uuid,
  full_name text,
  role text,
  is_active boolean,
  is_pending boolean,
  deactivated_at timestamptz,
  deactivation_reason text
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
    (
      s.approved_at is not null and s.deactivated_at is null
      and (
        s.approval_source is distinct from 'temporary_grant'
        or public.has_active_temporary_grant(s.user_id, s.institution_id)
      )
    ) as is_active,
    (s.approved_at is null and s.deactivated_at is null) as is_pending,
    s.deactivated_at,
    s.deactivation_reason
  from public.institution_staff s
  join auth.users u on u.id = s.user_id
  where s.institution_id = p_institution_id
    and s.rejected_at is null
    and (
      (s.approved_at is not null and (p_include_inactive or s.deactivated_at is null))
      or (p_include_pending and s.approved_at is null and s.deactivated_at is null)
    )
    and exists (
      select 1 from public.institution_staff s2
      where s2.institution_id = p_institution_id
        and s2.user_id = auth.uid()
        and s2.approved_at is not null
        and s2.deactivated_at is null
    )
  order by full_name;
$$;

grant execute on function public.get_institution_staff_roster(uuid, boolean, boolean) to authenticated;
