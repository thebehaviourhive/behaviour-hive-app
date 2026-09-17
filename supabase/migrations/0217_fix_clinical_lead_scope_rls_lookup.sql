-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- FIXES A BUG THAT PREDATES THIS SESSION'S STAGE 4 WORK: both of
-- clinical_lead_scope's own policies (0207, PRD 5 Stage 2) do a raw
-- EXISTS against institution_staff to find a row belonging to someone
-- OTHER than the caller -- the lead being scoped, not the director
-- managing it or the colleague viewing it. institution_staff's own
-- SELECT policy has been self-only ("Users can view their own staff
-- link", auth.uid() = user_id) since migration 0009, and a subquery
-- inside another table's RLS policy runs under the CALLING session's
-- own permissions, not elevated ones. So that lookup silently returns
-- nothing for anyone except the lead themselves, and both policies
-- silently fail for their real use case:
--
--   WRITE POLICY: a director scoping ANYONE BUT THEMSELVES -- which is
--   the only case that ever happens -- could never actually insert a
--   clinical_lead_scope row through a real session. Confirmed live,
--   Stage 4 verification: a real director's own INSERT for a real lead,
--   with a genuinely valid catalog pair, was refused with a bare RLS
--   violation. The table has never been writable through a real session
--   since it shipped.
--
--   READ POLICY: its own migration comment states the intent plainly --
--   "any active staff member at the same institution can see a lead's
--   own scope... not locked to the lead or the director alone." The
--   identical target-lookup shape means only the lead themselves could
--   ever satisfy it -- the opposite of what the policy says it does.
--
-- Found by testing the table's own RLS with a real session doing the
-- real write, not by reading the SQL and not by testing the RPCs that
-- happen to sit above other tables -- there is no RPC above this table
-- at all, direct RLS is the only path, and nothing exercised it as a
-- real caller until Stage 4's own verification did. The second
-- instance (the read policy) was found by a deliberate sweep for the
-- same shape, not stumbled on -- it would not have surfaced from fixing
-- the write policy alone.
--
-- THE FIX: two SECURITY DEFINER helpers, one per policy, each
-- resolving the TARGET lead's own institution_id once (bypassing
-- institution_staff's restrictive SELECT internally, the same way
-- institution_staff_has_current_standing() already does for its own
-- callers), then authorizing the CALLER against that institution_id.
-- _can_manage_clinical_lead_scope() folds catalog validation into the
-- same helper rather than a second raw EXISTS block (Daniel's own
-- instruction) -- p_dimension/p_value are optional so the identical
-- function serves USING (director check alone) and WITH CHECK
-- (director check + catalog validation) without duplicating the
-- director-authorization logic twice.

create or replace function public._staff_can_view_lead_scope(
  p_institution_staff_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_institution_id uuid;
begin
  select institution_id into v_institution_id
  from public.institution_staff
  where id = p_institution_staff_id;

  if v_institution_id is null then
    return false;
  end if;

  return exists (
    select 1 from public.institution_staff caller
    where caller.institution_id = v_institution_id
      and caller.user_id = auth.uid()
      and public.institution_staff_has_current_standing(caller.user_id, caller.institution_id)
  );
end;
$$;

alter policy "Institution staff can view clinical lead scope at their own institution"
  on public.clinical_lead_scope
  using (
    public._staff_can_view_lead_scope(clinical_lead_scope.institution_staff_id)
  );

create or replace function public._can_manage_clinical_lead_scope(
  p_institution_staff_id uuid,
  p_dimension text default null,
  p_value text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_institution_id uuid;
begin
  select institution_id into v_institution_id
  from public.institution_staff
  where id = p_institution_staff_id;

  if v_institution_id is null then
    return false;
  end if;

  if not exists (
    select 1 from public.institution_staff director
    where director.institution_id = v_institution_id
      and director.user_id = auth.uid()
      and director.role = 'principal'
      and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
  ) then
    return false;
  end if;

  if p_dimension is not null and not exists (
    select 1 from public.institution_tags it
    where it.institution_id = v_institution_id
      and it.dimension = p_dimension
      and it.value = p_value
      and it.is_active
  ) then
    return false;
  end if;

  return true;
end;
$$;

alter policy "Institution admins can manage clinical lead scope at their own institution"
  on public.clinical_lead_scope
  using (
    public._can_manage_clinical_lead_scope(clinical_lead_scope.institution_staff_id)
  )
  with check (
    public._can_manage_clinical_lead_scope(
      clinical_lead_scope.institution_staff_id,
      clinical_lead_scope.dimension,
      clinical_lead_scope.value
    )
  );
