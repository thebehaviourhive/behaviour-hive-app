-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Bulk clinician assignment (Directory's fifth segment). Three functions.
-- Underneath, nothing changes: every engagement is still one
-- clinician_access row (0123). This is a better UI over the mechanism
-- that already exists, not a new access source -- no new table, no new
-- column, no change to revocation, the two-authority rule, or the
-- parent's own engagements.
--
-- 1. get_institution_clinicians() -- the left pane: every clinician this
--    school has engaged, with how many children they currently cover.
-- 2. get_institution_clinician_coverage() -- the right pane: every
--    currently-enrolled child at this school, and whether the selected
--    clinician covers them. Both covered and uncovered children, by
--    design -- a list of who's covered says nothing about who isn't.
-- 3. bulk_grant_clinician_access() -- the write. Loops the selected
--    children server-side and returns one outcome per child --
--    'granted' / 'already_active' / 'skipped_parent_engaged' /
--    'skipped_other_school' / 'skipped_not_linked' -- so a collision on
--    one child never blocks the other 29, and the client can render
--    "27 connected, 3 skipped" with names and reasons instead of parsing
--    30 individually-thrown exceptions. The per-child refusal logic is
--    grant_clinician_access()'s own (0123), copied here rather than
--    called in a loop -- plpgsql can't easily catch one RAISE per
--    iteration and keep going without an EXCEPTION block per row, and a
--    straight-line copy is what stays readable; grant_clinician_access()
--    itself is untouched and still the single-child path.
--
-- THE "ALREADY ENGAGED" AUTH PATH (Requirement 2) -- stated before
-- written, per the standing rule:
--
--   PREDICATE: an ACTIVE clinician_access row exists for this exact
--   (clinician_id, institution_id) pair, with engaged_by = 'institution'
--   -- for ANY child at this school, not necessarily the one being added.
--
--   WHY THIS AND NOT LOOSER:
--   - engaged_by_institution_id = p_institution_id, not "engaged
--     anywhere": a clinician active at a DIFFERENT school tells this
--     principal nothing -- THIS school never verified them by code, and
--     the point of the code was that THIS principal spoke to THIS
--     clinician. Scoped to this institution specifically.
--   - engaged_by = 'institution', not 'parent': a clinician who is
--     parent-engaged for one child at this school was never code-
--     verified by the SCHOOL at all -- no principal ever entered their
--     code. Accepting a parent-engaged row here would let a school grant
--     access to a clinician it has literally never verified. Must be an
--     institution-side row specifically.
--   - is_active = true, not "ever existed": a revoked engagement means
--     the relationship ended. Trust doesn't survive revocation -- if
--     every row for this clinician at this school has been revoked, a
--     fresh code is required again, same as engaging them the first
--     time.
--   - "for ANY child", not "for this specific child": the code-
--     verification event authenticates the CLINICIAN'S IDENTITY to this
--     school, not a specific child relationship -- once a school has
--     verified a clinician via their code for one child, that
--     verification doesn't need repeating per child. The specific-child
--     question (is this child free to be covered by them) is a
--     SEPARATE check, still applied per child inside the loop below,
--     unchanged from grant_clinician_access()'s own logic.
--   - re-checks clinicians.verification_status = 'verified' explicitly:
--     the code path re-verifies this at lookup time on every call
--     (clinicians.clinician_code = code and verification_status =
--     'verified'); without the same check here, a clinician whose
--     verification was later revoked could still be granted more
--     children via this path even though a fresh code lookup would now
--     fail. Kept equivalent to the code path deliberately, not just as
--     strong in the institution-engagement clause.
--
--   This is exactly as strong as the code path, not weaker: it can only
--   ever succeed by pointing at a row that the code path itself created
--   in the first place. It cannot be bootstrapped by a revoked row, a
--   parent-engaged row, or an engagement at a different school.

-- =====================================================================
-- 1. get_institution_clinicians() -- left pane list.
-- =====================================================================

create or replace function public.get_institution_clinicians(p_institution_id uuid)
returns table (
  clinician_id uuid,
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
    c.user_id as clinician_id,
    c.full_name,
    c.specialty,
    count(*)::integer as covered_child_count
  from public.clinician_access ca
  join public.clinicians c on c.user_id = ca.clinician_id
  where ca.engaged_by = 'institution'
    and ca.engaged_by_institution_id = p_institution_id
    and ca.is_active = true
    and c.verification_status = 'verified'
    and exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and inst.status = 'verified'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  group by c.user_id, c.full_name, c.specialty
  order by c.full_name;
$$;

grant execute on function public.get_institution_clinicians(uuid) to authenticated;

-- =====================================================================
-- 2. get_institution_clinician_coverage() -- right pane. Every
--    currently-enrolled child (enrolment_ended_at is null, same lateral
--    "most recent enrolment row" resolution get_institution_child_
--    roster() (0129) already uses), covered or not.
--
--    FOUND DURING VERIFICATION, before any client code: the first
--    version of this function returned a bare is_covered boolean --
--    "does an active clinician_access row exist for this clinician and
--    child", regardless of engaged_by. That conflates a PARENT-engaged
--    row with a school-engaged one. Concretely: a child whose parent had
--    independently connected this same clinician came back
--    is_covered=true, indistinguishable from a child the school itself
--    granted -- a principal would see that row as "already covered" with
--    no signal it isn't theirs to act on, and would only discover the
--    difference when a bulk-select on it came back skipped_parent_
--    engaged from the write RPC. Fixed by returning WHO covers the
--    child, not just whether: coverage_source is 'institution' (this
--    school granted it -- actionable, matches an is_covered=true
--    checkbox), 'parent' (covered, but not this school's to grant or
--    revoke -- shown, not selectable), or null (not covered at all --
--    available to select). clinician_access_id is returned for both
--    covered cases as information only; revoke_clinician_access() still
--    independently re-checks authority regardless of what id a caller
--    holds, so returning it here grants no new capability.
-- =====================================================================

-- CREATE OR REPLACE cannot change a RETURNS TABLE column list, and the
-- first version of this function already ran (is_covered boolean) --
-- drop first, matching every prior instance of this exact trap.
drop function if exists public.get_institution_clinician_coverage(uuid, uuid);

create function public.get_institution_clinician_coverage(
  p_institution_id uuid,
  p_clinician_id uuid
)
returns table (
  passport_id uuid,
  child_name text,
  coverage_source text,
  clinician_access_id uuid
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id as passport_id,
    p.child_name,
    ca.engaged_by as coverage_source,
    ca.id as clinician_access_id
  from public.passports p
  join public.passport_institution_links pil on pil.passport_id = p.id
  left join lateral (
    select en.ended_at
    from public.enrolments en
    where en.passport_id = p.id
      and en.institution_id = p_institution_id
    order by en.started_at desc
    limit 1
  ) e on true
  left join public.clinician_access ca
    on ca.passport_id = p.id
    and ca.clinician_id = p_clinician_id
    and ca.is_active = true
  where pil.institution_id = p_institution_id
    and e.ended_at is null
    and exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and inst.status = 'verified'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  order by p.child_name;
$$;

grant execute on function public.get_institution_clinician_coverage(uuid, uuid) to authenticated;

-- =====================================================================
-- 3. bulk_grant_clinician_access() -- the write. Exactly one of
--    p_clinician_code (first engagement) / p_clinician_id (the
--    already-engaged path, predicate above) must be provided.
-- =====================================================================

create or replace function public.bulk_grant_clinician_access(
  p_institution_id uuid,
  p_passport_ids uuid[],
  p_clinician_code text default null,
  p_clinician_id uuid default null
)
returns table (
  passport_id uuid,
  status text,
  message text,
  clinician_access_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinician_id uuid;
  v_passport_id uuid;
  v_existing public.clinician_access;
  v_row_id uuid;
begin
  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and inst.status = 'verified'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'Only an active, verified principal can connect a clinician for their school.';
  end if;

  if p_passport_ids is null or array_length(p_passport_ids, 1) is null then
    raise exception 'At least one child must be selected.';
  end if;

  if (p_clinician_code is null) = (p_clinician_id is null) then
    raise exception 'Provide exactly one of a clinician code or an already-engaged clinician.';
  end if;

  if p_clinician_code is not null then
    select c.user_id into v_clinician_id
    from public.clinicians c
    where c.clinician_code = p_clinician_code
      and c.verification_status = 'verified';

    if v_clinician_id is null then
      raise exception 'We couldn''t find a clinician with that code. Please check with them and try again.';
    end if;
  else
    -- THE "ALREADY ENGAGED" PATH -- see the migration header for the
    -- predicate and why each clause is required for it to be genuinely
    -- equivalent authority to the code path, not weaker.
    if not exists (
      select 1 from public.clinicians c
      where c.user_id = p_clinician_id and c.verification_status = 'verified'
    ) then
      raise exception 'This clinician is no longer verified. A new code is required to connect them.';
    end if;

    if not exists (
      select 1 from public.clinician_access ca
      where ca.clinician_id = p_clinician_id
        and ca.engaged_by = 'institution'
        and ca.engaged_by_institution_id = p_institution_id
        and ca.is_active = true
    ) then
      raise exception 'This clinician is not currently engaged at your school. A code is required to connect them for the first time.';
    end if;

    v_clinician_id := p_clinician_id;
  end if;

  foreach v_passport_id in array p_passport_ids
  loop
    if not exists (
      select 1 from public.passport_institution_links pil
      where pil.passport_id = v_passport_id and pil.institution_id = p_institution_id
    ) then
      passport_id := v_passport_id;
      status := 'skipped_not_linked';
      message := 'This child has no link to your institution.';
      clinician_access_id := null;
      return next;
      continue;
    end if;

    select * into v_existing
    from public.clinician_access ca
    where ca.passport_id = v_passport_id and ca.clinician_id = v_clinician_id;

    if found then
      -- THE DOUBLE-ENGAGEMENT REFUSAL, both directions -- same logic as
      -- grant_clinician_access() (0123), per-child instead of fatal.
      if v_existing.engaged_by = 'parent' then
        passport_id := v_passport_id;
        status := 'skipped_parent_engaged';
        message := 'Already connected by this child''s own parent or guardian.';
        clinician_access_id := null;
        return next;
        continue;
      end if;

      if v_existing.engaged_by_institution_id <> p_institution_id then
        passport_id := v_passport_id;
        status := 'skipped_other_school';
        message := 'Connected by a different school for this child.';
        clinician_access_id := null;
        return next;
        continue;
      end if;

      if v_existing.is_active then
        passport_id := v_passport_id;
        status := 'already_active';
        message := 'Already connected.';
        clinician_access_id := v_existing.id;
        return next;
        continue;
      end if;

      update public.clinician_access
      set is_active = true,
          linked_at = now(),
          granted_by = auth.uid(),
          revoked_at = null,
          revoked_by = null,
          revocation_reason = null
      where id = v_existing.id
      returning id into v_row_id;

      passport_id := v_passport_id;
      status := 'granted';
      message := 'Connected.';
      clinician_access_id := v_row_id;
      return next;
      continue;
    end if;

    insert into public.clinician_access (passport_id, clinician_id, engaged_by, engaged_by_institution_id, granted_by)
    values (v_passport_id, v_clinician_id, 'institution', p_institution_id, auth.uid())
    returning id into v_row_id;

    passport_id := v_passport_id;
    status := 'granted';
    message := 'Connected.';
    clinician_access_id := v_row_id;
    return next;
  end loop;

  return;
end;
$$;

grant execute on function public.bulk_grant_clinician_access(uuid, uuid[], text, uuid) to authenticated;
