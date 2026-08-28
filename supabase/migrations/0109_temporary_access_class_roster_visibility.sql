-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 1, Stage 3, Step 3: the /sna/passports client-behaviour fix
-- itself named a real gap, and the "WHEN ACCESS OR AUTHORITY IS
-- GRANTED, TEST THE DESTINATION" query-shape checks (CHECK BB, BB-4)
-- caught a second one behind it -- src/hooks/useSnaChildren.ts already
-- discovers WHICH class a covering SNA has an active temporary grant
-- for (temporary_access's own SELECT policy allows that), but it then
-- has no way to read WHO is in that class: class_children's SELECT
-- policy (0104) is deliberately narrower than has_sna_access() itself
-- -- "a class's own current teachers, plus the institution's principal
-- ... general institution-wide roster visibility ... is Stage 4's
-- (roster tier) to decide, not this one's default." A temporary-access
-- holder is neither. The client query returns zero rows, RLS-silent,
-- exactly the shape CLAUDE.md's own embedded-join gotcha describes --
-- and BB-4 proved it live rather than this being spotted by reading
-- the policy.
--
-- The fix is NOT to widen class_children's own RLS -- that would be
-- exactly the general roster-tier relaxation 0104's comment reserved
-- for Stage 4, and would hand a covering SNA visibility into every
-- child's class_children ROW METADATA (started_at, position, etc.),
-- not just today's roster. Instead, one narrow, purpose-built
-- SECURITY DEFINER RPC, matching this codebase's own established
-- pattern for "the relationship is deliberately broader than the
-- joined table's own RLS" (CLAUDE.md: get_institution_child_roster()
-- for the identical shape of problem in Stage 1). Its own WHERE clause
-- re-derives has_active_temporary_grant()'s exact live-window check,
-- scoped to one specific class -- not a trust of what the client
-- already believes it's covering, an independent, live re-check.

create or replace function public.get_temporary_access_covered_children(p_class_id uuid)
returns table (
  passport_id uuid,
  child_name text,
  diagnoses text[],
  diagnosis_other text
)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.child_name, p.diagnoses, p.diagnosis_other
  from public.class_children cc
  join public.passports p on p.id = cc.passport_id
  join public.temporary_access ta on ta.class_id = cc.class_id
  join public.institutions inst on inst.id = ta.institution_id
  where cc.class_id = p_class_id
    and cc.ended_at is null
    and ta.class_id = p_class_id
    and ta.granted_to = auth.uid()
    and ta.revoked_at is null
    and ta.granted_for_date = (now() at time zone public.app_local_timezone())::date
    and (now() at time zone public.app_local_timezone())::time >= '07:30'::time
    and (now() at time zone public.app_local_timezone())::time < inst.temporary_access_cutoff_time;
$$;

grant execute on function public.get_temporary_access_covered_children(uuid) to authenticated;

-- No caller-role check beyond the WHERE clause itself -- unlike most
-- RPCs in this codebase, there's nothing to authorize UP FRONT and
-- reject with a raised exception; the query's own join conditions ARE
-- the authorization; a caller with no live grant for this class simply
-- gets zero rows back, the same "empty, not an error" contract
-- has_sna_access() and the other live-window checks already use.
