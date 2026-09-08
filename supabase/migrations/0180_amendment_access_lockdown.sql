-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- AMENDMENT ACCESS LOCKDOWN. Decided: amendments to a signed-off
-- incident are PRINCIPAL-ONLY (or a countersign-grant holder, via the
-- same can_countersign_incident() helper every other countersign-scoped
-- surface already uses). A teacher who can append to their own account
-- can quietly reframe what happened after the fact; routing every
-- correction through the countersigning authority makes it a reviewed
-- act, not a private one.
--
-- 0078's live INSERT policy on incident_amendments ("Only those with
-- real standing can add an amendment") had THREE branches:
--   1. i.owning_teacher_id = auth.uid()      -- the record's own author
--   2. can_countersign_incident(...)         -- principal / grant holder
--   3. a verified, actively-engaged clinician on a named child
--
-- All three were real standing at the time -- nobody accidentally left
-- a hole open. But (1) is exactly the self-amendment this decision
-- closes: the client (AddAmendmentSheet.tsx) has only ever been wired
-- up from CountersignCard, so nothing in the UI has ever offered an
-- owning teacher this button -- the branch was live in the database
-- the whole time, enforced by nothing but that absence. And (3) was
-- never a considered case either: a clinician appending to a SCHOOL'S
-- legal record of a restraint isn't a relationship this schema was
-- designed around anywhere else -- a clinician's own clinical view of
-- an incident belongs in their own clinical notes (passport_clinical_
-- content, approve_fba_strategies()'s publish path), not as a direct
-- write onto the school's incident record. Both branches are dropped
-- here, not narrowed -- if either is ever wanted back, that's a new
-- decision to make deliberately, not a default to fall back into.
--
-- Only branch 2 survives. Same DROP + CREATE shape 0069 and 0078 both
-- already used for this exact policy -- a policy redefinition, not a
-- function signature, so CREATE OR REPLACE isn't the relevant gotcha
-- here, but "read the live definition" is: this replaces 0078's
-- definition, not 0068's or 0069's.

drop policy if exists "Only those with real standing can add an amendment" on public.incident_amendments;

create policy "Only a countersigning principal can add an amendment"
  on public.incident_amendments for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.incidents i
      where i.id = incident_amendments.incident_id
        and public.can_countersign_incident(auth.uid(), i.institution_id)
    )
  );

-- On-screen surface for item 3. get_incident_export() already carries
-- amendments (0096) and the PDF already renders them (teacher/incidents/
-- [incidentId]/print/page.tsx) -- confirmed working, not the gap. The
-- actual gap: nowhere on the incident's own SCREEN shows them to any
-- role except inside CountersignCard's flow, which self-hides for
-- everyone except a countersigning principal and only ever showed past
-- amendments as a side effect of the pre-countersign confirm text, not
-- as a standing list. A lightweight, standalone RPC rather than reusing
-- get_incident_export() wholesale -- the parent page needs only this
-- one array, not the full export payload's joins across actions,
-- injuries, restrictive practices and body marks.
--
-- plpgsql with an explicit can_view_incident() check + raise, not a
-- plain `language sql` set-returning function filtering it into the
-- WHERE clause -- the latter fails CLOSED but SILENTLY (an unauthorized
-- caller gets an empty array, indistinguishable from "no amendments
-- exist yet"), where its sibling get_incident_export() already raises
-- a real, catchable permission error for the same gate. Matching that
-- shape keeps both RPCs' failure modes distinguishable by any caller
-- (adversarial or otherwise) that actually checks, rather than adding a
-- second, quieter convention for the same authority check.
create or replace function public.get_incident_amendments(p_incident_id uuid)
returns table (
  id uuid,
  reason text,
  content text,
  author_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.can_view_incident(p_incident_id) then
    raise exception 'You do not have permission to view this incident.';
  end if;

  return query
  select
    am.id,
    am.reason,
    am.content,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as author_name,
    am.created_at
  from public.incident_amendments am
  left join auth.users u on u.id = am.author_id
  where am.incident_id = p_incident_id
  order by am.created_at;
end;
$$;

grant execute on function public.get_incident_amendments(uuid) to authenticated;
