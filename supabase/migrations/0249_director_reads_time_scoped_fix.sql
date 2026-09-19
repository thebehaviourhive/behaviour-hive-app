-- PRD 8 Stage 2 -- a real bug, found writing the verification fixture
-- for exactly the case it breaks, not by review.
--
-- 0247/0248's own header comments describe the time-scoped join
-- (_clinician_authored_at_institution(), 0246) as "the load-bearing
-- finding from this stage's own recon" -- and then none of the five new
-- director-read RPCs actually called it. Each one re-derived a similar-
-- looking institution_staff join inline instead, copied from
-- get_session_notes_for_director() (0230, PRD 6 Stage 4, predates this
-- stage): `author_staff.institution_id = director.institution_id`, with
-- NO bound on author_staff.approved_at/deactivated_at and no comparison
-- against the artefact's own created_at at all. That join answers "does
-- this author have ANY institution_staff row, ever, at my institution" --
-- not "did they hold one AT THE TIME they wrote this". A clinician who
-- authored something at Clinic A, left, and later joined Clinic B would
-- have that old material readable by Clinic B's own director the moment
-- they joined -- the exact misattribution _clinician_authored_at_
-- institution() was built to prevent, just never actually wired in.
--
-- Caught building the fixture Daniel asked for specifically to prove
-- this ("build it so the naive join would visibly fail it") -- it did,
-- against the RPCs as shipped. Fixed here, in all SIX functions that
-- share the shape: the five from 0247/0248, plus get_session_notes_for_
-- director() itself, which had the identical flaw from before this
-- stage began and was faithfully copied forward rather than caught.
--
-- Same signatures, same return shapes -- CREATE OR REPLACE is sufficient
-- for all six, no DROP needed.

create or replace function public.get_session_notes_for_director(p_passport_id uuid)
returns table (
  id uuid,
  session_date date,
  clinical_record text,
  parent_note text,
  is_shared_with_parent boolean,
  shared_at timestamptz,
  parent_note_edited_after_share_at timestamptz,
  clinician_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select sn.id, sn.session_date, sn.clinical_record, sn.parent_note, sn.is_shared_with_parent,
    sn.shared_at, sn.parent_note_edited_after_share_at,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name')
  from public.session_notes sn
  join auth.users u on u.id = sn.clinician_id
  where sn.passport_id = p_passport_id
    and exists (
      select 1
      from public.institution_staff director
      join public.institutions inst on inst.id = director.institution_id
      where director.user_id = auth.uid()
        and director.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
        and public._clinician_authored_at_institution(sn.clinician_id, director.institution_id, sn.created_at)
    )
  order by sn.session_date desc, sn.created_at desc;
$$;


create or replace function public.get_fba_reports_for_director(p_passport_id uuid)
returns table (
  id uuid,
  status text,
  content_data jsonb,
  created_at timestamptz,
  completed_at timestamptz,
  clinician_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select fr.id, fr.status, fr.content_data, fr.created_at, fr.completed_at,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name')
  from public.fba_reports fr
  join auth.users u on u.id = fr.clinician_id
  where fr.passport_id = p_passport_id
    and exists (
      select 1
      from public.institution_staff director
      join public.institutions inst on inst.id = director.institution_id
      where director.user_id = auth.uid()
        and director.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
        and public._clinician_authored_at_institution(fr.clinician_id, director.institution_id, fr.created_at)
    )
  order by fr.created_at desc;
$$;


create or replace function public.get_bsp_for_director(p_passport_id uuid)
returns table (
  id uuid,
  status text,
  target_behaviours jsonb,
  triggers jsonb,
  setting_events jsonb,
  precursors text,
  current_frequency text,
  signed_at timestamptz,
  created_at timestamptz,
  clinician_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select b.id, b.status, b.target_behaviours, b.triggers, b.setting_events,
    b.precursors, b.current_frequency, b.signed_at, b.created_at,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name')
  from public.bsp b
  join auth.users u on u.id = b.clinician_id
  where b.passport_id = p_passport_id
    and exists (
      select 1
      from public.institution_staff director
      join public.institutions inst on inst.id = director.institution_id
      where director.user_id = auth.uid()
        and director.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
        and public._clinician_authored_at_institution(b.clinician_id, director.institution_id, b.created_at)
    )
  order by b.created_at desc;
$$;


create or replace function public.get_clinical_plans_for_director(p_passport_id uuid)
returns table (
  id uuid,
  plan_type text,
  name text,
  plan_date date,
  body text,
  created_at timestamptz,
  clinician_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select cp.id, cp.plan_type, cp.name, cp.plan_date, cp.body, cp.created_at,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name')
  from public.clinical_plans cp
  join auth.users u on u.id = cp.clinician_id
  where cp.passport_id = p_passport_id
    and exists (
      select 1
      from public.institution_staff director
      join public.institutions inst on inst.id = director.institution_id
      where director.user_id = auth.uid()
        and director.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
        and public._clinician_authored_at_institution(cp.clinician_id, director.institution_id, cp.created_at)
    )
  order by cp.created_at desc;
$$;


create or replace function public.get_assessments_for_director(p_passport_id uuid)
returns table (
  id uuid,
  record_type text,
  instrument_id uuid,
  assessment_date date,
  completed_at timestamptz,
  respondent_type text,
  responses jsonb,
  subscale_totals jsonb,
  instrument_version text,
  administrator_name text,
  location text,
  scores jsonb,
  interpretation text,
  created_at timestamptz,
  clinician_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select a.id, a.record_type, a.instrument_id, a.assessment_date, a.completed_at,
    a.respondent_type, a.responses, a.subscale_totals, a.instrument_version, a.administrator_name,
    a.location, a.scores, a.interpretation, a.created_at,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name')
  from public.assessments a
  join auth.users u on u.id = a.clinician_id
  where a.passport_id = p_passport_id
    and exists (
      select 1
      from public.institution_staff director
      join public.institutions inst on inst.id = director.institution_id
      where director.user_id = auth.uid()
        and director.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
        and public._clinician_authored_at_institution(a.clinician_id, director.institution_id, a.created_at)
    )
  order by a.created_at desc;
$$;


create or replace function public.get_passport_clinical_content_for_director(p_passport_id uuid)
returns table (
  id uuid,
  item_type text,
  content jsonb,
  author_role text,
  author_id uuid,
  author_name text,
  author_specialty text,
  source_document_type text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    pcc.id, pcc.item_type, pcc.content, pcc.author_role, pcc.author_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as author_name,
    c.specialty as author_specialty, pcc.source_document_type, pcc.created_at
  from public.passport_clinical_content pcc
  join auth.users u on u.id = pcc.author_id
  left join public.clinicians c on c.user_id = pcc.author_id
  where pcc.passport_id = p_passport_id
    and public._bsp_source_still_active(pcc.source_document_type, pcc.source_document_id)
    and exists (
      select 1
      from public.institution_staff director
      join public.institutions inst on inst.id = director.institution_id
      where director.user_id = auth.uid()
        and director.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
        and public._clinician_authored_at_institution(pcc.author_id, director.institution_id, pcc.created_at)
    )
  order by pcc.created_at asc;
$$;
