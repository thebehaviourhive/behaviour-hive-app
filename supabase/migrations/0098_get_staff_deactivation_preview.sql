-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- STAFF LIFECYCLE STAGE 1, part 2: get_staff_deactivation_preview() -- the
-- leaving checklist's data source. Principal-only, same authorization
-- shape as deactivate_institution_staff() itself, read-only. Three lists:
-- incidents they own that aren't signed off, attestations outstanding
-- against them (named, real account, status='not_attested' -- a
-- free-text-only entry has no user_id and can never match here, so it's
-- excluded structurally, not by a special case), and children they
-- currently hold an active passport_access grant for at this institution
-- -- the real list, now that deactivate_institution_staff()'s own cascade
-- (0097) makes it consequential rather than empty.

create or replace function public.get_staff_deactivation_preview(p_institution_staff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.institution_staff;
  v_caller_is_active_principal boolean;
  v_unsigned_incidents jsonb;
  v_outstanding_attestations jsonb;
  v_active_children jsonb;
begin
  select * into v_target from public.institution_staff where id = p_institution_staff_id;
  if not found then
    raise exception 'Staff member not found.';
  end if;

  select exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.user_id = auth.uid()
      and s.institution_id = v_target.institution_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and inst.status = 'verified'
  ) into v_caller_is_active_principal;

  if not v_caller_is_active_principal then
    raise exception 'Only an active principal at this institution can preview this.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'incident_id', i.id, 'occurred_at', i.occurred_at, 'status', i.status
  ) order by i.occurred_at), '[]'::jsonb)
  into v_unsigned_incidents
  from public.incidents i
  where i.institution_id = v_target.institution_id
    and i.owning_teacher_id = v_target.user_id
    and i.teacher_signed_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'incident_id', i.id, 'occurred_at', i.occurred_at
  ) order by i.occurred_at), '[]'::jsonb)
  into v_outstanding_attestations
  from public.incident_staff st
  join public.incidents i on i.id = st.incident_id
  where i.institution_id = v_target.institution_id
    and st.user_id = v_target.user_id
    and public.get_attestation_status(st.id) = 'not_attested';

  select coalesce(jsonb_agg(jsonb_build_object(
    'passport_id', p.id, 'child_name', p.child_name
  ) order by p.child_name), '[]'::jsonb)
  into v_active_children
  from public.passport_access pa
  join public.passports p on p.id = pa.passport_id
  where pa.institution_id = v_target.institution_id
    and pa.teacher_id = v_target.user_id
    and pa.is_active = true;

  return jsonb_build_object(
    'unsigned_incidents', v_unsigned_incidents,
    'outstanding_attestations', v_outstanding_attestations,
    'active_children', v_active_children
  );
end;
$$;

grant execute on function public.get_staff_deactivation_preview(uuid) to authenticated;
