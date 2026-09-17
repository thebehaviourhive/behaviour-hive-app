-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Fixes a regression 0204 (PRD 5 Stage 2) introduced in itself: its own
-- CREATE OR REPLACE of hand_over_principal() silently dropped four keys
-- from the function's returned jsonb -- handed_over, outcome,
-- successor_institution_staff_id, predecessor_new_institution_staff_id
-- -- keeping only handover_id and grants_revoked. Found by the full
-- adversarial suite crashing in CHECK X: that check reads
-- successor_institution_staff_id off the RPC's own return value to look
-- up the successor's new institution_staff row, got undefined, and the
-- next line threw reading a property off the resulting null row.
--
-- CLAUDE.md already has an entry for exactly this failure mode ("WHEN A
-- FUNCTION'S RETURN CONTRACT CHANGES, UPDATE ITS CALLERS IN THE SAME
-- PASS") -- this migration is that rule applied to the migration that
-- broke it. The fix is the function, not the check: a caller reading
-- `data` today would have silently broken, and the only reason nothing
-- live did is that the one real client caller (HandOverPrincipalSheet.tsx)
-- happens to destructure only `{ error }`. That's luck, not a reason to
-- narrow the contract going forward.
--
-- Everything else about 0204's own rewrite (the type-aware valid-
-- staying-roles logic, the dynamic error message) is untouched -- only
-- the final RETURN statement changes, back to the full six-key shape
-- 0102 originally shipped.

create or replace function public.hand_over_principal(
  p_successor_user_id uuid,
  p_outcome text,
  p_staying_role text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_predecessor public.institution_staff;
  v_successor public.institution_staff;
  v_institution_id uuid;
  v_institution_type text;
  v_valid_staying_roles text[];
  v_predecessor_new_id uuid;
  v_successor_new_id uuid;
  v_handover_id uuid;
  v_grants_revoked integer := 0;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required to hand over the principal role.';
  end if;

  if p_outcome not in ('leaving', 'staying') then
    raise exception 'Outcome must be either ''leaving'' or ''staying''.';
  end if;

  select s.* into v_predecessor
  from public.institution_staff s
  join public.institutions inst on inst.id = s.institution_id
  where s.user_id = auth.uid()
    and s.role = 'principal'
    and s.deactivated_at is null
    and s.approved_at is not null
    and inst.status = 'verified'
  limit 1;

  if not found then
    raise exception 'Only an active principal at a verified institution can hand over the principal role.';
  end if;

  v_institution_id := v_predecessor.institution_id;

  select type into v_institution_type from public.institutions where id = v_institution_id;
  v_valid_staying_roles := case
    when v_institution_type = 'clinic' then array['clinician', 'clinical_lead', 'clinic_admin']
    else array['class_teacher', 'sna']
  end;

  if p_outcome = 'staying' and (p_staying_role is null or not (p_staying_role = any(v_valid_staying_roles))) then
    raise exception 'When staying, the new role must be one of: %', array_to_string(v_valid_staying_roles, ', ');
  end if;

  if p_outcome = 'leaving' and p_staying_role is not null then
    raise exception 'A staying role must not be provided when the outcome is leaving.';
  end if;

  if p_successor_user_id = auth.uid() then
    raise exception 'You cannot hand over the principal role to yourself.';
  end if;

  select * into v_successor
  from public.institution_staff s
  where s.user_id = p_successor_user_id
    and s.institution_id = v_institution_id
    and s.deactivated_at is null
    and s.approved_at is not null;

  if not found then
    raise exception 'The person you are handing over to must be an active staff member at this institution.';
  end if;

  update public.institution_staff
  set deactivated_at = now(),
      deactivated_by = auth.uid(),
      deactivation_reason = p_reason
  where id = v_predecessor.id;

  if p_outcome = 'leaving' then
    v_grants_revoked := public._close_child_access_for_departure(auth.uid(), v_institution_id, auth.uid());
  else
    insert into public.institution_staff (institution_id, user_id, role)
    values (v_institution_id, auth.uid(), p_staying_role)
    returning id into v_predecessor_new_id;

    update public.institution_staff
    set approved_at = now(), approved_by = auth.uid(), approval_source = 'handover'
    where id = v_predecessor_new_id;
  end if;

  update public.institution_staff
  set deactivated_at = now(),
      deactivated_by = auth.uid(),
      deactivation_reason = 'Role changed to principal via institution handover.'
  where id = v_successor.id;

  insert into public.institution_staff (institution_id, user_id, role)
  values (v_institution_id, p_successor_user_id, 'principal')
  returning id into v_successor_new_id;

  update public.institution_staff
  set approved_at = now(), approved_by = auth.uid(), approval_source = 'handover'
  where id = v_successor_new_id;

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'principal')
  where id = p_successor_user_id;

  if p_outcome = 'staying' then
    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', p_staying_role)
    where id = auth.uid();
  end if;

  insert into public.principal_handovers (
    institution_id, predecessor_user_id, successor_user_id, outcome, staying_role, reason,
    predecessor_institution_staff_id, predecessor_new_institution_staff_id,
    successor_old_institution_staff_id, successor_new_institution_staff_id
  )
  values (
    v_institution_id, auth.uid(), p_successor_user_id, p_outcome, p_staying_role, p_reason,
    v_predecessor.id, v_predecessor_new_id,
    v_successor.id, v_successor_new_id
  )
  returning id into v_handover_id;

  return jsonb_build_object(
    'handed_over', true,
    'outcome', p_outcome,
    'handover_id', v_handover_id,
    'successor_institution_staff_id', v_successor_new_id,
    'predecessor_new_institution_staff_id', v_predecessor_new_id,
    'grants_revoked', v_grants_revoked
  );
end;
$$;

grant execute on function public.hand_over_principal(uuid, text, text, text) to authenticated;
