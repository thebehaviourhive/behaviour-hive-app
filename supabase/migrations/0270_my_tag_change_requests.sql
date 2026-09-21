-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 10 Stage 3, item 4 -- "what the requester sees afterwards." Both
-- options decided: inline status on the record (free, no new backend --
-- the requesting screen already reads the episode's own most recent
-- tag_change_requests row directly, since that table's own SELECT
-- policy, 0218, is already institution-wide) AND a "My Requests" tile
-- on the requester's own dashboard. The tile is the one piece that
-- genuinely needs new backend, for the exact reason found in Stage 3's
-- own recon: passports' SELECT policy is owns_passport() -- guardian-
-- only, no institution-staff branch at all (0117) -- so a plain client
-- query joining tag_change_requests -> episodes_of_care -> passports
-- would return child_name as null, silently, for every row. The
-- embedded-join trap this schema already has multiple documented
-- instances of, caught before it shipped this time.
--
-- Mirrors get_pending_tag_change_requests() (0220) column for column,
-- deliberately -- same SECURITY DEFINER shape, same join path, same
-- reason for both. The only real differences: filtered to the CALLER's
-- own requests (requested_by = auth.uid()) rather than one institution's
-- pending queue, across every status rather than pending only (so a
-- decided request's own outcome is visible, not just its existence),
-- and includes status/decided_by/decided_at/decline_reason, which the
-- pending-only queue never needed since every row it returns is, by
-- definition, still pending. No institution_id parameter -- "my own
-- requests" is caller-scoped by construction (requested_by = auth.uid()
-- alone is a safe, self-limiting filter), not institution-scoped, so
-- there's nothing to additionally authorize.

create or replace function public.get_my_tag_change_requests()
returns table (
  request_id uuid,
  episode_id uuid,
  passport_id uuid,
  child_name text,
  requested_at timestamptz,
  base_tags jsonb,
  proposed_tags jsonb,
  reason text,
  status text,
  decided_by uuid,
  decided_at timestamptz,
  decline_reason text
)
language sql
security definer
set search_path = public
stable
as $$
  select r.id as request_id, r.episode_id, e.passport_id, p.child_name,
    r.requested_at, r.base_tags, r.proposed_tags, r.reason,
    r.status, r.decided_by, r.decided_at, r.decline_reason
  from public.tag_change_requests r
  join public.episodes_of_care e on e.id = r.episode_id
  join public.passports p on p.id = e.passport_id
  where r.requested_by = auth.uid()
  order by r.requested_at desc;
$$;

grant execute on function public.get_my_tag_change_requests() to authenticated;
