-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- FOUND LIVE, SCHOOL TRIAL SMOKE TEST, 19 Sept 2026: a teacher could sign
-- off an incident with a completely empty narrative and no category, and
-- a principal could countersign it, with nothing anywhere -- not the
-- database, not incident_signoff_issues(), not the "Missing Info" status,
-- not the client -- ever flagging it. incident_signoff_issues() (0085)
-- reasons at length about STRUCTURAL CONSISTENCY between related answers
-- (debrief required vs completed, anyone_injured vs injury records, CPI
-- ticked vs a restrictive-practice record) but never once considers
-- CONTENT COMPLETENESS as a category of gate. An oversight, not a
-- decision -- confirmed by reading 0085's own header in full and finding
-- no reasoning anywhere about narrative or category.
--
-- Daniel's own framing: a teacher signing off a restraint record with no
-- account of what happened, and a principal countersigning it, is the
-- record not existing, in a product whose entire purpose is recording
-- restrictive practice defensibly.
--
-- THE FIX, exactly as decided:
--   NARRATIVE BLOCKS sign-off. It is the record. A new blocking code,
--   'narrative_required', added to incident_signoff_issues() itself --
--   not a separate mechanism -- so it flows through everything that
--   already consumes that function for free: sign_off_incident()'s own
--   UPDATE (via the new guard trigger below), get_incident_signoff_
--   summary()'s can_sign_off/blocking_issues (SignOffCard's generic
--   "Blocking sign-off" list already renders any blocking_issues entry
--   it doesn't specifically own -- no client change needed for this
--   half), and has_blocking_issues / the principal's incidents list.
--
--   CATEGORY WARNS, does not block -- a classification, not the record
--   itself. Added to get_incident_signoff_summary()'s own non-blocking
--   shape, matching anyone_injured's existing {value, note} pattern
--   exactly, surfaced in SignOffCard's existing "will not block
--   sign-off" list (client change, this commit).
--
-- COUNTERSIGN DOES NOT NEED THE SAME GATE. guard_incident_immutability()
-- (0085) freezes every incidents column except an explicit allow-list
-- (countersigned_at/_by/_role_at_time, updated_at, withheld_from_clinic/
-- _reason) the instant teacher_signed_at is set -- narrative is not on
-- that list and cannot change between sign-off and countersign. So once
-- sign-off requires a non-empty narrative, every incident reaching
-- "awaiting countersign" from this point on is structurally guaranteed
-- to still carry it. The only way an empty-narrative incident could ever
-- reach countersign after this ships is a LEGACY one, signed off before
-- this migration ran -- checked directly against production first:
-- exactly one signed-off incident exists at all, and it has both a real
-- narrative and a real category. Zero legacy risk. A duplicate check in
-- countersign_incident() would be a second definition of the identical
-- guarantee -- the exact drift risk 0085's own "one shared function, not
-- a parallel implementation" was written to avoid.

create or replace function public.incident_signoff_issues(p_incident public.incidents)
returns jsonb
language plpgsql
stable
as $$
declare
  v_issues jsonb := '[]'::jsonb;
  v_injury_count integer;
  v_stale_or_withdrawn_count integer;
  v_mark_type_mismatch boolean;
  v_has_restraint_action boolean;
  v_has_rp_record boolean;
