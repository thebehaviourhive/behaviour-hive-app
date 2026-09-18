-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 7 -- the parent/school-facing response sheet completion flow.
-- Finishes what Stage 1 deliberately left half-built: a clinician can
-- record a response sheet today but cannot send one, which is the
-- entire point of the pattern -- and the "Sent to parent"/"Sent to
-- school staff" pills have been lying since Stage 1 shipped, since
-- nothing has ever actually been sent.
--
-- THE DECISION: one assessment = one administration = one respondent.
-- A clinician wanting a MAS from a parent AND a teacher creates TWO
-- assessment rows -- two genuine administrations, comparable the same
-- way two WISC-V records are. Column, not a table: assigned_
-- respondent_id/assigned_at/last_reminded_at on assessments itself.
-- Status (sent/in_progress/completed) is derived, never stored --
-- from whether assigned_respondent_id is set, whether responses has
-- any keys, and completed_at.
--
-- ***************************************************************************
-- THE LEAK, AND WHY THE RESPONDENT NEVER TOUCHES THE assessments TABLE
-- DIRECTLY AT ALL -- NOT THROUGH RLS, EITHER DIRECTION.
--
-- Daniel's own instruction: a respondent granted raw SELECT would also
-- see the clinician's own interpretation, scores, and everything else
-- on the row -- silently wrong, a parent reading a clinician's
-- interpretation of an assessment they're still contributing to. Fixed
-- by never granting raw SELECT at all: two SECURITY DEFINER RPCs
-- (`get_assessment_to_complete`, `submit_assessment_response`) are the
-- respondent's ENTIRE interaction surface, each returning/touching
-- only what's actually needed.
--
-- A second, equivalent leak surfaced while designing the WRITE side,
-- not asked for directly but the same shape: Postgres column-level
-- GRANTs are per ROLE, not per RLS POLICY -- every caller in this app
-- authenticates as the same `authenticated` role regardless of "kind."
-- A raw RLS UPDATE policy scoped to `assigned_respondent_id =
-- auth.uid()`, even with a column grant narrowed to `responses` only,
-- would not actually stop the AUTHOR (admitted via their own, separate
-- policy, but sharing the identical column-privilege surface) from
-- writing responses/subscale_totals/interpretation with equal freedom
-- either way -- column grants can't be conditioned on which policy
-- admitted the row. The fix is the same one already used everywhere
-- else in this schema a column needs to be writable by one kind of
-- caller and not another sharing the same DB role: a SECURITY DEFINER
-- RPC, never a raw RLS policy plus a column grant. `assessments`' own
-- RLS is UNCHANGED by this migration -- no new SELECT/UPDATE policy at
-- all. Every respondent-facing read and write is an RPC.
-- ***************************************************************************
-- ===========================================================================

-- ===========================================================================
-- 1. New columns. instruction mirrors fba_instrument_requests' own
-- field (context for the respondent, clinician-authored, freely
-- editable like any other clinician field -- no restriction needed on
-- it). assigned_respondent_id/assigned_at/last_reminded_at are
-- deliberately NOT freely editable -- see the column-grant revoke
-- below.
-- ===========================================================================

alter table public.assessments
  add column assigned_respondent_id uuid references auth.users (id),
  add column assigned_at timestamptz,
  add column last_reminded_at timestamptz,
  add column instruction text;

-- Only the RPCs below (SECURITY DEFINER, bypasses column grants
-- entirely) may ever set these three columns. An ordinary client
-- update -- including the assessment's own author, via their existing
-- "Clinicians can edit their own uncompleted assessments" policy --
-- can no longer touch them directly, regardless of what that policy's
-- own USING/WITH CHECK permits. This is what makes assign_assessment_
-- respondent()'s own candidate-legitimacy check a real, un-bypassable
-- gate rather than a UI-only suggestion.
revoke update (assigned_respondent_id, assigned_at, last_reminded_at)
  on public.assessments from authenticated;

-- ===========================================================================
-- 2. Candidate resolution -- get_assessment_respondent_candidates().
-- Direct structural mirror of get_fba_recipient_candidates() (live as
-- of 0188), adapted from fba_id to assessment_id/passport_id.
--
-- THE CROSS-ORGANISATION QUESTION, CONFIRMED BY TRACING THE JOIN, NOT
-- ASSUMED: this resolves correctly whether the clinician is at a
-- clinic and the respondent is at an entirely separate school, and it
-- is not a coincidence -- it is structural. The institution_staff arm
-- joins via passport_institution_links, which links the CHILD's own
-- institutions (plural -- a child can be linked to both a school via
-- enrolments and a clinic via episodes_of_care/passport_institution_
-- links simultaneously, per PRD 5's own established multi-organisation
-- model), never the CALLING CLINICIAN's own institution -- the query
-- never once joins through the clinician's own institution_staff row
-- to find candidates, only through the child's. has_child_access()
-- itself is a purely school-side primitive (has_class_teacher_access()
-- OR has_sna_access(), confirmed in PRD 7 Stage 3's own recon --
-- neither branch ever touches clinician_access), so a clinic's own
-- OTHER clinicians can never appear as candidates through this arm
-- even if the same passport also happens to be clinic-linked -- they
-- simply never satisfy has_child_access() at all, structurally.
-- ===========================================================================

