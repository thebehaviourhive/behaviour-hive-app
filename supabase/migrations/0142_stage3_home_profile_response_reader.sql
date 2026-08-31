-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 3, Stage 3, part 2 -- one RPC the client build surfaced: displaying
-- a home profile response (to a guardian viewing a co-guardian's answer,
-- or to staff/a clinician viewing any of them) needs the recipient's
-- name attached, and the RLS policies from 0141 -- correct for gating
-- row visibility -- can't join auth.users the way a plain client select
-- can't either. Same reasoning as get_institution_home_profiles_
-- outstanding()'s own name resolution, just passport-scoped instead of
-- institution-scoped, and open to every reader 0141 already lets see
-- this table: guardians (any, not just the recipient -- owns_passport()),
-- staff with child access, and verified linked clinicians.

create or replace function public.get_passport_home_profile_responses(p_passport_id uuid)
returns table (
  id uuid,
  recipient_id uuid,
  recipient_name text,
  status text,
  what_works_at_home text,
  sleep text,
  food text,
  sensory_needs_home text,
  history_before_this_school text,
  previous_settings_feedback text,
  created_at timestamptz,
  completed_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.id,
    r.recipient_id,
    coalesce(ru.raw_user_meta_data ->> 'full_name', ru.raw_app_meta_data ->> 'full_name') as recipient_name,
    r.status,
    r.what_works_at_home,
    r.sleep,
    r.food,
    r.sensory_needs_home,
    r.history_before_this_school,
    r.previous_settings_feedback,
    r.created_at,
    r.completed_at
  from public.passport_home_profile_requests r
  join auth.users ru on ru.id = r.recipient_id
  where r.passport_id = p_passport_id
    and (
      public.owns_passport(p_passport_id)
      or public.has_child_access(auth.uid(), p_passport_id)
      or (
        exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = p_passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
        and public.is_verified_clinician(auth.uid())
      )
    )
  order by r.created_at asc;
$$;

grant execute on function public.get_passport_home_profile_responses(uuid) to authenticated;
