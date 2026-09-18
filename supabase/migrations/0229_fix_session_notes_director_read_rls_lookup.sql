-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- A REAL BUG, FOUND LIVE, IN 0228's OWN NEW POLICY -- the exact shape
-- CLAUDE.md already has a dedicated entry for, made again here despite
-- that: "A POLICY THAT LOOKS UP SOMEONE ELSE RUNS UNDER THE CALLER'S OWN
-- RLS." 0228's own director-read branch does a raw EXISTS against
-- institution_staff, joining `author_staff.user_id = session_notes.
-- clinician_id` to find the NOTE'S AUTHOR's own row -- someone other
-- than the calling director. institution_staff's own SELECT policy has
-- been self-only ("Users can view their own staff link", auth.uid() =
-- user_id) since migration 0009. A subquery inside another table's RLS
-- policy runs under the CALLING session's own permissions, not elevated
-- ones -- so when the director's session evaluates this policy, the
-- author_staff join can only ever see the DIRECTOR's own row (since
-- that's the only institution_staff row the director's own session is
-- permitted to select), never the author's. Filtered to author_staff.
-- role = 'clinician', the director's own row (role = 'principal') never
-- matches either, so the whole EXISTS clause was always false for every
-- caller except the note's own author -- silently, no error, exactly
-- the failure mode CLAUDE.md's own entry describes.
--
-- Found live, the way this schema's own equivalent bug (clinical_lead_
-- scope, 0207/0217) was found: a real director's real session reading a
-- real colleague's note, refused with a plain empty result, not an
-- error -- confirmed via the verification fixture's own "director reads
-- P1's note" and "director still reads P2's note after deactivation"
-- assertions, both failing for the identical reason despite testing two
-- different things.
--
-- THE FIX: the exact pattern this schema already established for the
-- identical mistake -- a SECURITY DEFINER helper, so the author lookup
-- runs with the function owner's own privileges rather than the
-- caller's, bypassing institution_staff's own restrictive SELECT policy
-- deliberately and only for this one, narrow, already-authorization-
-- checked purpose. Single EXISTS, not a two-step "resolve then check" --
-- an author can hold more than one institution_staff row over time (a
-- clinician who left one clinic and joined another), and this correctly
-- matches on ANY of them, not just one arbitrarily picked row.

create or replace function public._clinic_director_can_read_clinician_session_notes(
  p_author_clinician_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.institution_staff author_staff
    join public.institution_staff director on director.institution_id = author_staff.institution_id
    join public.institutions inst on inst.id = director.institution_id
    where author_staff.user_id = p_author_clinician_id
      and author_staff.role = 'clinician'
      and director.user_id = auth.uid()
      and director.role = 'principal'
      and inst.status = 'verified'
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
  );
$$;

alter policy "A practitioner reads their own notes; their clinic's director reads them too"
  on public.session_notes
  using (
    clinician_id = auth.uid()
    or public._clinic_director_can_read_clinician_session_notes(clinician_id)
  );
