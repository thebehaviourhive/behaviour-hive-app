-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- THE ATTESTATION SIGN-OFF RACE (found live, real production data,
-- 7 September 2026). A principal created and named a real class teacher
-- on a restraint incident, requested attestations, then signed off
-- ~3 minutes later -- before the named teacher had any real chance to
-- respond. attest_to_incident() already refuses once teacher_signed_at
-- is set (0164), and get_my_incident_attestations()/get_my_incident_
-- attestation_issues() both filter out closed incidents entirely
-- (teacher/dashboard/page.tsx:304, teacher/incidents/attestations/
-- page.tsx:103) -- so the request became permanently unfulfillable AND
-- invisible in the same moment, with nothing anywhere distinguishing
-- "nobody was ever asked" from "asked, then the window closed".
--
-- incident_signoff_issues() (0085) deliberately does not block sign-off
-- on a never-attested named staff member -- its own message says so:
-- "A staff member who has simply never attested does not block
-- sign-off." That stays correct for a record where nobody was asked at
-- all. The fix here is narrower and only applies when attestations_
-- requested is true: sign-off is soft-blocked (refused by default,
-- proceedable on an explicit second confirmation) rather than either a
-- hard block or a silent pass-through -- Daniel's own call, over a
-- genuine hard-block alternative: "a teacher who needs to close a
-- record should be able to, but 'signed off with 2 attestations
-- outstanding' is a fact a principal should see, not a silence."
--
-- Four changes:
--   1. incidents.signed_off_with_outstanding_attestations -- a plain
--      boolean, set once, at sign-off, by sign_off_incident() itself.
--      Sufficient on its own (no need to snapshot WHO): attest_to_
--      incident() already refuses post-signoff, so a row's attestation
--      status can never change again once this flag is true -- the
--      existing incident_staff/incident_attestations tables remain the
--      permanent, queryable record of exactly who.
--   2. sign_off_incident() widened with p_proceed_without_attestations
--      (DROP + CREATE -- this schema's own established rule for a new
--      trailing parameter, never bare CREATE OR REPLACE, per send_
--      message()'s own documented near-miss). Refuses by default when
--      attestations_requested is true and a named, non-owner staff
--      member's attestation is genuinely outstanding; proceeds and
--      records the flag when the caller explicitly says so.
--   3. get_incident_signoff_summary() gains attestations_requested in
--      its own jsonb -- the client already computes "not yet attested"
--      from staff_attestations, but cannot currently tell that case
--      apart from "nobody was ever asked", which must never trigger
--      the new explicit-confirm step.
--   4. get_institution_incidents_signed_off_with_outstanding_
--      attestations() -- new, mirrors get_institution_withdrawn_
--      attestations()'s own shape exactly, for the principal's
--      dashboard "Routine" bucket (a fact to review, not an urgent
--      action -- matching how awaiting-signoff/outstanding-debrief
--      already render there, not the urgent parent-call/withdrawn-
--      attestation shape).
--   5. get_countersign_summary() gains the same flag, for the specific
--      incident's own countersign screen -- so it's visible there too,
--      not only on the dashboard list.

alter table public.incidents
  add column signed_off_with_outstanding_attestations boolean not null default false;

-- =====================================================================
-- 1. sign_off_incident() -- widened. DROP + CREATE (new trailing param).
-- =====================================================================

drop function if exists public.sign_off_incident(uuid);

create or replace function public.sign_off_incident(
  p_incident_id uuid,
  p_proceed_without_attestations boolean default false
)
returns public.incidents
language plpgsql
as $$
declare
  v_incident public.incidents;
  v_after public.incidents;
  v_outstanding_count integer := 0;
begin
  select * into v_incident from public.incidents where id = p_incident_id;

  if not found then
    raise exception 'Incident not found, or you do not have permission to view it.';
  end if;

  if v_incident.teacher_signed_at is not null then
    raise exception 'This incident has already been signed off.';
  end if;

  -- Only ever checked when attestations were genuinely requested -- a
  -- record where nobody was asked stays exactly as permissive as
  -- incident_signoff_issues() already made it (0085's own rule,
  -- unchanged). Stale/withdrawn attestations are still a HARD block,
  -- unaffected by this -- that's enforced separately, by the existing
  -- guard triggers calling incident_signoff_issues(), before this
  -- function's own UPDATE below is even attempted.
  if v_incident.attestations_requested then
    select count(*) into v_outstanding_count
    from public.incident_staff st
    where st.incident_id = p_incident_id
      and st.user_id is not null
      and st.user_id is distinct from v_incident.owning_teacher_id
      and public.get_attestation_status(st.id) = 'not_attested';

    if v_outstanding_count > 0 and not p_proceed_without_attestations then
      raise exception '% named staff member(s) have not yet attested. Sign off anyway, or wait for them to respond.', v_outstanding_count;
    end if;
  end if;

  update public.incidents
  set
    teacher_signed_at = now(),
    teacher_signed_by = auth.uid(),
    signed_off_with_outstanding_attestations = (v_outstanding_count > 0)
  where id = p_incident_id
  returning * into v_after;

  if not found then
    raise exception 'Sign-off failed -- only this incident''s creator or owning teacher can sign it off.';
  end if;

  return v_after;
end;
$$;

grant execute on function public.sign_off_incident(uuid, boolean) to authenticated;

-- =====================================================================
-- 2. get_incident_signoff_summary() -- CREATE OR REPLACE is fine here,
--    returns jsonb, no signature change. Adds attestations_requested
--    so the client can gate the new confirm step correctly (never on
--    "nobody was ever asked", only on a genuine outstanding request).
-- =====================================================================

create or replace function public.get_incident_signoff_summary(p_incident_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_incident public.incidents;
  v_staff jsonb;
  v_issues jsonb;
begin
  select * into v_incident from public.incidents where id = p_incident_id;
  if not found then
    raise exception 'Incident not found, or you do not have permission to view it.';
  end if;

  if not (v_incident.created_by = auth.uid() or v_incident.owning_teacher_id = auth.uid()) then
    raise exception 'Only this incident''s creator or owning teacher can view its sign-off summary.';
  end if;

  if v_incident.teacher_signed_at is not null then
    raise exception 'This incident has already been signed off.';
  end if;

  v_staff := public.build_staff_attestations_summary(p_incident_id);
  v_issues := public.incident_signoff_issues(v_incident);

  return jsonb_build_object(
    'can_sign_off', jsonb_array_length(v_issues) = 0,
    'blocking_issues', v_issues,
    'staff_attestations', v_staff,
    'attestations_requested', v_incident.attestations_requested,
    'anyone_injured', jsonb_build_object(
      'value', v_incident.anyone_injured,
      'note', case when v_incident.anyone_injured is null then 'not recorded' else null end
    )
  );
end;
$function$;

-- =====================================================================
-- 3. get_countersign_summary() -- same treatment, so the flag is
--    visible on the specific incident's own countersign screen too.
-- =====================================================================

create or replace function public.get_countersign_summary(p_incident_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_incident public.incidents;
  v_staff jsonb;
  v_teacher_name text;
  v_countersigner_name text;
begin
  select * into v_incident from public.incidents where id = p_incident_id;
  if not found then
    raise exception 'Incident not found, or you do not have permission to view it.';
  end if;

  if v_incident.teacher_signed_at is null then
    raise exception 'This incident has not yet been signed off by its teacher.';
  end if;

  if not public.can_countersign_incident(auth.uid(), v_incident.institution_id) then
    raise exception 'Only someone who can countersign this incident may view its countersign summary.';
  end if;

  v_staff := public.build_staff_attestations_summary(p_incident_id);

  select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name')
  into v_teacher_name
  from auth.users u
  where u.id = v_incident.teacher_signed_by;

  if v_incident.countersigned_by is not null then
    select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name')
    into v_countersigner_name
    from auth.users u
    where u.id = v_incident.countersigned_by;
  end if;

  return jsonb_build_object(
    'staff_attestations', v_staff,
    'teacher_signed_at', v_incident.teacher_signed_at,
    'teacher_signed_by_name', v_teacher_name,
    'signed_off_with_outstanding_attestations', v_incident.signed_off_with_outstanding_attestations,
    'anyone_injured', jsonb_build_object(
      'value', v_incident.anyone_injured,
      'note', case when v_incident.anyone_injured is null then 'not recorded' else null end
    ),
    'already_countersigned', v_incident.countersigned_at is not null,
    'countersigned_at', v_incident.countersigned_at,
    'countersigned_by_name', v_countersigner_name,
    'countersigned_role_at_time', v_incident.countersigned_role_at_time,
    'countersigned_via', v_incident.countersigned_via
  );
end;
$function$;

-- =====================================================================
-- 4. get_institution_incidents_signed_off_with_outstanding_
--    attestations() -- new. Mirrors get_institution_withdrawn_
--    attestations()'s own shape (0134).
-- =====================================================================

create or replace function public.get_institution_incidents_signed_off_with_outstanding_attestations(p_institution_id uuid)
returns table (
  incident_id uuid,
  occurred_at timestamptz,
  location text,
  teacher_signed_at timestamptz,
  teacher_signed_by_name text,
  outstanding_count bigint,
  outstanding_names text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    i.id as incident_id,
    i.occurred_at,
    loc.value as location,
    i.teacher_signed_at,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as teacher_signed_by_name,
    (
      select count(*)
      from public.incident_staff st
      where st.incident_id = i.id
        and st.user_id is not null
        and st.user_id is distinct from i.owning_teacher_id
        and public.get_attestation_status(st.id) = 'not_attested'
    ) as outstanding_count,
    (
      select string_agg(coalesce(su.raw_user_meta_data ->> 'full_name', su.raw_app_meta_data ->> 'full_name'), ', ' order by st.id)
      from public.incident_staff st
      join auth.users su on su.id = st.user_id
      where st.incident_id = i.id
        and st.user_id is not null
        and st.user_id is distinct from i.owning_teacher_id
        and public.get_attestation_status(st.id) = 'not_attested'
    ) as outstanding_names
  from public.incidents i
  join public.incident_locations loc on loc.id = i.location_id
  left join auth.users u on u.id = i.teacher_signed_by
  where i.institution_id = p_institution_id
    and i.signed_off_with_outstanding_attestations = true
    and public.can_countersign_incident(auth.uid(), p_institution_id)
  order by i.teacher_signed_at desc;
$$;

grant execute on function public.get_institution_incidents_signed_off_with_outstanding_attestations(uuid) to authenticated;
