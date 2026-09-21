-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 10 Stage 6, two real gaps found before any screen was built.
--
-- 1. propose_cross_organisation_grant() (0245) takes
--    p_receiving_institution_id as a raw client parameter with no check
--    that the child is actually linked to it -- a director could
--    propose sharing a child's FBA with a school that child has no
--    relationship with. The parent's own confirmation was the only
--    safeguard, and a safeguard that depends on a parent noticing an
--    unfamiliar school name in a confirmation screen is not one. Fixed
--    server-side: the function itself now refuses a receiving
--    institution the child is not linked to, independent of whatever
--    the screen offers.
--
--    Paired with get_passport_linked_schools_for_director() -- the
--    lookup the propose screen needs anyway, so it only ever OFFERS
--    schools the child genuinely attends. Both halves matter: the
--    screen offering only valid schools is not the guarantee, the
--    function refusing invalid ones is -- exactly the same shape this
--    schema already insists on everywhere else a client could
--    otherwise supply an arbitrary id (bulk_grant_clinician_access's
--    own roster-membership re-check, reassign_clinician_caseload's
--    own roster-membership re-check).
--
-- 2. revoke_cross_organisation_grant() (0245) has a single
--    authorization branch -- the granting clinic's own director. No
--    parent path was ever built. Confirmed by grep before touching
--    anything: 0245 is the ONLY migration in the whole history that
--    mentions this function by name -- no later migration has ever
--    silently dropped or altered it, unlike the derive_countersign_
--    fields()/create_bsp() precedent this schema has already hit
--    twice. Widened here to a genuine OR: the director (accountable
--    for what the clinic shares, reason required, matching every other
--    consequential director action in this schema) or the child's own
--    guardian (withdrawing their own consent, reason optional -- GDPR's
--    own "as easy to withdraw as to give" rule, PRD 10 v1.3 section
--    6.3, not a design preference). p_reason gaining a default of null
--    does not change the function's identity (Postgres resolves
--    overloads by parameter TYPES, never defaults) -- this is a safe
--    CREATE OR REPLACE, not the send_message()-shaped trap of adding a
--    genuinely new trailing parameter.

-- ===========================================================================
-- 1. get_passport_linked_schools_for_director() -- the lookup the
--    propose screen needs. Same director-of-a-linked-clinic check
--    propose_cross_organisation_grant() already performs.
-- ===========================================================================

create or replace function public.get_passport_linked_schools_for_director(p_passport_id uuid)
returns table (
  institution_id uuid,
  institution_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select i.id, i.name
  from public.passport_institution_links pil
  join public.institutions i on i.id = pil.institution_id
  where pil.passport_id = p_passport_id
    and i.type = 'school'
    and exists (
      select 1
      from public.passport_institution_links pil2
      join public.institutions clinic_inst on clinic_inst.id = pil2.institution_id
      where pil2.passport_id = p_passport_id
        and clinic_inst.type = 'clinic'
        and public._is_director_of_institution(pil2.institution_id)
    )
  order by i.name;
$$;

grant execute on function public.get_passport_linked_schools_for_director(uuid) to authenticated;

-- ===========================================================================
-- 2. propose_cross_organisation_grant() -- refuse an unlinked school.
-- ===========================================================================

create or replace function public.propose_cross_organisation_grant(
  p_passport_id uuid,
  p_receiving_institution_id uuid,
  p_scope_items text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_granting_institution_id uuid;
  v_grant_id uuid;
begin
  select pil.institution_id into v_granting_institution_id
  from public.passport_institution_links pil
  join public.institutions i on i.id = pil.institution_id
  where pil.passport_id = p_passport_id
    and i.type = 'clinic'
    and public._is_director_of_institution(pil.institution_id)
  limit 1;

  if v_granting_institution_id is null then
    raise exception 'You must be the director of a clinic already linked to this child to propose a grant.';
  end if;

  if not exists (
    select 1
    from public.passport_institution_links pil
    join public.institutions i on i.id = pil.institution_id
    where pil.passport_id = p_passport_id
      and pil.institution_id = p_receiving_institution_id
      and i.type = 'school'
  ) then
    raise exception 'This child is not linked to that school.';
  end if;

  insert into public.cross_organisation_grants (
    passport_id, granting_institution_id, receiving_institution_id, scope_items, proposed_by
  )
  values (
    p_passport_id, v_granting_institution_id, p_receiving_institution_id, p_scope_items, auth.uid()
  )
  returning id into v_grant_id;

  return v_grant_id;
end;
$$;

grant execute on function public.propose_cross_organisation_grant(uuid, uuid, text[]) to authenticated;

-- ===========================================================================
-- 3. revoke_cross_organisation_grant() -- the director, or the child's
--    own guardian. Reason required for the director, optional for the
--    guardian.
-- ===========================================================================

create or replace function public.revoke_cross_organisation_grant(p_grant_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant public.cross_organisation_grants;
  v_is_director boolean;
  v_is_guardian boolean;
begin
  select * into v_grant from public.cross_organisation_grants where id = p_grant_id;
  if not found then
    raise exception 'Grant not found, or you do not have permission to act on it.';
  end if;

  v_is_director := public._is_director_of_institution(v_grant.granting_institution_id);
  v_is_guardian := public.owns_passport(v_grant.passport_id);

  if not (v_is_director or v_is_guardian) then
    raise exception 'Only the granting clinic''s own director, or this child''s own guardian, may revoke this grant.';
  end if;

  if v_grant.status <> 'active' then
    raise exception 'Only an active grant can be revoked.';
  end if;

  if v_is_director and (p_reason is null or trim(p_reason) = '') then
    raise exception 'A reason is required to revoke a grant.';
  end if;

  update public.cross_organisation_grants
  set status = 'revoked', revoked_by = auth.uid(), revoked_at = now(), revoke_reason = p_reason
  where id = p_grant_id;
end;
$$;

grant execute on function public.revoke_cross_organisation_grant(uuid, text) to authenticated;
