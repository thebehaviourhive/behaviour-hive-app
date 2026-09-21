-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- FOUND LIVE, PROVING "A DIRECTOR ASSIGNS THEMSELVES A CLIENT" --
-- 21 Sept 2026, same pass as 0266/0267. The roster-based caseload
-- picker (get_institution_roster_clinicians_for_caseload, 0264) and
-- the grant RPC it feeds (bulk_grant_clinician_access's own roster
-- path, 0224) both filter the ROSTER TARGET to institution_staff
-- role = 'clinician' only. A verified director or lead
-- (is_verified_clinician() now true via select_director_specialty(),
-- 0266) holds role = 'principal'/'clinical_lead' at institution_staff,
-- not 'clinician' -- so neither function has ever listed them as a
-- selectable roster member, and the grant RPC would refuse them even
-- if a client somehow supplied their id directly. There was, until
-- this migration, no mechanism at all for a director or lead to hold
-- their own caseload.
--
-- THE FIX IS NARROW: widen which ROSTER MEMBERS can be picked/granted,
-- from 'clinician' to 'clinician'/'principal'/'clinical_lead'. NOTHING
-- about WHO MAY DO THE ASSIGNING changes -- both functions' own caller
-- check stays principal-only, exactly as it already is for every other
-- practitioner's caseload. This matches the existing authority model
-- precisely, rather than inventing new authority nobody asked for: a
-- director already assigns caseload to their own roster clinicians;
-- this just widens WHO can appear on that roster to include the
-- director's own row (making self-assignment possible, since the
-- caller and the target can be the same person) and a clinical_lead's
-- row (assigned BY the director, the same way every other practitioner
-- already is -- clinical_lead gains no new authority to assign anyone,
-- including themselves).
--
-- Both are CREATE OR REPLACE on their existing signature -- no DROP
-- needed, no caller changes, no client-side change either (the roster
-- picker already renders whatever this RPC returns).

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
    and exists (
      select 1 from public.institution_staff caller
      where caller.institution_id = p_institution_id
        and caller.user_id = auth.uid()
        and caller.role = 'principal'
        and public.institution_staff_has_current_standing(caller.user_id, caller.institution_id)
    )
  order by full_name;
$$;

create or replace function public.bulk_grant_clinician_access(
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
    -- Widened this migration to also admit a director or lead's own
    -- row -- see this migration's own header for why.
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
        and s.role in ('clinician', 'principal', 'clinical_lead')
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
