-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- THE MOST SERIOUS FINDING OF THIS BUILD. An SNA-created incident got
-- owning_teacher_id = null, permanently -- can_own_incident() (0107)
-- is class_teacher/principal/active-temp-grant only, SNA is not
-- eligible, and create_incident_stamp() (0105) only ever set
-- owning_teacher_id to the CREATOR, never anyone else. The live edit
-- policy on incidents ("Owning teacher can edit before teacher sign-
-- off", 0069, tightened 0105) requires owning_teacher_id = auth.uid()
-- in its USING clause, which null can never satisfy for anyone.
-- resolve_lapsed_incident_ownership() (0107/0132) does NOT catch this
-- -- it only reassigns an incident that HAD an eligible owner who later
-- lapsed (its own where clause requires owning_teacher_id is not
-- null), never one that never had one. The result: every write to that
-- incident and everything attached to it -- children, staff, actions,
-- restrictive practices, injuries, body marks -- silently failed,
-- forever, for anyone, with no client-visible error (RLS on UPDATE
-- filters, it doesn't error -- CLAUDE.md's own first documented
-- gotcha). The narrative, the injuries, the restrictive practice --
-- written, and lost, with the person who wrote it believing it exists.
-- Special schools are exactly where an SNA is most likely to be the
-- adult present.
--
-- PRODUCTION CHECK: queried before writing this migration. Zero
-- incidents currently exist with owning_teacher_id is null. Nothing
-- known to have been lost. No retrospective backfill needed -- this is
-- a forward fix only.
--
-- THE FIX: auto-assign an eligible owner at creation, in order:
--   1. The creator themselves, if eligible (unchanged -- the
--      overwhelmingly common case, a class teacher or principal
--      recording their own incident).
--   2. The current class teacher of a named child, if there is one and
--      they're eligible -- children checked in the order given (child A
--      before child B), and where a class has more than one active
--      teacher position, checked lowest position first.
--   3. The institution's principal -- matching resolve_lapsed_incident_
--      ownership()'s own precedent of "the principal is the fallback of
--      last resort", extended to cover the case that function was never
--      built for.
--
-- Deliberately NOT widening can_own_incident() to include SNA -- that
-- grants sign-off authority, which is a teacher's own responsibility,
-- and this bug is not a reason to change who signs off. Deliberately
-- NOT a required co-creator -- that blocks the fifteen-second stamp,
-- which exists precisely because the person recording has just handled
-- a crisis. If even the principal fallback somehow finds nobody (no
-- principal at this institution at all -- shouldn't be reachable given
-- the one-principal invariant, but this must never be what blocks
-- incident creation), owning_teacher_id stays null exactly as before --
-- the fifteen-second stamp is never refused for this reason.
--
-- CREATE OR REPLACE is sufficient -- same signature, same return type,
-- only the owner-resolution logic inside changes.

create or replace function public.create_incident_stamp(
  p_institution_id uuid,
  p_occurred_at timestamptz,
  p_location_id uuid,
  p_child_passport_ids uuid[],
  p_staff jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_incident_id uuid;
  v_child_count integer;
  v_child_index text;
  v_passport_id uuid;
  v_i integer;
  v_staff_entry jsonb;
  v_user_id uuid;
  v_free_text_name text;
  v_involvement text;
  v_owning_teacher_id uuid;
  v_candidate_teacher_id uuid;
begin
  select role into v_caller_role
  from public.institution_staff
  where institution_id = p_institution_id
    and user_id = auth.uid()
    and deactivated_at is null
    and approved_at is not null;

  if v_caller_role is null or v_caller_role not in ('class_teacher', 'sna', 'principal') then
    raise exception 'You are not registered as school staff at this institution.';
  end if;

  if p_child_passport_ids is null or array_length(p_child_passport_ids, 1) is null or array_length(p_child_passport_ids, 1) = 0 then
    raise exception 'At least one child is required.';
  end if;
  v_child_count := array_length(p_child_passport_ids, 1);
  if v_child_count > 2 then
    raise exception 'An incident can name at most two children.';
  end if;

  -- Owner resolution -- see this migration's own header for the full
  -- reasoning and ordering.
  if public.can_own_incident(auth.uid(), p_institution_id) then
    v_owning_teacher_id := auth.uid();
  else
    v_owning_teacher_id := null;

    for v_i in 1 .. array_length(p_child_passport_ids, 1)
    loop
      select ct.user_id into v_candidate_teacher_id
      from public.class_children cc
      join public.class_teachers ct on ct.class_id = cc.class_id
      where cc.passport_id = p_child_passport_ids[v_i]
        and cc.ended_at is null
        and ct.ended_at is null
        and public.can_own_incident(ct.user_id, p_institution_id)
      order by ct.position asc
      limit 1;

      if v_candidate_teacher_id is not null then
        v_owning_teacher_id := v_candidate_teacher_id;
        exit;
      end if;
    end loop;

    if v_owning_teacher_id is null then
      select user_id into v_owning_teacher_id
      from public.institution_staff
      where institution_id = p_institution_id
        and role = 'principal'
        and deactivated_at is null
        and approved_at is not null
      limit 1;
    end if;
  end if;

  v_incident_id := gen_random_uuid();

  insert into public.incidents (id, institution_id, created_by, owning_teacher_id, occurred_at, location_id)
  values (
    v_incident_id, p_institution_id, auth.uid(), v_owning_teacher_id,
    p_occurred_at, p_location_id
  );

  v_i := 0;
  foreach v_passport_id in array p_child_passport_ids
  loop
    if not exists (
      select 1 from public.passport_institution_links pil
      where pil.passport_id = v_passport_id and pil.institution_id = p_institution_id
    ) then
      raise exception 'Child % is not connected to this institution.', v_passport_id;
    end if;

    v_child_index := case when v_i = 0 then 'A' else 'B' end;
    insert into public.incident_children (incident_id, passport_id, child_index, added_by)
    values (v_incident_id, v_passport_id, v_child_index, auth.uid());
    v_i := v_i + 1;
  end loop;

  if p_staff is not null then
    for v_staff_entry in select * from jsonb_array_elements(p_staff)
    loop
      v_user_id := nullif(v_staff_entry ->> 'user_id', '')::uuid;
      v_free_text_name := nullif(v_staff_entry ->> 'free_text_name', '');
      v_involvement := coalesce(nullif(v_staff_entry ->> 'involvement', ''), 'involved');

      if v_user_id is null and v_free_text_name is null then
        raise exception 'Each staff entry needs either user_id or free_text_name.';
      end if;
      if v_involvement not in ('involved', 'witnessed') then
        raise exception 'Invalid involvement value: %', v_involvement;
      end if;

      insert into public.incident_staff (incident_id, user_id, free_text_name, involvement)
      values (v_incident_id, v_user_id, v_free_text_name, v_involvement);
    end loop;
  end if;

  return v_incident_id;
end;
$$;

grant execute on function public.create_incident_stamp(uuid, timestamptz, uuid, uuid[], jsonb) to authenticated;