create or replace function public.get_assessment_respondent_candidates(p_assessment_id uuid)
returns table (recipient_id uuid, full_name text, role text)
language sql
security definer
set search_path = public
stable
as $$
  with authorized_assessment as (
    select a.id, a.passport_id
    from public.assessments a
    join public.clinician_access ca on ca.passport_id = a.passport_id
    where a.id = p_assessment_id
      and a.clinician_id = auth.uid()
      and ca.clinician_id = auth.uid()
      and ca.is_active = true
      and public.is_verified_clinician(auth.uid())
  )
  select g.user_id as recipient_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    'parent' as role
  from authorized_assessment aa
  join public.passport_guardians g on g.passport_id = aa.passport_id
  join auth.users u on u.id = g.user_id
  union all
  select s.user_id as recipient_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    s.role as role
  from authorized_assessment aa
  join public.passport_institution_links pil on pil.passport_id = aa.passport_id
  join public.institution_staff s on s.institution_id = pil.institution_id
  join auth.users u on u.id = s.user_id
  where s.deactivated_at is null and s.approved_at is not null
    and public.has_child_access(s.user_id, aa.passport_id);
$$;

grant execute on function public.get_assessment_respondent_candidates(uuid) to authenticated;

-- ===========================================================================
-- 3. Assignment -- the clinician's own act of delegating. Validates
-- the candidate server-side, at write time, not just in the UI --
-- fba_instrument_requests' own INSERT policy is only safe today
-- because nothing in the UI ever offers a bad recipient_id; a raw
-- insert with an arbitrary one would succeed. This RPC closes that
-- gap for the new mechanism rather than inheriting it.
--
-- respondent_type is DERIVED here, never left as an independently
-- clinician-chosen label that could drift from reality -- resolving
-- who the assigned person actually is (a guardian vs. institution
-- staff), not asked of the clinician a second time.
--
-- Assigning always resets responses to '{}' -- deliberately, so a
-- reassignment (to the same person again, or to someone new) never
-- silently carries a partial answer forward under a changed
-- attribution. If the clinician wants to keep a respondent's partial
-- progress, they simply don't reassign.
-- ===========================================================================

