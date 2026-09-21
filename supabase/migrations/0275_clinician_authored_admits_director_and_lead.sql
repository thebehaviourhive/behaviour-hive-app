-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Found live, building PRD 10 Stage 6's own propose screen: a director
-- who authors their own client's FBA/BSP (PRD 10 section 4a/5.9 -- "the
-- director must have every function a practitioner has," built and
-- verified in Stage 1) could not then propose sharing it, because
-- get_fba_reports_for_director()/get_bsp_for_director() (PRD 8 Stage 2,
-- 0249) both gate through _clinician_authored_at_institution() (0246),
-- which checks the author's own institution_staff.role for the LITERAL
-- value 'clinician' -- a check written before Stage 1 made a director
-- or lead a genuine practitioner in their own right, still holding
-- role = 'principal'/'clinical_lead' at institution_staff, never
-- 'clinician'. A director's own real, completed FBA was structurally
-- invisible to every one of this helper's callers -- not just the two
-- this migration was written to fix, but session notes, clinical
-- plans, assessments, published clinical content, and attachments too
-- (0249, 0250, 0251 -- eight call sites total, grep-confirmed).
--
-- This is routing, not a change to the FBA itself, or to any of the
-- other artefact types this helper gates -- their own schema, content,
-- and save paths are untouched. Widened to admit any of the three
-- roles PRD 10 section 4a names as "all practitioners, with authority
-- layered on top": clinician, clinical_lead, principal.

create or replace function public._clinician_authored_at_institution(
  p_clinician_id uuid,
  p_institution_id uuid,
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
    from public.institution_staff s
    where s.user_id = p_clinician_id
      and s.institution_id = p_institution_id
      and s.role in ('clinician', 'clinical_lead', 'principal')
      and s.approved_at is not null
      and s.approved_at <= p_at
      and (s.deactivated_at is null or s.deactivated_at > p_at)
  );
$$;
