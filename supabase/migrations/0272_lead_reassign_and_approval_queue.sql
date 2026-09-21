-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 10 Stage 5. Found live: lead_can_reassign_within_scope (0207) and
-- its director-only setter (0271) were shipped in Stage 4 with nothing
-- behind them -- the toggle persisted, the confirm sheet named real
-- people, and none of it changed anything, because no reassignment
-- RPC has ever existed. Flipping it was a false promise. This migration
-- builds the missing capability rather than removing the toggle --
-- exactly the two halves that already exist (revoke_clinician_access,
-- 0123; the reactivate-or-insert grant shape bulk_grant_clinician_
-- access already uses, 0224/0268), wrapped in one atomic transaction,
-- authorized the same two-branch way end_clinic_episode()/approve_tag_
-- change_request() already are: director always, a lead only when the
-- toggle is on and the episode is within their own scope.
--
-- Two existing reads are widened alongside it, because the lead needs
-- them to actually USE the new action, not because either read's own
-- authorization was wrong: get_passport_clinicians() (so a lead can see
-- who currently holds a scope client's caseload, matching the same
-- _lead_episode_in_scope() gate get_child_passport_profile_for_lead()
-- already uses) and get_institution_roster_clinicians_for_caseload()
-- (so a lead can see who to reassign TO -- this one needs no scope
-- check of its own, since the roster itself isn't scope-sensitive; only
-- the reassignment action is, and that's enforced inside the new RPC).
--
-- Last piece: get_pending_tag_change_requests_for_lead() -- the answer
-- to "does the existing pending-request read need a lead-scoped
-- equivalent." get_pending_tag_change_requests() (0220) is already
-- callable by any active staff member including a lead, with NO
-- filtering at all -- a lead calling it today would see every pending
-- request institution-wide, including scoping-dimension changes and
-- changes outside their own scope, neither of which they have any
-- authority to decide. A dedicated function, not a client-side filter:
-- the filtering logic (_tag_change_touches_scoping_dimension,
-- _lead_episode_in_scope) is internal/SECURITY DEFINER and was never
-- meant to be called directly by a client, and duplicating its two
-- predicates in JS would be exactly the kind of silently-wrong preview
-- Stage 4's own client-side match logic was so carefully proven
-- against. This function mirrors approve_tag_change_request()'s own
-- eligibility test exactly, so "the lead can see it" and "the lead can
-- decide it" can never drift apart.

-- ===========================================================================
-- 1. reassign_clinician_caseload() -- the missing capability.
-- ===========================================================================

create or replace function public.reassign_clinician_caseload(
  p_clinician_access_id uuid,
  p_new_clinician_user_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.clinician_access;
  v_institution_id uuid;
  v_episode_id uuid;
  v_caller_staff_id uuid;
  v_caller_role text;
  v_new_row_id uuid;
  v_existing public.clinician_access;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required.';
  end if;

  select * into v_row from public.clinician_access where id = p_clinician_access_id;
  if not found then
    raise exception 'Not found.';
  end if;

  if not v_row.is_active then
    raise exception 'This engagement has already ended.';
  end if;

  if v_row.engaged_by <> 'institution' then
    raise exception 'Only an institution-engaged caseload assignment can be reassigned.';
  end if;

  v_institution_id := v_row.engaged_by_institution_id;

  select e.id into v_episode_id
  from public.episodes_of_care e
  where e.institution_id = v_institution_id
    and e.passport_id = v_row.passport_id
    and e.ended_at is null;

  if v_episode_id is null then
    raise exception 'No active episode of care found for this client at this institution.';
  end if;

  select s.id, s.role into v_caller_staff_id, v_caller_role
  from public.institution_staff s
  where s.institution_id = v_institution_id
    and s.user_id = auth.uid()
    and public.institution_staff_has_current_standing(s.user_id, s.institution_id);

  if v_caller_role is null or not (
    v_caller_role = 'principal'
    or (
      v_caller_role = 'clinical_lead'
      and exists (
        select 1 from public.institutions inst
        where inst.id = v_institution_id
          and inst.lead_can_reassign_within_scope
      )
      and public._lead_episode_in_scope(v_caller_staff_id, v_episode_id)
    )
  ) then
    raise exception 'Only a clinical director, or (where enabled) a lead reassigning within their own scope, can move this client to a different practitioner.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    where s.institution_id = v_institution_id
      and s.user_id = p_new_clinician_user_id
      and s.role in ('clinician', 'principal', 'clinical_lead')
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'This person is not an active practitioner at this clinic.';
  end if;

  if not public.is_verified_clinician(p_new_clinician_user_id) then
    raise exception 'This practitioner is not yet verified.';
  end if;

  if p_new_clinician_user_id = v_row.clinician_id then
    raise exception 'This client is already assigned to that practitioner.';
  end if;

  -- Revoke half -- same effect as revoke_clinician_access(), inlined
  -- because that function's own caller check (principal / self / owning
  -- parent) doesn't admit a lead, and this reassignment has already
  -- been authorized above.
  update public.clinician_access
  set is_active = false,
      revoked_at = now(),
      revoked_by = auth.uid(),
      revocation_reason = trim(p_reason)
  where id = p_clinician_access_id;

  -- Grant half -- the identical reactivate-or-insert shape bulk_grant_
  -- clinician_access() already uses per passport (0224/0268), scoped
  -- to this one target.
  select * into v_existing
  from public.clinician_access
  where passport_id = v_row.passport_id and clinician_id = p_new_clinician_user_id;

  if found and v_existing.is_active then
    v_new_row_id := v_existing.id;
  elsif found then
    update public.clinician_access
    set is_active = true,
        linked_at = now(),
        granted_by = auth.uid(),
        revoked_at = null,
        revoked_by = null,
        revocation_reason = null
    where id = v_existing.id
    returning id into v_new_row_id;
  else
    insert into public.clinician_access (passport_id, clinician_id, engaged_by, engaged_by_institution_id, granted_by)
    values (v_row.passport_id, p_new_clinician_user_id, 'institution', v_institution_id, auth.uid())
    returning id into v_new_row_id;
  end if;

  return v_new_row_id;
end;
$$;

grant execute on function public.reassign_clinician_caseload(uuid, uuid, text) to authenticated;

-- ===========================================================================
-- 2. Widen get_passport_clinicians() -- a lead needs to see who
--    currently holds a scope client's caseload before they can pick
--    who to reassign it to. Same return shape, CREATE OR REPLACE is
--    safe. Additive OR branch only -- the guardian and director
--    branches (0221) are untouched.
-- ===========================================================================

create or replace function public.get_passport_clinicians(p_passport_id uuid)
returns table (
  clinician_access_id uuid,
  clinician_id uuid,
  full_name text,
  specialty text,
  last_review_date date,
  linked_at timestamptz,
  engaged_by text,
  engaged_by_institution_id uuid,
  engaged_by_institution_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    ca.id, ca.clinician_id, c.full_name, c.specialty, ca.last_review_date, ca.linked_at,
    ca.engaged_by, ca.engaged_by_institution_id, inst.name
  from public.clinician_access ca
  join public.clinicians c on c.user_id = ca.clinician_id
  left join public.institutions inst on inst.id = ca.engaged_by_institution_id
  where ca.passport_id = p_passport_id
    and ca.is_active = true
    and public.is_verified_clinician(ca.clinician_id)
    and (
      public.owns_passport(p_passport_id)
      or exists (
        select 1 from public.passport_institution_links pil
        join public.institution_staff s on s.institution_id = pil.institution_id
        where pil.passport_id = p_passport_id
          and s.user_id = auth.uid()
          and s.role = 'principal'
          and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
      )
      or exists (
        select 1 from public.passport_institution_links pil
        join public.institution_staff s on s.institution_id = pil.institution_id
        join public.episodes_of_care e
          on e.institution_id = s.institution_id
          and e.passport_id = p_passport_id
          and e.ended_at is null
        where pil.passport_id = p_passport_id
          and s.user_id = auth.uid()
          and s.role = 'clinical_lead'
          and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
          and public._lead_episode_in_scope(s.id, e.id)
      )
    );
$$;

-- ===========================================================================
-- 3. Widen get_institution_roster_clinicians_for_caseload() -- any
--    active lead at this institution may see the roster of practitioners
--    to reassign a scope client TO. No scope check here -- the roster
--    itself isn't scope-sensitive; only the reassignment action is, and
--    that's enforced inside reassign_clinician_caseload() above.
-- ===========================================================================

create or replace function public.get_institution_roster_clinicians_for_caseload(
  p_institution_id uuid
)
returns table (
  user_id uuid,
  full_name text,
  specialty text,
  covered_child_count integer
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.user_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    coalesce(c.specialty, 'unspecified') as specialty,
    (
      select count(*)::integer from public.clinician_access ca
      where ca.clinician_id = s.user_id
        and ca.engaged_by = 'institution'
        and ca.engaged_by_institution_id = p_institution_id
        and ca.is_active = true
    ) as covered_child_count
  from public.institution_staff s
  join auth.users u on u.id = s.user_id
  join public.institutions inst on inst.id = s.institution_id
  left join public.clinicians c on c.user_id = s.user_id
  where s.institution_id = p_institution_id
    and s.role in ('clinician', 'principal', 'clinical_lead')
    and inst.type = 'clinic'
    and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    and (
      exists (
        select 1 from public.institution_staff caller
        where caller.institution_id = p_institution_id
          and caller.user_id = auth.uid()
          and caller.role = 'principal'
          and public.institution_staff_has_current_standing(caller.user_id, caller.institution_id)
      )
      or exists (
        select 1 from public.institution_staff caller
        where caller.institution_id = p_institution_id
          and caller.user_id = auth.uid()
          and caller.role = 'clinical_lead'
          and public.institution_staff_has_current_standing(caller.user_id, caller.institution_id)
      )
    )
  order by full_name;
$$;

-- ===========================================================================
-- 4. get_pending_tag_change_requests_for_lead() -- the lead-scoped
--    equivalent of get_pending_tag_change_requests(), filtered to
--    exactly what approve_tag_change_request() would let this same
--    caller decide.
-- ===========================================================================

create or replace function public.get_pending_tag_change_requests_for_lead(p_institution_id uuid)
returns table (
  request_id uuid,
  episode_id uuid,
  passport_id uuid,
  child_name text,
  requested_by uuid,
  requested_at timestamptz,
  base_tags jsonb,
  proposed_tags jsonb,
  reason text
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_caller_staff_id uuid;
begin
  select s.id into v_caller_staff_id
  from public.institution_staff s
  where s.institution_id = p_institution_id
    and s.user_id = auth.uid()
    and s.role = 'clinical_lead'
    and public.institution_staff_has_current_standing(s.user_id, s.institution_id);

  if v_caller_staff_id is null then
    raise exception 'Only an active clinical lead can see this.';
  end if;

  if not exists (
    select 1 from public.institutions inst
    where inst.id = p_institution_id and inst.lead_can_approve_non_scoping_tag_changes
  ) then
    return;
  end if;

  return query
  select r.id, r.episode_id, e.passport_id, p.child_name, r.requested_by, r.requested_at, r.base_tags, r.proposed_tags, r.reason
  from public.tag_change_requests r
  join public.episodes_of_care e on e.id = r.episode_id
  join public.passports p on p.id = e.passport_id
  where e.institution_id = p_institution_id
    and r.status = 'pending'
    and not public._tag_change_touches_scoping_dimension(p_institution_id, r.base_tags, r.proposed_tags)
    and public._lead_episode_in_scope(v_caller_staff_id, e.id)
  order by r.requested_at asc;
end;
$$;

grant execute on function public.get_pending_tag_change_requests_for_lead(uuid) to authenticated;
