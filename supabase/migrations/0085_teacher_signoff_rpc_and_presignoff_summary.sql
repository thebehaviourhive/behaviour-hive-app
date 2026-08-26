/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SCHOOL INCIDENT LOG -- Phase 4, piece 1, revised against two points
   raised in review. Both taken as stated, not the fallback offered for
   either.

   =====================================================================
   REVISION 1 -- ONE SHARED FUNCTION, NOT A PARALLEL IMPLEMENTATION
   =====================================================================
   The first draft had get_incident_signoff_summary() re-deriving the
   same four gates independently from the three trigger functions --
   flagged, correctly, as the actual risk: drift makes the trigger stay
   right and the human-facing summary go wrong, in either direction.

   Fixed with option (a): incident_signoff_issues(p_incident) is now
   the ONE place that computes what would block sign-off. The three
   existing trigger functions (guard_signoff_requires_debrief 0077,
   guard_signoff_requires_current_attestations 0070,
   guard_signoff_requires_consistent_records 0083) are rewritten to
   call it and raise on the specific issue code each one owns, using
   the exact same message text they already raised. get_incident_
   signoff_summary() calls the same function for its own blocking_
   issues list. One definition, both consumers.

   It takes the incident as a ROW VALUE, not just an id, on purpose:
   called from inside a BEFORE UPDATE trigger, `select * from incidents
   where id = new.id` would read the PRE-update row, not new -- for
   teacher_signed_at itself that's exactly backwards (old.teacher_
   signed_at is null at that point; that's the whole premise of the
   transition), and for any OTHER column a future write happened to
   change in the same statement as sign-off, it would silently check
   the wrong values. Passing NEW from the triggers, and a row the
   summary RPC already fetched itself, avoids that entirely -- neither
   caller ever re-reads the row through a path that could see stale
   data.

   Not security definer, matching 0083's own reasoning, still true
   here: every caller (a trigger firing during the owning teacher's own
   sign-off attempt, or the summary RPC gated to that same person) has
   full SELECT visibility into everything this reads.

   =====================================================================
   REVISION 2 -- FREEZE BY EXCLUSION, NOT BY ENUMERATION
   =====================================================================
   Not harder than it looked. to_jsonb(old)/to_jsonb(new), each with
   the allow-listed keys removed via the jsonb `-` operator, then one
   `IS DISTINCT FROM` on what's left. Anything not on the allow list is
   frozen by construction -- a new column added later needs a
   deliberate decision to add it to v_mutable_keys, not a decision to
   remember to add it to a frozen-list that nothing prompts anyone to
   revisit. No separate drift test needed for this one: the mechanism
   itself is what used to be missing, not a check that would have
   caught its absence.

   v_mutable_keys: countersigned_at, countersigned_by, countersigned_
   role_at_time (the actual countersign write) and updated_at (touched
   on every write by the separate set_incidents_updated_at trigger --
   without it here, that trigger's own touch would trip immutability
   on the FIRST countersign attempt, a bug this revision would
   introduce if left out). Everything else -- including anything added
   after this migration runs -- is frozen unless someone deliberately
   adds it here. */


-- =====================================================================
-- 1. Close the teacher_signed_by spoofing gap at the RLS layer.
-- Unchanged from the first draft.
-- =====================================================================

alter policy "Creator or owning teacher can edit before teacher sign-off"
  on public.incidents
  with check (
    (created_by = auth.uid() or owning_teacher_id = auth.uid())
    and (teacher_signed_at is null or teacher_signed_by = auth.uid())
  );


-- =====================================================================
-- 2. Immutability -- freeze by exclusion (revision 2).
-- =====================================================================

create or replace function public.guard_incident_immutability()
returns trigger
language plpgsql
as $$
declare
  v_mutable_keys text[] := array['updated_at', 'countersigned_at', 'countersigned_by', 'countersigned_role_at_time'];
  v_old_jsonb jsonb;
  v_new_jsonb jsonb;
  v_key text;
begin
  if old.teacher_signed_at is not null then
    v_old_jsonb := to_jsonb(old);
    v_new_jsonb := to_jsonb(new);
    foreach v_key in array v_mutable_keys loop
      v_old_jsonb := v_old_jsonb - v_key;
      v_new_jsonb := v_new_jsonb - v_key;
    end loop;
    if v_old_jsonb is distinct from v_new_jsonb then
      raise exception 'This incident is teacher-signed and immutable. Use incident_amendments to add a correction.';
    end if;
  end if;
  return new;
end;
$$;
-- No trigger re-creation needed -- CREATE OR REPLACE updates the
-- function body in place; the existing guard_incidents_immutability
-- trigger already points at this function by name.


-- =====================================================================
-- 3. incident_signoff_issues() -- the one shared definition (revision 1).
-- Returns a jsonb array of {code, message}; every entry it returns is,
-- by construction, something that would block sign-off. Non-blocking
-- display facts (not-yet-attested staff, an unanswered anyone_injured)
-- are NOT part of this array -- a trigger has no use for them, and
-- they're trivial column reads with no multi-condition logic to drift,
-- computed separately (and still only once) inside the summary RPC.
-- =====================================================================

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

  return v_issues;
end;
$$;

grant execute on function public.incident_signoff_issues(public.incidents) to authenticated;


