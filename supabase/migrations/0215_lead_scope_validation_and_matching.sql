-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 5 Stage 4, Step 3 -- clinical_lead_scope's own left-open seam
-- (0207) closed, and the scope-matching rule made real. Both authority
-- rules below are Daniel's own decisions, settled before any code was
-- written because they are cheap now and expensive once real scope rows
-- exist:
--
-- RULE 1, WITHIN ONE LEAD: AND across the lead's own DISTINCT
-- dimensions, OR within any one dimension's multiple values. A lead
-- scoped to (funding=Tusla) and (location=Dublin) oversees Tusla cases
-- IN Dublin -- not every Tusla case everywhere plus every Dublin case
-- regardless of funding. A lead scoped to (funding=Tusla) AND
-- (funding=HSE) -- two rows, same dimension -- oversees clients with
-- EITHER funding value; that's the ordinary, unremarkable multi-value
-- case PRD section 6 already describes generally ("a client can receive
-- two services at once"), not a second rule. Zero scope rows means zero
-- matches, default-deny, matching 0207's own stated posture.
--
-- RULE 2, TWO LEADS, ONE CLIENT: no tie-break, both have authority.
-- Implemented by construction, not by extra code -- this function only
-- ever answers "is THIS ONE lead in scope for THIS episode," called
-- once per caller. Two different leads independently passing the same
-- check for the same episode is simply two true answers to two separate
-- questions; nothing here ever compares one lead's scope against
-- another's, and nothing needs to.
--
-- VALIDATION: clinical_lead_scope's own INSERT/UPDATE now requires the
-- (dimension, value) pair to exist as an active row in the SAME
-- institution's institution_tags catalog. A typo silently granting or
-- silently failing to grant authority, with no error, is exactly the
-- failure mode 0207 flagged this seam to prevent.

alter policy "Institution admins can manage clinical lead scope at their own institution"
  on public.clinical_lead_scope
  with check (
    exists (
      select 1 from public.institution_staff target
      join public.institution_staff director
        on director.institution_id = target.institution_id
      where target.id = clinical_lead_scope.institution_staff_id
        and director.user_id = auth.uid()
        and director.role = 'principal'
        and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
    )
    and exists (
      select 1
      from public.institution_staff target
      join public.institution_tags it
        on it.institution_id = target.institution_id
      where target.id = clinical_lead_scope.institution_staff_id
        and it.dimension = clinical_lead_scope.dimension
        and it.value = clinical_lead_scope.value
        and it.is_active
    )
  );

-- Internal only -- no grant to authenticated, matching this schema's
-- own underscore-prefixed-helper convention (_close_child_access_for_
-- enrolment_end, _close_caseload_for_episode_end). Called from other
-- SECURITY DEFINER functions, never directly by a client.
create or replace function public._lead_episode_in_scope(
  p_institution_staff_id uuid,
  p_episode_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  with lead_dims as (
    select distinct dimension
    from public.clinical_lead_scope
    where institution_staff_id = p_institution_staff_id
  ),
  matched_dims as (
    select distinct cls.dimension
    from public.clinical_lead_scope cls
    join public.episode_tags et
      on et.dimension = cls.dimension and et.value = cls.value
    where cls.institution_staff_id = p_institution_staff_id
      and et.episode_id = p_episode_id
  )
  select
    (select count(*) from lead_dims) > 0
    and (select count(*) from lead_dims) = (select count(*) from matched_dims);
$$;
