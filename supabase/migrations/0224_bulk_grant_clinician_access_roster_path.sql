-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 5 Stage 6, Step 4 -- caseload assignment itself. PRD section 4:
-- "Reuse clinician_access with engaged_by = 'institution'... the bulk-
-- assign screen already does this" -- reuse the MECHANISM, but the
-- LOOKUP was never going to fit: bulk_grant_clinician_access() resolves
-- "which clinician" via clinician_code or an existing engagement, both
-- shaped for an EXTERNAL practitioner a school doesn't otherwise employ.
-- A clinic director assigning their OWN roster practitioner has neither
-- -- they know exactly who the person is, the same way a principal
-- picks a class teacher or SNA from their own roster, not by code.
--
-- THE NEW PATH: p_roster_user_id, mutually exclusive with the existing
-- two parameters (now a genuine three-way "exactly one" check, not the
-- original boolean XOR). Resolves the practitioner directly via
-- institution_staff -- role='clinician', current standing, at THIS
-- institution, which must be type='clinic' (this path is meaningless
-- for a school, which has no such thing as its own roster of
-- clinicians). is_verified_clinician() is still re-checked even though
-- 0222 means a director-approved clinic practitioner is always already
-- verified by the time they could be picked here -- defense in depth,
-- matching this migration's own established posture elsewhere, not
-- trusting a single invariant to hold forever.
--
-- NO NEW ROSTER-LISTING RPC NEEDED: get_institution_staff_roster()
-- (0097) already lists every institution_staff row with role and name;
-- filtered client-side to role='clinician', it already serves exactly
-- what a roster-picker needs. Building a second listing RPC here would
-- duplicate that for no reason.
--
-- SIGNATURE GROWS -- DROP FUNCTION IF EXISTS FIRST, per this file's own
-- standing rule (send_message()'s own two-time mistake, CLAUDE.md):
-- CREATE OR REPLACE does not collapse a longer parameter list onto a
-- shorter one, it creates a second, silent overload.
--
-- THE TWO RAW CHECKS -- fixed in the same pass, since this migration
-- already has to touch this function's full body for the signature
-- change; no reason to fix them separately first and touch the body
-- twice.

drop function if exists public.bulk_grant_clinician_access(uuid, uuid[], text, uuid);

create function public.bulk_grant_clinician_access(
  p_institution_id uuid,
  p_passport_ids uuid[],
  p_clinician_code text default null,
  p_clinician_id uuid default null,
  p_roster_user_id uuid default null
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

  if (
    (p_clinician_code is not null)::integer
    + (p_clinician_id is not null)::integer
    + (p_roster_user_id is not null)::integer
  ) <> 1 then
    raise exception 'Provide exactly one of a clinician code, an already-engaged clinician, or a roster practitioner.';
  end if;

  if p_clinician_code is not null then
    select c.user_id into v_clinician_id
    from public.clinicians c
    where c.clinician_code = p_clinician_code
      and public.is_verified_clinician(c.user_id);

    if v_clinician_id is null then
      raise exception 'We couldn''t find a clinician with that code. Please check with them and try again.';
    end if;
  elsif p_clinician_id is not null then
    -- THE "ALREADY ENGAGED" PATH -- see the original migration's own
    -- header for the predicate and why each clause is required for it
    -- to be genuinely equivalent authority to the code path, not weaker.
    if not public.is_verified_clinician(p_clinician_id) then
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
  else
    -- THE ROSTER PATH, clinic-only: the practitioner is one of this
    -- institution's own institution_staff, no code involved at all.
    if not exists (
      select 1 from public.institutions inst
      where inst.id = p_institution_id and inst.type = 'clinic'
    ) then
      raise exception 'Assigning a practitioner from your own roster is only available at a clinic.';
    end if;

    if not exists (
      select 1 from public.institution_staff s
      where s.institution_id = p_institution_id
        and s.user_id = p_roster_user_id
        and s.role = 'clinician'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    ) then
      raise exception 'This person is not an active practitioner at your clinic.';
    end if;

    if not public.is_verified_clinician(p_roster_user_id) then
      raise exception 'This practitioner is not yet verified.';
    end if;

    v_clinician_id := p_roster_user_id;
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

grant execute on function public.bulk_grant_clinician_access(uuid, uuid[], text, uuid, uuid) to authenticated;
