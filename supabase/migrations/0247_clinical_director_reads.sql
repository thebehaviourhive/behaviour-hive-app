-- PRD 8 Stage 2, its own piece, decided before export: a clinical
-- director reads every one of their own clinic's clinical artefacts,
-- not just the ones a colleague happens to share a domain tag with.
--
-- Daniel's own reasoning, recorded as the decision, not as plumbing for
-- export: a clinical director is accountable for their organisation's
-- clinical record. That accountability does not stop at their own
-- discipline -- a director who is a BCBA being unable to read an SLT's
-- assessment of a client at their own clinic is wrong on its own terms,
-- independently of whether export exists. Domain matching
-- (_clinical_colleague_domain_match) is a peer-colleague mechanism, built
-- for a clinician reading a COLLEAGUE's work; a director is not a peer
-- colleague, they're the person answerable for the record. A `clinical_
-- lead`'s own scope (clinical_lead_scope, PRD 5 Stage 4) is oversight
-- over specific clients via tag-matching, a different relationship
-- again -- this migration gives them nothing, deliberately, same as
-- session_notes already does. That asymmetry (director: everything;
-- lead: nothing from this specific read) is not an oversight to close
-- later, it's the standing shape of authority in this schema.
--
-- Four new functions, one per table, each modelled byte-for-byte on
-- get_session_notes_for_director() (0230) -- narrow, table-specific,
-- SECURITY DEFINER, re-deriving the director check itself rather than
-- widening any table's own RLS policy. Deliberately NOT one function
-- spanning four tables: the whole point of this shape (Daniel's own
-- framing, PRD 8 Stage 1) is that one mistake in a function holding the
-- answer for many tables leaks everything at once; four separate,
-- narrow functions mean a mistake in one is contained to one table.
--
-- UNLIKE session_notes' own director RPC, this genuinely grants new
-- read access -- none of these four tables has ever had a director
-- branch on their own base RLS (checked directly, each one's own
-- migration says so on purpose: bsp's "No director-read branch,
-- deliberately", clinical_plans' "No director-always branch", and
-- assessments' "SELECT is author-only, a deliberate Stage 1 scoping
-- choice"). This migration is that stage for all four, arriving via an
-- explicit ask rather than as a side effect of anything else.

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
      from public.institution_staff author_staff
      join public.institution_staff director on director.institution_id = author_staff.institution_id
      join public.institutions inst on inst.id = director.institution_id
      where author_staff.user_id = fr.clinician_id
        and author_staff.role = 'clinician'
        and director.user_id = auth.uid()
        and director.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
    )
  order by fr.created_at desc;
$$;

grant execute on function public.get_fba_reports_for_director(uuid) to authenticated;


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
      from public.institution_staff author_staff
      join public.institution_staff director on director.institution_id = author_staff.institution_id
      join public.institutions inst on inst.id = director.institution_id
      where author_staff.user_id = b.clinician_id
        and author_staff.role = 'clinician'
        and director.user_id = auth.uid()
        and director.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
    )
  order by b.created_at desc;
$$;

grant execute on function public.get_bsp_for_director(uuid) to authenticated;


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
      from public.institution_staff author_staff
      join public.institution_staff director on director.institution_id = author_staff.institution_id
      join public.institutions inst on inst.id = director.institution_id
      where author_staff.user_id = cp.clinician_id
        and author_staff.role = 'clinician'
        and director.user_id = auth.uid()
        and director.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
    )
  order by cp.created_at desc;
$$;

grant execute on function public.get_clinical_plans_for_director(uuid) to authenticated;


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
      from public.institution_staff author_staff
      join public.institution_staff director on director.institution_id = author_staff.institution_id
      join public.institutions inst on inst.id = director.institution_id
      where author_staff.user_id = a.clinician_id
        and author_staff.role = 'clinician'
        and director.user_id = auth.uid()
        and director.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
    )
  order by a.created_at desc;
$$;

grant execute on function public.get_assessments_for_director(uuid) to authenticated;
