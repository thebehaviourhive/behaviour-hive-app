-- PRD 8 Stage 2 -- two findings in one migration, both caught building
-- the verification fixture, neither of them new code from this session
-- alone.
--
-- FINDING 1: _clinic_director_can_read_clinician_material() -- a THIRD
-- instance of the untensed-join bug 0249 fixed, and this one predates
-- PRD 8 entirely. This function (0233, PRD 7 Stage 2) gates session_
-- notes' AND assessments' own BASE TABLE RLS policies directly -- not
-- an RPC, the actual raw-client-query gate -- and has had the identical
-- flaw as the other five: no bound on the author's own tenure, just
-- "does this author have ANY institution_staff row, ever, at my
-- institution". Live in production since 0233 shipped. Found only
-- because this stage's own fixture set clinicianA's assessment up
-- expecting the director's raw select to be refused, and it wasn't.
--
-- Fixed the same way as 0249: the function gains a second parameter
-- (the artefact's own created_at) and delegates to _clinician_
-- authored_at_institution(). Two call sites need updating in the same
-- migration -- session_notes' own policy, and _assessment_is_readable_
-- by_caller() (which assessments' own policy calls) -- both get the
-- artefact's created_at threaded through. Signature change on a
-- function called by two live base-table policies: create the new
-- signatures first, repoint both policies to them, THEN drop the old
-- signatures -- the exact ordering 0234's own header already documents
-- for this identical class of dependency trap.
--
-- FINDING 2: _caller_owns_artefact()'s own 'assessment' arm silently
-- regressed in 0244 (this session's own earlier Silo 2 placeholders
-- migration, not some ancient bug). 0244's header says the attachments
-- bridge was "inherited wholesale" -- it wasn't: 0244's own text for
-- the 'assessment' arm is byte-for-byte 0232's ORIGINAL, pre-0233
-- version (a bare `a.clinician_id = auth.uid()`), silently dropping
-- BOTH the live-relationship requirement (_caller_has_live_clinician_
-- access) 0233 added AND the director-read branch that came with it --
-- reopening, for assessment ATTACHMENTS specifically, the exact
-- "ownership is permanent" bug 0233 closed for the assessments row
-- itself. assessments' own base table policy was never affected -- it
-- correctly calls _assessment_is_readable_by_caller() throughout --
-- only the separate attachments-bridge helper drifted.
--
-- This supersedes 0250's own attempt at the 'assessment'/'clinical_plan'
-- arms -- 0250 added a director branch onto the regressed (author-only)
-- base without restoring the live-relationship gate 0244 had dropped,
-- and without the time-scoped fix this migration also makes to the
-- director check itself. Whether 0250 ran or not, this migration's own
-- CREATE OR REPLACE leaves _caller_owns_artefact() in the same, fully
-- correct final state either way.

-- =====================================================================
-- Step 1: new signatures, created alongside the old ones (safe --
-- different arg count, no conflict).
-- =====================================================================

create or replace function public._clinic_director_can_read_clinician_material(
  p_author_clinician_id uuid,
  p_at timestamptz
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.institution_staff director
    join public.institutions inst on inst.id = director.institution_id
    where director.user_id = auth.uid()
      and director.role = 'principal'
      and inst.status = 'verified'
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
      and public._clinician_authored_at_institution(p_author_clinician_id, director.institution_id, p_at)
  );
$$;

grant execute on function public._clinic_director_can_read_clinician_material(uuid, timestamptz) to authenticated;

create or replace function public._assessment_is_readable_by_caller(
  p_clinician_id uuid,
  p_passport_id uuid,
  p_created_at timestamptz
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    (p_clinician_id = auth.uid() and public._caller_has_live_clinician_access(p_passport_id))
    or public._clinic_director_can_read_clinician_material(p_clinician_id, p_created_at);
$$;

grant execute on function public._assessment_is_readable_by_caller(uuid, uuid, timestamptz) to authenticated;


-- =====================================================================
-- Step 2: repoint both live policies to the new signatures.
-- =====================================================================

alter policy "A practitioner reads their own notes; their clinic's director reads them too"
  on public.session_notes
  using (
    (clinician_id = auth.uid() and public._caller_has_live_clinician_access(passport_id))
    or public._clinic_director_can_read_clinician_material(clinician_id, created_at)
  );

alter policy "Clinicians read their own assessments"
  on public.assessments
  using (
    public._assessment_is_readable_by_caller(clinician_id, passport_id, created_at)
    or public._clinical_colleague_domain_match(clinician_id, passport_id, domain_tags)
  );


-- =====================================================================
-- Step 3: the old signatures are now unreferenced -- safe to drop.
-- =====================================================================

drop function if exists public._clinic_director_can_read_clinician_material(uuid);
drop function if exists public._assessment_is_readable_by_caller(uuid, uuid);


-- =====================================================================
-- Step 4: _caller_owns_artefact() -- the regression fix. 'assessment'
-- now delegates to the same composed predicate the base table itself
-- uses (never re-derived a second way); 'clinical_plan' gains the
-- live-relationship gate it was always missing (clinical_plans' own
-- base table policy has always had it -- only the attachments-bridge
-- arm didn't) plus the same time-scoped director branch.
-- =====================================================================

create or replace function public._caller_owns_artefact(p_artefact_type text, p_artefact_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case p_artefact_type
    when 'assessment' then exists (
      select 1 from public.assessments a
      where a.id = p_artefact_id
        and public._assessment_is_readable_by_caller(a.clinician_id, a.passport_id, a.created_at)
    )
    when 'clinical_plan' then exists (
      select 1 from public.clinical_plans cp
      where cp.id = p_artefact_id
        and (
          (cp.clinician_id = auth.uid() and public._caller_has_live_clinician_access(cp.passport_id))
          or public._clinic_director_can_read_clinician_material(cp.clinician_id, cp.created_at)
        )
    )
    else false
  end;
$$;