-- =====================================================================
-- 4. The three existing guard triggers -- now thin wrappers over the
-- shared function, each raising on the one code it owns. Same message
-- text as before; same trigger names; same firing order (unchanged --
-- Postgres still runs BEFORE UPDATE triggers alphabetically by trigger
-- name, exactly as it always has). If more than one gate would fail
-- simultaneously, whichever trigger's own code appears means that
-- trigger raises first, same as before this migration.
-- =====================================================================

create or replace function public.guard_signoff_requires_debrief()
returns trigger
language plpgsql
as $$
declare
  v_issue jsonb;
begin
  if new.teacher_signed_at is not null and old.teacher_signed_at is null then
    for v_issue in select * from jsonb_array_elements(public.incident_signoff_issues(new)) loop
      if v_issue ->> 'code' = 'debrief_incomplete' then
        raise exception '%', v_issue ->> 'message';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

create or replace function public.guard_signoff_requires_current_attestations()
returns trigger
language plpgsql
as $$
declare
  v_issue jsonb;
begin
  if new.teacher_signed_at is not null and old.teacher_signed_at is null then
    for v_issue in select * from jsonb_array_elements(public.incident_signoff_issues(new)) loop
      if v_issue ->> 'code' = 'stale_or_withdrawn_attestation' then
        raise exception '%', v_issue ->> 'message';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

create or replace function public.guard_signoff_requires_consistent_records()
returns trigger
language plpgsql
as $$
declare
  v_issue jsonb;
begin
  if new.teacher_signed_at is not null and old.teacher_signed_at is null then
    for v_issue in select * from jsonb_array_elements(public.incident_signoff_issues(new)) loop
      if v_issue ->> 'code' in (
        'anyone_injured_yes_no_records',
        'anyone_injured_no_but_records_exist',
        'skin_broken_type_mismatch',
        'cpi_ticked_no_record',
        'record_exists_cpi_not_ticked'
      ) then
        raise exception '%', v_issue ->> 'message';
      end if;
    end loop;
  end if;
  return new;
end;
$$;


-- =====================================================================
-- 5. sign_off_incident() -- the RPC. Unchanged from the first draft.
-- Plain (not security definer): the UPDATE inside runs as the calling
-- teacher, subject to the exact same RLS policy and the same three
-- BEFORE UPDATE triggers (now sharing incident_signoff_issues) a raw
-- client .update() would have hit.
-- =====================================================================

create or replace function public.sign_off_incident(p_incident_id uuid)
returns public.incidents
language plpgsql
as $$
declare
  v_prior_signed_at timestamptz;
  v_after public.incidents;
begin
  select teacher_signed_at into v_prior_signed_at
  from public.incidents
  where id = p_incident_id;

  if not found then
    raise exception 'Incident not found, or you do not have permission to view it.';
  end if;

  if v_prior_signed_at is not null then
    raise exception 'This incident has already been signed off.';
  end if;

  update public.incidents
  set teacher_signed_at = now(), teacher_signed_by = auth.uid()
  where id = p_incident_id
  returning * into v_after;

  if not found then
    raise exception 'Sign-off failed -- only this incident''s creator or owning teacher can sign it off.';
  end if;

  return v_after;
end;
$$;

grant execute on function public.sign_off_incident(uuid) to authenticated;


-- =====================================================================
-- 6. get_incident_signoff_summary() -- the read-only preview. Now
-- calls incident_signoff_issues() once, on a row it fetched itself,
-- for blocking_issues -- the same function the triggers call, on the
-- row NEW will actually be if sign-off is attempted next.
-- =====================================================================

create or replace function public.get_incident_signoff_summary(p_incident_id uuid)
returns jsonb
language plpgsql
as $$
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

  -- Per-staff attestation status, for display -- names and human
  -- labels the shared function has no use for and never computes.
  -- Free-text (no-account) rows are structurally 'not_attested'
  -- forever (attest_to_incident() requires st.user_id = auth.uid(),
  -- impossible for them) -- labelled distinctly here rather than left
  -- to look like an ordinary never-attested real account.
  select coalesce(jsonb_agg(jsonb_build_object(
      'incident_staff_id', st.id,
      'name', coalesce(
        nullif(trim(st.free_text_name), ''),
        coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
        'Named staff member'
      ),
      'has_account', st.user_id is not null,
      'status', case when st.user_id is null then 'not_attested' else public.get_attestation_status(st.id) end,
      'status_label', case
        when st.user_id is null then 'Not attested -- no account'
        else initcap(replace(public.get_attestation_status(st.id), '_', ' '))
      end,
      'blocks_signoff', st.user_id is not null and public.get_attestation_status(st.id) in ('stale', 'withdrawn')
    ) order by st.id), '[]'::jsonb)
  into v_staff
  from public.incident_staff st
  left join auth.users u on u.id = st.user_id
  where st.incident_id = p_incident_id;

  v_issues := public.incident_signoff_issues(v_incident);

  return jsonb_build_object(
    'can_sign_off', jsonb_array_length(v_issues) = 0,
    'blocking_issues', v_issues,
    'staff_attestations', v_staff,
    'anyone_injured', jsonb_build_object(
      'value', v_incident.anyone_injured,
      'note', case when v_incident.anyone_injured is null then 'not recorded' else null end
    )
  );
end;
$$;

grant execute on function public.get_incident_signoff_summary(uuid) to authenticated;
