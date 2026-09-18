-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- A REAL BUG IN 0233, FOUND BY THE VERIFICATION FIXTURE ON ITS FIRST
-- RUN, BEFORE ANY REAL CLINICIAN HIT IT. 0233's own
-- _assessment_is_readable_by_caller(p_assessment_id uuid) RE-QUERIES
-- public.assessments BY ID from inside a SECURITY DEFINER function
-- called as part of the SELECT-policy check on the RETURNING clause of
-- an INSERT INTO assessments statement -- a self-referential query
-- against the exact table currently being written to, within the same
-- statement. The row being inserted is not yet visible to that
-- re-query's own snapshot, so `insert(...).select("id").single()` --
-- the REAL production call NewAssessmentSheet.tsx makes for every new
-- assessment -- failed outright with "new row violates row-level
-- security policy for table \"assessments\"", even though the
-- identical predicate, called a moment later as a separate statement,
-- correctly returned true. Confirmed directly: the bare insert (no
-- chained select) succeeded every time; the chained
-- insert-then-select failed every time; a follow-up RPC call against
-- the freshly-inserted row returned true. This would have broken
-- every new assessment creation, for every clinician, the moment 0233
-- was run -- caught here, before any real exposure, by the
-- verification fixture built to prove 0233 itself, not by review.
--
-- THE ACTUAL SHAPE OF THE MISTAKE: session_notes' own SELECT policy
-- (0228/0229/0233) never had this problem, because it is a flat
-- expression operating directly on the row's own columns
-- (clinician_id, passport_id) -- no subquery against session_notes
-- itself. assessments' own policy, wrapped in a single helper function
-- taking only the assessment's id, had to re-derive clinician_id/
-- passport_id by querying assessments again to get them -- the one
-- difference that introduced the self-reference. The fix: make
-- _assessment_is_readable_by_caller a pure predicate over the row's
-- own columns, passed in directly, exactly matching session_notes'
-- own working shape -- no table lookup inside it at all.
--
-- The attachments bridge's own use of this predicate
-- (_caller_owns_artefact's 'assessment' arm) is NOT self-referential --
-- it is evaluated from storage.objects'/attachments' own policies,
-- never from within an INSERT INTO assessments statement, so its own
-- lookup of assessments by id (to resolve clinician_id/passport_id
-- before delegating) is safe and unchanged in shape, just repointed at
-- the new two-argument signature.

create or replace function public._assessment_is_readable_by_caller(p_clinician_id uuid, p_passport_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    (p_clinician_id = auth.uid() and public._caller_has_live_clinician_access(p_passport_id))
    or public._clinic_director_can_read_clinician_material(p_clinician_id);
$$;

grant execute on function public._assessment_is_readable_by_caller(uuid, uuid) to authenticated;

-- The old, single-argument, self-referential version is now shadowed
-- by nothing calling it -- drop it explicitly rather than leave two
-- overloads of the same name sitting around (the exact overload-
-- ambiguity trap this schema's own send_message() gotcha already
-- documents, avoided here by dropping the old signature outright
-- rather than trusting CREATE OR REPLACE to collapse a changed
-- parameter list onto a shorter one -- it never does).
drop function if exists public._assessment_is_readable_by_caller(uuid);

alter policy "Clinicians read their own assessments"
  on public.assessments
  using (public._assessment_is_readable_by_caller(clinician_id, passport_id));

-- The bridge: resolves the assessment's own clinician_id/passport_id
-- via a cross-table lookup (assessments, from attachments' or
-- storage.objects' own policy evaluation -- never self-referential),
-- then delegates to the same two-argument predicate above.
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
        and public._assessment_is_readable_by_caller(a.clinician_id, a.passport_id)
    )
    else false
  end;
$$;
