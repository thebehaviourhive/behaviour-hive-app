-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 1, Stage 3, Step 3: a genuinely new supply teacher isn't yet
-- institution_staff at all -- there is nothing to pick them FROM.
-- grant_temporary_access() already takes a p_user_id (Step 0's own
-- "account must already exist, no invite-by-email" decision), but
-- nothing in this codebase resolves an email address to a user_id --
-- grepped, confirmed absent, not assumed. Without this, "choose the
-- person" (Daniel's own Step 3 wording) has no way to work for the one
-- case that actually needs it -- an existing SNA colleague is already
-- pickable from get_institution_staff_roster(), matching Stage 2's own
-- AssignSnaSheet precedent exactly; only the brand-new-supply-teacher
-- case is missing a lookup path.
--
-- Deliberately narrow and principal-only, not a general "search staff
-- by email" feature: exact match only, returns just (user_id,
-- full_name) -- enough to show "Grant to Jane Smith?" as a confirm
-- step before the real grant, nothing else about that account is
-- exposed. A confirm step matters here specifically because granting
-- to the wrong person from a typo'd email, with no lookup/confirm step
-- at all, is a real risk a bare email-text-field on grant_temporary_
-- access() itself would not catch.

create or replace function public.lookup_user_by_email_for_temporary_grant(
  p_institution_id uuid,
  p_email text
)
returns table (
  user_id uuid,
  full_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) then
    raise exception 'Only an active principal at this institution can look up a supply teacher by email.';
  end if;

  return query
  select u.id, coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name')
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;
end;
$$;

grant execute on function public.lookup_user_by_email_for_temporary_grant(uuid, text) to authenticated;
