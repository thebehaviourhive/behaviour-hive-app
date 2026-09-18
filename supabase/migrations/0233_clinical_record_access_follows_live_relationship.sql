-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 7 Stage 2's own discharge-case finding, resolved: Daniel's own
-- decision, not a reversal of PRD 6. "Ownership is permanent" (the rule
-- session_notes and assessments were both built with) means the record
-- is never deleted and the author is never unattributed -- it never
-- had to mean a personal read key that outlives the relationship, and
-- the question "what happens after discharge" was never actually asked
-- when either table's own SELECT policy was written. It is asked now,
-- and answered the way this schema already answers it everywhere else.
--
-- ***********************************************************************
-- THE PRECEDENT, NAMED SO NOBODY LATER READS THIS AS A REGRESSION FROM
-- "OWNERSHIP IS PERMANENT". _close_child_access_for_enrolment_end()
-- (0121/0123): when a child's enrolment at a school ends, a class
-- teacher's own ACCESS closes -- the incident record they wrote stays
-- exactly as it was, their own name stays on it, and they can no longer
-- read it. Their principal still can. A clinic discharge is the same
-- event with different words -- a live relationship ending, not a
-- record being taken away. This migration gives assessments,
-- attachments, and session_notes the identical shape: the practitioner
-- reads while the relationship is live (clinician_access.is_active),
-- the director reads regardless, permanently, on the strength of their
-- own organisational standing rather than a personal relationship to
-- the client at all.
-- ***********************************************************************
--
-- SCOPE, CHECKED BEFORE BUILDING, NOT ASSUMED: does anything else in the
-- clinician track share the author-permanent shape? No. abc_logs'
-- own live clinician SELECT policy (0029) already requires
-- clinician_access.is_active = true. fba_reports, fba_afls_data /
-- afls_assessments (0060), and fba_instrument_requests (0040) all
-- already require it too, on every clinician-facing policy, checked
-- directly against the live migration text, not assumed from the
-- table names. The author-permanent shape was confined to exactly two
-- tables session_notes and assessments (and, by direct inheritance
-- through the storage bridge, attachments) -- three tables affected by
-- this migration, not six.
--
-- THE SECOND FINDING -- THE ROUTING INCONSISTENCY -- IS NOT A DATABASE
-- FIX. "The Clinical File page refuses a discharged client, the
-- assessment's own direct URL does not" was never an RLS bug -- both
-- routes were already correctly enforcing WHATEVER their own underlying
-- policy said; the Clinical File page's own gate has always checked
-- live caseload standing (a different, pre-existing mechanism, unrelated
-- to PRD 7). Once this migration makes assessments'/session_notes' own
-- RLS agree with that same live-standing rule, the two routes converge
-- on the same answer FOR THE SAME REASON they used to disagree -- no
-- client-side gate needs touching, and Stage 2's own verification
-- (already run against the old policy) is re-run against this one to
-- prove the convergence directly, both routes, same session, same
-- discharged client.
-- ===========================================================================

-- ===========================================================================
-- 1. The shared read-authorization helpers. One generalized director-
-- read helper reused by session_notes AND assessments (was a session_
-- notes-only helper, _clinic_director_can_read_clinician_session_notes,
-- 0229 -- renamed to what it actually is now that a second table needs
-- the identical check, rather than hand-rolling a second copy: this
-- schema's own "nine independent lineages check institution_staff
-- membership" mistake, avoided deliberately here). One new helper for
-- "does the caller currently have live clinician_access to this
-- passport" -- the practitioner's own half of the rule, reused by
-- session_notes' author branch and assessments' own.
-- ===========================================================================

create or replace function public._clinic_director_can_read_clinician_material(p_author_clinician_id uuid)
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

grant execute on function public._clinic_director_can_read_clinician_material(uuid) to authenticated;

create or replace function public._caller_has_live_clinician_access(p_passport_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.clinician_access ca
    where ca.passport_id = p_passport_id
      and ca.clinician_id = auth.uid()
      and ca.is_active = true
  );
$$;

grant execute on function public._caller_has_live_clinician_access(uuid) to authenticated;

-- ===========================================================================
-- 2. session_notes -- the author branch now requires live access too;
-- the director branch is unchanged in behaviour, only rewired to the
-- newly-generalized helper above. ALTER POLICY, matching 0229's own
-- precedent for this exact policy, not a drop+recreate.
-- ===========================================================================

alter policy "A practitioner reads their own notes; their clinic's director reads them too"
  on public.session_notes
  using (
    (clinician_id = auth.uid() and public._caller_has_live_clinician_access(passport_id))
    or public._clinic_director_can_read_clinician_material(clinician_id)
  );

-- The old, session_notes-specific helper is now dead -- nothing else
-- ever referenced it (checked directly before dropping, not assumed).
drop function if exists public._clinic_director_can_read_clinician_session_notes(uuid);

-- ===========================================================================
-- 3. assessments -- gains its first director-read branch (deliberately
-- deferred in Stage 1: "a real, separate decision for a future stage,
-- not an oversight in this one" -- this is that stage). The
-- practitioner's own branch now requires live access, matching
-- session_notes exactly. _assessment_is_readable_by_caller() is the
-- single composed predicate both this policy AND the attachments
-- bridge (below) call -- never duplicated between the two.
-- ===========================================================================

create or replace function public._assessment_is_readable_by_caller(p_assessment_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.assessments a
    where a.id = p_assessment_id
      and (
        (a.clinician_id = auth.uid() and public._caller_has_live_clinician_access(a.passport_id))
        or public._clinic_director_can_read_clinician_material(a.clinician_id)
      )
  );
$$;

grant execute on function public._assessment_is_readable_by_caller(uuid) to authenticated;

alter policy "Clinicians read their own assessments"
  on public.assessments
  using (public._assessment_is_readable_by_caller(id));

-- ===========================================================================
-- 4. The attachments bridge -- no policy on attachments or
-- storage.objects needs to change at all. _caller_owns_artefact()'s own
-- 'assessment' arm is repointed at the same composed predicate
-- assessments' own table now uses -- every caller of
-- _caller_owns_artefact() (attachments' own SELECT policy,
-- storage.objects' own SELECT policy via
-- _attachment_storage_path_is_readable()) inherits the new rule for
-- free, automatically, the same way the whole point of the bridge was
-- that it never re-derives authorization on its own. Write-side
-- (_caller_can_modify_artefact_attachments, upload/delete) is
-- UNCHANGED, deliberately -- Daniel's own decision was scoped to READ;
-- extending the live-access gate to writes is a real, separate
-- question nobody has asked yet, recorded here so it is not assumed
-- settled by this migration.
-- ===========================================================================

create or replace function public._caller_owns_artefact(p_artefact_type text, p_artefact_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case p_artefact_type
    when 'assessment' then public._assessment_is_readable_by_caller(p_artefact_id)
    else false
  end;
$$;
