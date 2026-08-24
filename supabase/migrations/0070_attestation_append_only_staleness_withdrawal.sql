/* NOTE ON ACTUAL RUN HISTORY: an earlier, uncorrected draft of this file
   was run live before the three-point correction below reached me --
   this file was then rewritten to the corrected design shown here, but
   was never itself re-run as a plain script (it would fail: the table
   already exists). See 0071_reconcile_0070_live_state.sql for the
   migration that actually reconciled the live database to match this
   design. This file is left as accurate documentation of the intended
   design -- correct to run as-is only against a database that never had
   any version of 0070 applied.

   Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SCHOOL INCIDENT LOG -- attestation redesign, per explicit decision:
   append-only (never overwrite), staleness against the material facts of
   the account (not just the narrative), and withdrawal with a required
   reason that blocks sign-off and surfaces to the principal.

   REVISED from the first draft of this migration, per direct correction
   before it was ever run:
     1. The sign-off gate blocked on ANY named staff member not being
        'current' -- including simply never having attested at all. That
        makes a missing attestation (someone who left, is on long-term
        leave, or just never opened the app) able to freeze a record
        PERMANENTLY -- worse than an unattested account, because then
        nothing can be signed off, countersigned, or exported at all.
        Fixed: the gate now blocks ONLY on an ACTIVE problem -- a stale
        attestation (someone vouched for an account that has since
        changed) or a withdrawal (someone said they no longer stand over
        it). A missing attestation is not an active problem, just an
        absent one -- it's recorded as 'not_attested' by
        get_attestation_status(), same as before, for a teacher to see
        before they sign, for it to surface on the principal's queue, and
        for the export to print "not attested" against that person's name
        (alongside "not attested -- no account" for free-text staff) --
        Phase 3/6 UI and export work, not this migration, but the status
        this migration exposes is exactly what those will read.
     2. This migration is now ADDITIVE ONLY. The first draft dropped
        incident_staff.attested_at/attestation_addendum (and the old
        "Named staff can attest to their own row" policy) in the same
        migration that added their replacement -- but Phase 1's 51
        adversarial checks ran against those columns, and nothing has
        verified the replacement live yet. Both are left in place, inert,
        until a separate 0071 drops them once 0070 itself is confirmed
        working. The old direct-UPDATE policy staying live for now is
        harmless: nothing in the new system reads attested_at/
        attestation_addendum for status any more (status is entirely
        derived from incident_attestations by get_attestation_status()),
        so a stray direct write to the old columns is dead weight, not a
        second source of truth that can drift and matter.
     3. Staleness now covers more than the narrative. Hashing only
        incidents.narrative meant a teacher could rewrite a child's
        distress level, the actions taken, the restrictive-practice grid,
        or an injury record, and every existing attestation would still
        read as current -- but an attestation vouches for the account,
        and the account is more than its free text. See PART 2,
        compute_incident_content_hash(), for the exact field set chosen
        and why -- one function, one definition of "the account changed",
        called from both get_attestation_status() and attest_to_incident()
        so there is no second place this logic could drift.

   Countersign authority (principal role -> institution_permissions grant)
   is NOT in this migration -- flagged separately, see the end of this
   file's trailing comment.

   =====================================================================
   THE NEW TABLE -- incident_attestations, an append-only event log.
   =====================================================================
   Two event kinds, 'attested' and 'withdrawn', both immutable once
   written -- this table gets a SELECT policy (follows the parent
   incident, same as every other child table) and NO insert/update/
   delete policy at all. Every write goes through the two RPCs below,
   never a direct client insert -- hashing has to happen server-side (a
   client could otherwise attest against a stale hash it captured
   earlier and claim it's current), so unlike incident_amendments (which
   trusts a direct, policy-gated insert), this one is RPC-only from the
   start.

   A given incident_staff row's CURRENT status is not a stored column --
   it's computed from the latest event in this log, by
   get_attestation_status(): 'not_attested' (no events yet), 'withdrawn'
   (latest event is a withdrawal), 'stale' (latest event is an
   attestation, but its content_hash no longer matches the incident's
   current material facts), or 'current' (latest event is an attestation
   whose hash still matches).

   =====================================================================
   STALENESS IN PRACTICE.
   =====================================================================
   There is no separate "mark stale" step and no trigger that rewrites
   anything when the account changes -- staleness is just what
   get_attestation_status() computes the moment it's asked, by comparing
   the stored hash against the LIVE content hash. This is deliberately
   passive: an edit doesn't need to reach into every named staff member's
   row and flip a flag (which would itself be a second place this could
   go wrong) -- every existing attestation simply stops matching,
   automatically, the instant the facts it vouched for change.

   =====================================================================
   WITHDRAWAL.
   =====================================================================
   withdraw_attestation() requires a non-empty reason (checked both in
   the RPC and via this table's own CHECK constraint, belt and braces),
   requires the caller to be the named staff member themselves, and only
   works pre-signoff (same pre-signoff-only posture the old policy had).
   It also raises a school_notices row -- 'attestation_withdrawn', a
   second value on the SAME generalised table the parent-call flag
   already uses (exactly what that table's notice_type discriminator was
   built for: the next notice type needing no third table). Visible to
   the principal and the incident's owning teacher, via the existing
   generic school_notices policies -- no policy change needed there.

   =====================================================================
   THE SIGN-OFF GATE, actually enforced -- and enforcing the right thing.
   =====================================================================
   New trigger, guard_signoff_requires_current_attestations, fires the
   moment teacher_signed_at transitions from null to non-null and rejects
   the write outright if any named (user_id IS NOT NULL) staff member's
   attestation status is 'stale' or 'withdrawn' -- an ACTIVE problem.
   'not_attested' does NOT block, per the correction above. free_text_name
   -only rows are unaffected either way, matching the existing
   non-blocking decision for staff with no account to attest through in
   the first place. */