create or replace function public.assign_assessment_respondent(
  p_assessment_id uuid,
  p_respondent_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assessment record;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_assessment from public.assessments where id = p_assessment_id;
  if v_assessment.id is null then
    raise exception 'Assessment not found.';
  end if;
  if v_assessment.clinician_id is distinct from auth.uid() then
    raise exception 'Only this assessment''s own author may assign a respondent.';
  end if;
  if v_assessment.completed_at is not null then
    raise exception 'This assessment has already been completed.';
  end if;
  if v_assessment.record_type <> 'response_sheet' then
    raise exception 'Only a response sheet can be assigned to a respondent.';
  end if;

  select c.role into v_role
  from public.get_assessment_respondent_candidates(p_assessment_id) c
  where c.recipient_id = p_respondent_id;

  if v_role is null then
    raise exception 'That person is not a valid respondent for this child.';
  end if;

  update public.assessments
  set assigned_respondent_id = p_respondent_id,
      assigned_at = now(),
      last_reminded_at = null,
      responses = '{}'::jsonb,
      respondent_type = case when v_role = 'parent' then 'parent' else 'school_staff' end
  where id = p_assessment_id;
end;
$$;

grant execute on function public.assign_assessment_respondent(uuid, uuid) to authenticated;

-- The clinician changes their mind and completes it themselves after
-- all. Leaves any partial responses already entered exactly as they
-- are, in case the clinician wants to pick up where the respondent
-- left off rather than start over.
create or replace function public.unassign_assessment_respondent(p_assessment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assessment record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_assessment from public.assessments where id = p_assessment_id;
  if v_assessment.id is null then
    raise exception 'Assessment not found.';
  end if;
  if v_assessment.clinician_id is distinct from auth.uid() then
    raise exception 'Only this assessment''s own author may unassign a respondent.';
  end if;
  if v_assessment.completed_at is not null then
    raise exception 'This assessment has already been completed.';
  end if;

  update public.assessments
  set assigned_respondent_id = null,
      assigned_at = null,
      last_reminded_at = null
  where id = p_assessment_id;
end;
$$;

grant execute on function public.unassign_assessment_respondent(uuid) to authenticated;

create or replace function public.remind_assessment_respondent(p_assessment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  update public.assessments
  set last_reminded_at = now()
  where id = p_assessment_id
    and clinician_id = auth.uid()
    and assigned_respondent_id is not null
    and completed_at is null;

  if not found then
    raise exception 'This assessment has no active assignment to remind.';
  end if;
end;
$$;

grant execute on function public.remind_assessment_respondent(uuid) to authenticated;

-- ===========================================================================
-- 4. The respondent's own two RPCs -- their ENTIRE interaction surface
-- with this table. Both check ONLY assigned_respondent_id = auth.uid()
-- -- no has_child_access()/clinician_access/institution-standing
-- re-check at all, deliberately. This is 0040's own documented
-- judgment for fba_instrument_requests' recipient policy, copied
-- exactly: being named as respondent is sufficient, permanently, even
-- after the respondent's own access to the child later ends. Their own
-- answer stays theirs to see and finish.
-- ===========================================================================

-- Returns ONLY what a respondent needs -- never the clinician's own
-- interpretation, scores, subscale totals, or anything else on the
-- row. This is the actual fix for the SELECT leak: no amount of RLS
-- scoping on the base table would have been safe, because the row
-- itself carries fields a respondent must never see.
create or replace function public.get_assessment_to_complete(p_assessment_id uuid)
returns table (
  id uuid,
  child_name text,
  instrument_name text,
  item_count integer,
  response_scale jsonb,
  clinician_name text,
  instruction text,
  responses jsonb,
  assigned_at timestamptz,
  last_reminded_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    a.id, p.child_name, ai.name, ai.item_count, ai.response_scale,
    coalesce(cu.raw_user_meta_data ->> 'full_name', cu.raw_app_meta_data ->> 'full_name'),
    a.instruction, a.responses, a.assigned_at, a.last_reminded_at
  from public.assessments a
  join public.passports p on p.id = a.passport_id
  join public.assessment_instruments ai on ai.id = a.instrument_id
  join auth.users cu on cu.id = a.clinician_id
  where a.id = p_assessment_id
    and a.assigned_respondent_id = auth.uid()
    and a.completed_at is null;
$$;

grant execute on function public.get_assessment_to_complete(uuid) to authenticated;

-- The list view for a respondent's own dashboard prompt card, mirroring
-- get_my_instrument_requests()'s own shape exactly (recipient_id
-- alone, no role branching server-side -- track/copy is a client-side
-- concern only, same as the old mechanism).
create or replace function public.get_my_assessments_to_complete()
returns table (
  id uuid,
  child_name text,
  instrument_name text,
  clinician_name text,
  instruction text,
  assigned_at timestamptz,
  last_reminded_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    a.id, p.child_name, ai.name,
    coalesce(cu.raw_user_meta_data ->> 'full_name', cu.raw_app_meta_data ->> 'full_name'),
    a.instruction, a.assigned_at, a.last_reminded_at
  from public.assessments a
  join public.passports p on p.id = a.passport_id
  join public.assessment_instruments ai on ai.id = a.instrument_id
  join auth.users cu on cu.id = a.clinician_id
  where a.assigned_respondent_id = auth.uid()
    and a.completed_at is null
  order by a.assigned_at asc;
$$;

grant execute on function public.get_my_assessments_to_complete() to authenticated;

-- The submit path. Writes ONLY responses -- never subscale_totals,
-- per Daniel's own correction: 13a's whole point is that the clinician
-- enters subscale totals from the paper's own scoring key, deliberately
-- never computed or entered by anyone else. A respondent writing totals
-- would defeat that. Explicitly refuses, with a real message, once the
-- assessment is already completed -- the auto-cancel Daniel asked for,
-- matching 0199's own reasoning (the document no longer accepts writes,
-- so an outstanding request should say so rather than failing silently)
-- -- there is no separate 'cancelled' state to transition through here,
-- since a single-respondent design has no other request to cancel
-- independently; completed_at being set IS the terminal state, and this
-- is where that fact gets surfaced as a real, readable message instead
-- of a silent RLS-shaped no-op.
create or replace function public.submit_assessment_response(
  p_assessment_id uuid,
  p_responses jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assessment record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_assessment from public.assessments where id = p_assessment_id;
  if v_assessment.id is null or v_assessment.assigned_respondent_id is distinct from auth.uid() then
    raise exception 'This assessment was not assigned to you.';
  end if;

  if v_assessment.completed_at is not null then
    raise exception 'This assessment has already been completed -- your response is no longer needed.';
  end if;

  update public.assessments
  set responses = p_responses
  where id = p_assessment_id;
end;
$$;

grant execute on function public.submit_assessment_response(uuid, jsonb) to authenticated;