begin
  -- 1. Debrief (0077).
  if p_incident.debrief_required and not exists (
    select 1 from public.incident_debriefs d
    where d.incident_id = p_incident.id and d.completed_at is not null
  ) then
    v_issues := v_issues || jsonb_build_object(
      'code', 'debrief_incomplete',
      'message', 'Cannot sign off -- this incident requires a debrief, and none has been completed.'
    );
  end if;

  -- 2. Attestation staleness/withdrawal (0070).
  select count(*) into v_stale_or_withdrawn_count
  from public.incident_staff st
  where st.incident_id = p_incident.id
    and st.user_id is not null
    and public.get_attestation_status(st.id) in ('stale', 'withdrawn');
  if v_stale_or_withdrawn_count > 0 then
    v_issues := v_issues || jsonb_build_object(
      'code', 'stale_or_withdrawn_attestation',
      'message', format('Cannot sign off -- %s named staff member(s) have a stale or withdrawn attestation that must be resolved first (re-attest or the withdrawal must be addressed). A staff member who has simply never attested does not block sign-off.', v_stale_or_withdrawn_count)
    );
  end if;

  -- 3a. anyone_injured vs incident_injuries (0083 part 1).
  select count(*) into v_injury_count from public.incident_injuries where incident_id = p_incident.id;
  if p_incident.anyone_injured is true and v_injury_count = 0 then
    v_issues := v_issues || jsonb_build_object(
      'code', 'anyone_injured_yes_no_records',
      'message', 'Cannot sign off -- "Was a student or staff member injured?" is answered Yes but no injury record exists.'
    );
  end if;
  if p_incident.anyone_injured is false and v_injury_count > 0 then
    v_issues := v_issues || jsonb_build_object(
      'code', 'anyone_injured_no_but_records_exist',
      'message', format('Cannot sign off -- "Was a student or staff member injured?" is answered No but %s injury record(s) still exist. Remove them or change the answer.', v_injury_count)
    );
  end if;

  -- 3b. skin_broken vs injury type (0083 part 2).
  select exists (
    select 1
    from public.incident_body_marks bm
    join public.incident_injuries inj on inj.id = bm.injury_id
    join public.incident_injury_types it on it.id = bm.injury_type_id
    where inj.incident_id = p_incident.id
      and bm.skin_broken is not null
      and it.value <> 'Bite'
  ) into v_mark_type_mismatch;
  if v_mark_type_mismatch then
    v_issues := v_issues || jsonb_build_object(
      'code', 'skin_broken_type_mismatch',
      'message', 'Cannot sign off -- a body mark records whether skin was broken, but its injury type is no longer Bite.'
    );
  end if;

  -- 3c. CPI ticked vs restrictive_practices existing (0083 part 3).
  select exists (
    select 1 from public.incident_actions ia
    join public.incident_action_types iat on iat.id = ia.action_type_id
    where ia.incident_id = p_incident.id and iat.is_restraint
  ) into v_has_restraint_action;
  select exists (select 1 from public.restrictive_practices where incident_id = p_incident.id) into v_has_rp_record;

  if v_has_restraint_action and not v_has_rp_record then
    v_issues := v_issues || jsonb_build_object(
      'code', 'cpi_ticked_no_record',
      'message', 'Cannot sign off -- "CPI / restraint used" is ticked but no restrictive practice record exists.'
    );
  end if;
  if v_has_rp_record and not v_has_restraint_action then
    v_issues := v_issues || jsonb_build_object(
      'code', 'record_exists_cpi_not_ticked',
      'message', 'Cannot sign off -- a restrictive practice record exists but "CPI / restraint used" is not ticked.'
    );
  end if;

  -- 4. Narrative required (this migration, 19 Sept 2026). The record IS
  -- the narrative -- an incident with none is not a record at all. A
  -- teacher who cannot yet write it should leave the incident unsigned,
  -- which keeps it visible (In Progress) on their own dashboard and the
  -- principal's queue, rather than closing it looking finished with
  -- nothing inside it.
  if p_incident.narrative is null or trim(p_incident.narrative) = '' then
    v_issues := v_issues || jsonb_build_object(
      'code', 'narrative_required',
      'message', 'Cannot sign off -- write what happened before signing off. The narrative is the record.'
    );
  end if;

  return v_issues;
end;
$$;

-- guard_signoff_narrative -- the fourth thin wrapper, same shape as the
-- three 0085 already established, raising on the one code it owns.
create or replace function public.guard_signoff_requires_narrative()
returns trigger
language plpgsql
as $$
declare
  v_issue jsonb;
begin
  if new.teacher_signed_at is not null and old.teacher_signed_at is null then
    for v_issue in select * from jsonb_array_elements(public.incident_signoff_issues(new)) loop
      if v_issue ->> 'code' = 'narrative_required' then
        raise exception '%', v_issue ->> 'message';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_signoff_narrative on public.incidents;
create trigger guard_signoff_narrative
  before update on public.incidents
  for each row
  execute function public.guard_signoff_requires_narrative();

-- get_incident_signoff_summary() -- add category's own {value, note}
-- pair, byte-for-byte the same shape anyone_injured already has. Every
-- other field unchanged.
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
    ),
    'category', jsonb_build_object(
      'value', v_incident.category,
      'note', case when v_incident.category is null then 'not recorded' else null end
    )
  );
end;
$function$;