-- =====================================================================
-- PART 1 -- incident_attestations table.
-- =====================================================================

create table public.incident_attestations (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  incident_staff_id uuid not null references public.incident_staff (id) on delete cascade,
  action text not null check (action in ('attested', 'withdrawn')),
  -- Populated for 'attested' rows only -- see PART 2,
  -- compute_incident_content_hash(), for exactly what this covers. Named
  -- content_hash (not narrative_hash) precisely because it is not just
  -- the narrative.
  content_hash text,
  -- Optional, 'attested' rows only -- the addendum in the staff
  -- member's own words, per the original brief.
  addendum text,
  -- Required, 'withdrawn' rows only.
  withdrawal_reason text,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  check (
    (action = 'attested' and content_hash is not null and withdrawal_reason is null)
    or (action = 'withdrawn' and withdrawal_reason is not null and content_hash is null)
  )
);

create index incident_attestations_incident_id_idx on public.incident_attestations (incident_id);
create index incident_attestations_staff_id_created_at_idx on public.incident_attestations (incident_staff_id, created_at desc);

alter table public.incident_attestations enable row level security;

create policy "Attestation history visibility follows the parent incident"
  on public.incident_attestations for select to authenticated
  using (public.can_view_incident(incident_id));

-- No insert/update/delete policy at all -- every write goes through
-- attest_to_incident()/withdraw_attestation() below, both SECURITY
-- DEFINER, both append-only by construction (plain INSERT, nothing
-- this table's RLS would need to allow a client to do directly).


-- =====================================================================
-- PART 2 -- compute_incident_content_hash(): the single definition of
-- "the account changed". Called from both get_attestation_status() and
-- attest_to_incident() -- one place, not two that could drift.
-- =====================================================================
-- Field set chosen, and why:
--   - narrative: the free-text account itself. Obviously in scope.
--   - each involved child's distress_level and remained_on_site: named
--     explicitly in the decision -- these are material facts about what
--     happened to the child, not incidental metadata.
--   - incident_actions: the set of de-escalation actions selected. What
--     staff say they DID is as much "the account" as what they say
--     happened.
--   - restrictive_practices: the substantive fields of any hold record
--     (planning_status, reason/disengagement/result codes, hold
--     type/position/level, total_procedures, staff_initials) -- a
--     restraint is the single highest-stakes fact this form captures.
--     Deliberately EXCLUDES ncse_report_complete/ncse_completed_at/
--     ncse_completed_by -- those are administrative follow-up tracking
--     (did the paperwork get filed afterwards), not a fact about the
--     incident itself; including them would force every named staff
--     member to re-attest every time someone later ticks the NCSE box,
--     which has nothing to do with whether their account of events is
--     still accurate.
--   - incident_injuries: the substantive fields of any injury record.
--     Deliberately EXCLUDES incident_body_marks (the visual body-map
--     markers) -- a finer-grained illustration of an injury already
--     captured in injury_types/injury_notes above, not a distinct fact;
--     flagged here as a judgment call in case body-mark detail should
--     also invalidate an attestation.
-- child_index/passport_id/ids are included only where needed to keep
-- rows distinguishable in the aggregate, not as "facts" in themselves.
-- Ordered aggregation (order by ...) throughout so the same underlying
-- data always serializes to the same JSON text -- hash stability doesn't
-- depend on physical row/insertion order.

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

-- No grant to authenticated -- this is only ever called internally, by
-- get_attestation_status() and attest_to_incident() below (both
-- SECURITY DEFINER themselves, so the internal call doesn't need its own
-- grant). A hash alone isn't exactly sensitive, but there's no reason
-- for a client to be able to compute it for an incident they otherwise
-- cannot see, so it isn't exposed.


-- =====================================================================
-- PART 3 -- get_attestation_status(): computes current status from the
-- event log, doesn't store it anywhere.
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
  -- they have no standing to see at all. Called from inside the sign-off
  -- trigger too (as the person actually performing the sign-off, always
  -- the creator/owning teacher), where this check always and correctly
  -- passes -- it isn't a special case, the trigger just never fires for
  -- anyone who wouldn't already pass it.
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
-- PART 4 -- attest_to_incident(): the only way an "attested" event gets
-- written. Hashing happens here, server-side, so a client can never
-- claim an attestation is current against a hash it computed itself.
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
-- PART 5 -- withdraw_attestation(): requires a reason, blocks sign-off
-- (via the trigger in Part 6), raises a school_notices row.
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

  -- Surfaces to the principal, per the brief -- same generalised
  -- school_notices table the parent-call flag uses (migration 0068),
  -- a second notice_type value rather than a new table. No passport_id
  -- here -- a withdrawal isn't about a specific child, just the
  -- incident and who withdrew (visible via incident_attestations to
  -- anyone who can already see the incident).
  insert into public.school_notices (notice_type, institution_id, incident_id)
  values ('attestation_withdrawn', v_institution_id, v_incident_id);

  return v_attestation_id;
end;
$$;

grant execute on function public.withdraw_attestation(uuid, text) to authenticated;

alter table public.school_notices drop constraint if exists school_notices_notice_type_check;
alter table public.school_notices
  add constraint school_notices_notice_type_check
  check (notice_type in ('incident_parent_call', 'attestation_withdrawn'));


-- =====================================================================
-- PART 6 -- the sign-off gate: reject setting teacher_signed_at if any
-- named (user_id IS NOT NULL) staff member has an ACTIVE problem --
-- 'stale' or 'withdrawn'. 'not_attested' does NOT block (see the
-- correction at the top of this file) -- a missing attestation is
-- recorded and surfaced, not treated as grounds to freeze the incident
-- forever. free_text_name-only rows are exempt either way, matching the
-- existing non-blocking decision for staff with no account.
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
-- NOT IN THIS MIGRATION, ON PURPOSE:
--   - Dropping incident_staff.attested_at/attestation_addendum and the
--     old "Named staff can attest to their own row" policy -- additive
--     only here; both are deferred to 0071 once this migration is
--     verified live.
--   - Countersign authority moving from a hardcoded principal-role check
--     to an institution_permissions grant -- a separate migration,
--     presented on its own once the amended requirements for that grant
--     are confirmed.
-- =====================================================================
