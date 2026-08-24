/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   RECONCILIATION, specific to this deployment's actual history -- read
   this before running, it explains why this migration exists instead of
   0070 just being re-run.

   What actually happened: the FIRST draft of 0070 (narrative-only hash,
   the sign-off gate blocking on ANY non-'current' status including a
   simple missing attestation, and Part 6 dropping
   incident_staff.attested_at/attestation_addendum plus their old policy
   in the same migration as the replacement) was run live before the
   three-point correction reached me. The 0070 file in this repo was
   then rewritten to the CORRECTED design -- but rerunning it as a plain
   CREATE TABLE ... fails with "relation incident_attestations already
   exists", because the table (in its old shape) is already there.

   This migration does NOT recreate anything from scratch. It reconciles
   the live, already-partially-run state to the corrected design:
     1. Renames incident_attestations.narrative_hash -> content_hash
        (the table is empty -- confirmed live, zero rows -- so this is a
        pure rename, nothing to migrate).
     2. Adds compute_incident_content_hash() -- didn't exist yet.
     3. Replaces get_attestation_status()/attest_to_incident() to use it
        and content_hash instead of a narrative-only hash, and adds the
        can_view_incident() visibility gate to get_attestation_status().
     4. Replaces guard_signoff_requires_current_attestations() with the
        corrected condition -- blocks on 'stale'/'withdrawn' only, not
        on a staff member who simply never attested.
     5. Restores incident_staff.attested_at/attestation_addendum
        (confirmed live: already dropped by the original draft) and the
        "Named staff can attest to their own row" policy that went with
        them -- putting the database back into the additive-only state
        that was actually asked for, so the real drop can still happen
        deliberately, later, once this corrected version is verified.
        Both are exactly as inert/dead-weight as if the original draft
        had never dropped them in the first place -- nothing in the new
        system reads them.
   withdraw_attestation() is re-created too, even though its logic
   didn't need to change, purely so every function this feature depends
   on is defined in one consistent place rather than split across two
   migration files by accident of timing. */


-- =====================================================================
-- 1. Rename the column -- table is empty, pure rename.
-- =====================================================================

alter table public.incident_attestations rename column narrative_hash to content_hash;


-- =====================================================================
-- 2. compute_incident_content_hash() -- new, didn't exist before.
-- Same field set and reasoning as presented for 0070: narrative, each
-- child's distress_level/remained_on_site, selected actions, the
-- substantive restrictive-practice fields (excluding NCSE paperwork
-- tracking), the substantive injury fields (excluding body-map markers).
-- =====================================================================

create or replace function public.compute_incident_content_hash(p_incident_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select md5(
    coalesce((
      select jsonb_build_object(
        'narrative', coalesce(i.narrative, ''),
        'children', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'child_index', ic.child_index,
              'distress_level', ic.distress_level,
              'remained_on_site', ic.remained_on_site
            ) order by ic.child_index
          )
          from public.incident_children ic
          where ic.incident_id = i.id
        ), '[]'::jsonb),
        'actions', coalesce((
          select jsonb_agg(ia.action_type_id order by ia.action_type_id)
          from public.incident_actions ia
          where ia.incident_id = i.id
        ), '[]'::jsonb),
        'restrictive_practices', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'passport_id', rp.passport_id,
              'planning_status', rp.planning_status,
              'reason_codes', rp.reason_codes,
              'disengagement_codes', rp.disengagement_codes,
              'hold_type', rp.hold_type,
              'hold_position', rp.hold_position,
              'hold_level', rp.hold_level,
              'result_codes', rp.result_codes,
              'total_procedures', rp.total_procedures,
              'staff_initials', rp.staff_initials
            ) order by rp.id
          )
          from public.restrictive_practices rp
          where rp.incident_id = i.id
        ), '[]'::jsonb),
        'injuries', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'injured_party_type', inj.injured_party_type,
              'passport_id', inj.passport_id,
              'staff_user_id', inj.staff_user_id,
              'free_text_name', inj.free_text_name,
              'injury_types', inj.injury_types,
              'injury_notes', inj.injury_notes,
              'first_aider_called', inj.first_aider_called,
              'first_aider_name', inj.first_aider_name,
              'doctor_ambulance_called', inj.doctor_ambulance_called,
              'treatments', inj.treatments,
              'treatment_other', inj.treatment_other,
              'remained_on_site', inj.remained_on_site,
              'remained_detail', inj.remained_detail
            ) order by inj.id
          )
          from public.incident_injuries inj
          where inj.incident_id = i.id
        ), '[]'::jsonb)
      )::text
      from public.incidents i
      where i.id = p_incident_id
    ), '')
  );
$$;

-- No grant to authenticated -- internal use only, from the two
-- SECURITY DEFINER functions below.


-- =====================================================================
-- 3. get_attestation_status() -- corrected: content_hash, computed via
-- compute_incident_content_hash(), plus the can_view_incident() gate.
-- =====================================================================

create or replace function public.get_attestation_status(p_incident_staff_id uuid)
returns text
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_incident_id uuid;
  v_current_hash text;
  v_latest_action text;
  v_latest_hash text;
