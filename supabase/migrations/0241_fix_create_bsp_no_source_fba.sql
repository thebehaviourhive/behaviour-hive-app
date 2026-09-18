-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- A REAL, LIVE BUG, FOUND WHILE VERIFYING 0240 -- UNRELATED TO THAT
-- MIGRATION, CHASED AND FIXED BEFORE CONTINUING, NOT LEFT FOR LATER.
--
-- create_bsp(p_passport_id, p_source_fba_id) has always supported a
-- standalone plan with no source FBA -- the client's own picker
-- (ClinicalFileBspTab.tsx) explicitly offers "none" as a real, selected
-- option (selectedFbaId === "none" ? null : selectedFbaId), a genuine,
-- reachable production path, not a hypothetical.
--
-- That path has been broken since 0238 shipped. `v_fba record;` is
-- never assigned when p_source_fba_id is null (the `if p_source_fba_id
-- is not null then select into v_fba ... end if` block simply never
-- runs) -- and PL/pgSQL raises "record ... is not assigned yet" the
-- moment ANY field of an unassigned record variable is referenced,
-- which the function's own final INSERT does four times, all against
-- v_fba.content_data (three times via ->, once via ->>).
-- Every attempt to create a BSP without picking a source FBA has failed
-- outright since the day this shipped -- found here only because this
-- verification fixture is the first thing to have ever exercised that
-- branch, real or automated.
--
-- THE FIX: when there's no source FBA, explicitly assign v_fba an all-
-- null row so it becomes a genuinely assigned record (mirroring exactly
-- what the `if` branch already does for the real-FBA case), rather than
-- leaving it in PL/pgSQL's unassigned state. Nothing else in the
-- function changes -- the final INSERT's own coalesce()s were always
-- correct for a null-valued but ASSIGNED record; they just never got
-- the chance to run.

create or replace function public.create_bsp(
  p_passport_id uuid,
  p_source_fba_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_institution_id uuid;
  v_fba record;
  v_new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_verified_clinician(auth.uid()) then
    raise exception 'Only a verified clinician may create a behaviour support plan.';
  end if;

  if not exists (
    select 1 from public.clinician_access ca
    where ca.passport_id = p_passport_id
      and ca.clinician_id = auth.uid()
      and ca.is_active = true
  ) then
    raise exception 'You do not have active access to this child.';
  end if;

  select s.institution_id into v_institution_id
  from public.institution_staff s
  join public.institutions inst on inst.id = s.institution_id
  where s.user_id = auth.uid()
    and s.role = 'clinician'
    and inst.type = 'clinic'
    and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  limit 1;

  if p_source_fba_id is not null then
    select * into v_fba from public.fba_reports where id = p_source_fba_id;
    if v_fba.id is null then
      raise exception 'FBA not found.';
    end if;
    if v_fba.passport_id is distinct from p_passport_id then
      raise exception 'That FBA does not belong to this child.';
    end if;
    if v_fba.status <> 'completed' then
      raise exception 'Only a completed FBA can be carried into a plan.';
    end if;
  else
    -- FIX: an explicit assignment, so v_fba is a genuinely ASSIGNED
    -- record with a null content_data -- not PL/pgSQL's unassigned
    -- state, which raises the moment any field below is dereferenced.
    -- content_data is the only field of v_fba the INSERT below ever
    -- touches (twice via ->, once via ->>) -- matching that exactly,
    -- not inventing a shape the if-branch's own `select *` doesn't have.
    select null::jsonb as content_data into v_fba;
  end if;

  insert into public.bsp (
    passport_id, institution_id, clinician_id, source_fba_id,
    target_behaviours, triggers, setting_events, precursors
  )
  values (
    p_passport_id, v_institution_id, auth.uid(), p_source_fba_id,
    coalesce(v_fba.content_data -> 'targetBehaviours', '[]'::jsonb),
    coalesce(v_fba.content_data -> 'triggers', '[]'::jsonb),
    coalesce(v_fba.content_data -> 'settingEvents', '[]'::jsonb),
    v_fba.content_data ->> 'precursors'
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

grant execute on function public.create_bsp(uuid, uuid) to authenticated;