begin
  select st.incident_id
  into v_incident_id
  from public.incident_staff st
  where st.id = p_incident_staff_id;

  -- SECURITY DEFINER bypasses table RLS for the reads below, so this
  -- function has to do its own visibility check -- otherwise any
  -- authenticated caller who merely guessed or was leaked a valid
  -- incident_staff_id could learn its attestation status for an incident
  -- they have no standing to see at all.
  if v_incident_id is null or not public.can_view_incident(v_incident_id) then
    return 'unknown';
  end if;

  v_current_hash := public.compute_incident_content_hash(v_incident_id);

  select action, content_hash
  into v_latest_action, v_latest_hash
  from public.incident_attestations
  where incident_staff_id = p_incident_staff_id
  order by created_at desc
  limit 1;

  if v_latest_action is null then
    return 'not_attested';
  elsif v_latest_action = 'withdrawn' then
    return 'withdrawn';
  elsif v_latest_hash = v_current_hash then
    return 'current';
  else
    return 'stale';
  end if;
end;
$$;

grant execute on function public.get_attestation_status(uuid) to authenticated;


-- =====================================================================
-- 4. attest_to_incident() -- corrected: writes content_hash via
-- compute_incident_content_hash().
-- =====================================================================

create or replace function public.attest_to_incident(p_incident_staff_id uuid, p_addendum text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident_id uuid;
  v_attestation_id uuid;
begin
  select st.incident_id
  into v_incident_id
  from public.incident_staff st
  join public.incidents i on i.id = st.incident_id
  where st.id = p_incident_staff_id
    and st.user_id = auth.uid()
    and i.teacher_signed_at is null;

  if v_incident_id is null then
    raise exception 'You cannot attest to this incident -- you may not be the named staff member, or it may already be signed off.';
  end if;

  insert into public.incident_attestations (incident_id, incident_staff_id, action, content_hash, addendum, created_by)
  values (v_incident_id, p_incident_staff_id, 'attested', public.compute_incident_content_hash(v_incident_id), p_addendum, auth.uid())
  returning id into v_attestation_id;

  return v_attestation_id;
end;
$$;

grant execute on function public.attest_to_incident(uuid, text) to authenticated;


-- =====================================================================
-- 5. withdraw_attestation() -- re-created for consistency; logic is
-- unchanged from what's already live.
-- =====================================================================

create or replace function public.withdraw_attestation(p_incident_staff_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident_id uuid;
  v_institution_id uuid;
  v_attestation_id uuid;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to withdraw an attestation.';
  end if;

  select st.incident_id, i.institution_id
  into v_incident_id, v_institution_id
  from public.incident_staff st
  join public.incidents i on i.id = st.incident_id
  where st.id = p_incident_staff_id
    and st.user_id = auth.uid()
    and i.teacher_signed_at is null;

  if v_incident_id is null then
    raise exception 'You cannot withdraw an attestation on this incident -- you may not be the named staff member, or it may already be signed off.';
  end if;

  insert into public.incident_attestations (incident_id, incident_staff_id, action, withdrawal_reason, created_by)
  values (v_incident_id, p_incident_staff_id, 'withdrawn', trim(p_reason), auth.uid())
  returning id into v_attestation_id;

  insert into public.school_notices (notice_type, institution_id, incident_id)
  values ('attestation_withdrawn', v_institution_id, v_incident_id);

  return v_attestation_id;
end;
$$;

grant execute on function public.withdraw_attestation(uuid, text) to authenticated;

-- Idempotent regardless of whether this already ran.
alter table public.school_notices drop constraint if exists school_notices_notice_type_check;
alter table public.school_notices
  add constraint school_notices_notice_type_check
  check (notice_type in ('incident_parent_call', 'attestation_withdrawn'));


-- =====================================================================
-- 6. guard_signoff_requires_current_attestations() -- corrected: blocks
-- only on 'stale'/'withdrawn', not on a staff member who simply never
-- attested.
-- =====================================================================

create or replace function public.guard_signoff_requires_current_attestations()
returns trigger
language plpgsql
as $$
declare
  v_blocking integer;
begin
  if new.teacher_signed_at is not null and old.teacher_signed_at is null then
    select count(*) into v_blocking
    from public.incident_staff st
    where st.incident_id = new.id
      and st.user_id is not null
      and public.get_attestation_status(st.id) in ('stale', 'withdrawn');

    if v_blocking > 0 then
      raise exception 'Cannot sign off -- % named staff member(s) have a stale or withdrawn attestation that must be resolved first (re-attest or the withdrawal must be addressed). A staff member who has simply never attested does not block sign-off.', v_blocking;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_signoff_attestations on public.incidents;
create trigger guard_signoff_attestations
  before update on public.incidents
  for each row
  execute function public.guard_signoff_requires_current_attestations();


-- =====================================================================
-- 7. Restore what the original draft dropped prematurely -- putting the
-- database back into the additive-only state that was actually asked
-- for. Both are dead weight (nothing in the new system reads or writes
-- them), kept only so the real drop can happen deliberately in a later
-- migration once this is verified, not by accident of timing again.
-- =====================================================================

alter table public.incident_staff add column if not exists attested_at timestamptz;
alter table public.incident_staff add column if not exists attestation_addendum text;

drop policy if exists "Named staff can attest to their own row" on public.incident_staff;
create policy "Named staff can attest to their own row"
  on public.incident_staff for update to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from public.incidents i where i.id = incident_staff.incident_id and i.teacher_signed_at is null)
  )
  with check (user_id = auth.uid());
