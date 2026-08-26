/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SCHOOL INCIDENT LOG -- Phase 4, piece 2 continued: the transition the
   status enum always anticipated but nothing ever built, plus the fix
   for the thing that surfaced while building it.

   =====================================================================
   0. RE-APPLYING guard_incident_immutability() -- 0085's rewrite never
   actually landed
   =====================================================================
   Confirmed against the live definition (pasted back in chat): the
   freeze-by-exclusion rewrite from 0085 is NOT live. The function
   currently running is still the original 0068 enumerated-list
   version. Everything else checked from 0085/0086/0087 (incident_
   signoff_issues, all three signoff guard triggers, sign_off_incident,
   get_incident_signoff_summary, guard_teacher_signed_by_matches_caller,
   compute_incident_content_hash) is confirmed correctly live, byte for
   byte -- this was isolated to the one statement, not systemic.

   Operationally worth remembering: this was the statement immediately
   following 0085's ALTER POLICY (the one confirmed to have errored on
   a stale policy name). Whatever Supabase's SQL editor does with a
   failing statement in a multi-statement paste, it appears to have
   taken its immediate neighbour down with it silently, not just
   itself. Both the earlier verification (AUDIT D, using teacherA) and
   CHECK O6a in the adversarial suite passed anyway -- for the wrong
   reason: post-signoff, the owning teacher has no valid RLS path at
   all (their edit policy requires teacher_signed_at is null), so the
   write was rejected by RLS regardless of what the trigger itself
   checked. Neither test actually distinguished the old implementation
   from the new one. CHECK O6 needs a caller who has a genuine
   post-signoff RLS path -- a principal doing a real countersign -- to
   mean anything; fixed alongside the client code for this piece.

   Re-applied below, unchanged from 0085's own design, with one
   addition: 'status' joins the mutable-keys allow list, because it now
   needs to keep moving after sign-off too (awaiting_principal ->
   finalised, in the same write as the countersign).

   =====================================================================
   1. status BECOMES DERIVED, NOT HAND-MAINTAINED
   =====================================================================
   Confirmed live via query: no code anywhere -- not create_incident_
   stamp(), not page.tsx, not sign_off_incident() -- has ever written
   incidents.status to anything but its own default. Every real
   incident is permanently 'draft'. can_view_incident()'s "named staff
   / ordinary teacher via passport_access / clinician, once past draft"
   branches have never actually fired for a real incident. This is why
   CHECK P (piece 2's own attestation-list test) is the first check all
   session to exercise that branch -- and why it failed immediately,
   the first time anything didn't paper over it the way the suite's own
   fixture (line 177, `status: "awaiting_attestation"`) has been doing
   since before this session started.

   Agreed in chat: don't infer the first transition from "stage-two
   content exists" (an SNA would be prompted to attest to a half-
   written narrative, go stale as the teacher keeps typing, and again --
   correct, unusable). Make it an explicit, reversible teacher action:
   "My account is complete -- request attestations." That's the one
   genuinely new fact this migration adds: attestations_requested
   (boolean, toggleable, immediate-write -- same idiom as debrief_
   required/anyone_injured, no new RPC needed, since unlike teacher_
   signed_by nothing here needs server-derived attribution).

   Everything else is derived, by a trigger, from facts that already
   exist as columns -- exactly the point: a status nothing can
   independently set is a status that can't drift out of sync with
   reality the way this one did.

     finalised          <- countersigned_at is not null
     awaiting_principal <- teacher_signed_at is not null
     awaiting_signoff   <- attestations_requested is true
     draft              <- otherwise

   Collapsed from the original five states to four -- agreed in chat.
   awaiting_attestation and awaiting_debrief assumed a strict sequence
   (finish attestation, then debrief) that doesn't match how the actual
   gates work: incident_signoff_issues() (0085) checks debrief
   completeness and attestation staleness together, in one pass, at
   sign-off time -- a teacher can complete either in either order, both
   can be outstanding at once. A single derived value can't express
   "which phase" without inventing a false priority between two
   genuinely parallel conditions and hiding whichever one it didn't
   pick. awaiting_signoff means exactly "outstanding, see incident_
   signoff_issues() / get_incident_signoff_summary() for what" -- the
   detail already exists elsewhere and derived status doesn't need to
   duplicate it.

   No backfill needed: every existing incident is already 'draft', and
   every one of them has attestations_requested = false (the new
   column's own default) and teacher_signed_at/countersigned_at both
   null -- freshly deriving status for any of them today still gives
   'draft'. Confirmed this is fixture/test data regardless.

   =====================================================================
   2. VISIBILITY PERSISTS ONCE ATTESTED -- agreed in chat
   =====================================================================
   Un-toggling attestations_requested pulls status back to 'draft'.
   Without a carve-out, can_view_incident()'s named-staff branch would
   then hide the incident again from someone who already put their name
   on it -- and that's not a permission the owning teacher gets to
   revoke by toggling a box. Fixed: the named-staff branch now reads
   "named staff, once past draft OR has ever attested (any event, even
   a withdrawal, still counts as having engaged)". Only this one
   branch changes; the clinician and ordinary-teacher/passport_access
   branches are untouched, as discussed.

   =====================================================================
   3. RE-REQUESTING DOES NOT LEAVE ATTESTATIONS SILENTLY CURRENT
   =====================================================================
   Un-toggling and re-toggling attestations_requested doesn't change
   any hashed fact (narrative, children, actions, restrictive
   practices, injuries, body marks) -- so the existing hash comparison
   alone would leave every existing attestation reading 'current',
   which is the wrong default per the brief.

   NOT implemented as widening compute_incident_content_hash() to
   include the request timestamp, despite that being the literal
   suggestion -- flagged in chat rather than forced: that function
   computes ONE combined hash for the whole account, so widening it
   would make every currently-current attestation on every incident
   system-wide read as newly-stale the instant this migration runs, not
   just attestations on incidents that actually get re-requested (0072
   already accepted this exact trade-off once, for body-map markers --
   but that shipped before any staff-facing attestation UI existed, so
   nothing real was ever affected by it; this would be the first time
   it has a real audience).

   Implemented instead as a second, independent staleness condition in
   get_attestation_status(): an attestation reads 'stale' if EITHER the
   hash no longer matches (unchanged, existing mechanism) OR it predates
   the incident's own attestations_requested_at (new). This only
   affects attestations on incidents that are actually re-requested --
   nothing changes for anyone else. get_stale_categories() (0088) gains
   a matching check, surfacing it as its own distinct reported reason
   ('attestation_reset') rather than folding it into the six content
   categories, where it would look like nothing changed. attestations_
   requested_at itself is set by the same new trigger that derives
   status -- server-computed on the genuine false->true transition,
   never trusted from client input, same posture as teacher_signed_by. */


-- =====================================================================
-- 0. Re-apply guard_incident_immutability() -- freeze by exclusion,
-- now with 'status' added to the mutable allow list.
-- =====================================================================

create or replace function public.guard_incident_immutability()
returns trigger
language plpgsql
as $$
declare
  v_mutable_keys text[] := array['updated_at', 'countersigned_at', 'countersigned_by', 'countersigned_role_at_time', 'status'];
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


-- =====================================================================
-- 1. attestations_requested / attestations_requested_at, and the
-- narrower, now-derived status enum.
-- =====================================================================

alter table public.incidents add column attestations_requested boolean not null default false;
alter table public.incidents add column attestations_requested_at timestamptz;

alter table public.incidents drop constraint incidents_status_check;
alter table public.incidents add constraint incidents_status_check
  check (status = any (array['draft', 'awaiting_signoff', 'awaiting_principal', 'finalised']));


-- =====================================================================
-- 2. derive_incident_status() -- the trigger that makes status
-- impossible to independently drift out of sync again. Runs on every
-- insert/update; overrides whatever the client sent for status,
-- exactly the way teacher_signed_by is already never trusted from
-- client input.
-- =====================================================================

create or replace function public.derive_incident_status()
returns trigger
language plpgsql
as $$
begin
  if new.attestations_requested and not coalesce(old.attestations_requested, false) then
    new.attestations_requested_at := now();
  end if;

  if new.countersigned_at is not null then
    new.status := 'finalised';
  elsif new.teacher_signed_at is not null then
    new.status := 'awaiting_principal';
  elsif new.attestations_requested then
    new.status := 'awaiting_signoff';
  else
    new.status := 'draft';
  end if;

  return new;
end;
$$;

drop trigger if exists derive_incident_status on public.incidents;
create trigger derive_incident_status
  before insert or update on public.incidents
  for each row
  execute function public.derive_incident_status();


-- =====================================================================
-- 3. can_view_incident() -- named-staff branch gains "or has ever
-- attested", so attesting is not a permission the owning teacher can
-- revoke by un-toggling attestations_requested. Only this one branch
-- changes.
-- =====================================================================

create or replace function public.can_view_incident(p_incident_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return exists (
    select 1 from public.incidents i
    where i.id = p_incident_id
      and (
        public.can_countersign_incident(auth.uid(), i.institution_id)
        or i.created_by = auth.uid()
        or i.owning_teacher_id = auth.uid()
        or (
          i.status <> 'draft'
          and public.is_verified_clinician(auth.uid())
          and exists (
            select 1 from public.incident_children ic
            join public.clinician_access ca on ca.passport_id = ic.passport_id
            where ic.incident_id = i.id
              and ca.clinician_id = auth.uid()
              and ca.is_active = true
          )
        )
        or (
          exists (
            select 1 from public.incident_staff st
            where st.incident_id = i.id and st.user_id = auth.uid()
          )
          and (
            i.status <> 'draft'
            or exists (
              select 1
              from public.incident_attestations att
              join public.incident_staff st on st.id = att.incident_staff_id
              where st.incident_id = i.id and st.user_id = auth.uid()
            )
          )
        )
        or (
          i.status <> 'draft'
          and exists (
            select 1 from public.incident_children ic
            join public.passport_access pa on pa.passport_id = ic.passport_id
            where ic.incident_id = i.id
              and pa.teacher_id = auth.uid()
              and pa.is_active = true
          )
        )
      )
  );
end;
$$;


-- =====================================================================
-- 4. get_attestation_status() -- a second, independent staleness
-- condition: predates the incident's own attestations_requested_at.
-- Does not touch compute_incident_content_hash() or its output at all
-- -- no existing attestation anywhere is affected unless its own
-- incident is actually re-requested.
-- =====================================================================

create or replace function public.get_attestation_status(p_incident_staff_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
stable
as $function$
declare
  v_incident_id uuid;
  v_current_hash text;
  v_latest_action text;
  v_latest_hash text;
  v_latest_created_at timestamptz;
  v_attestations_requested_at timestamptz;
begin
  select st.incident_id
  into v_incident_id
  from public.incident_staff st
  where st.id = p_incident_staff_id;

  if v_incident_id is null or not public.can_view_incident(v_incident_id) then
    return 'unknown';
  end if;

  v_current_hash := public.compute_incident_content_hash(v_incident_id);

  select attestations_requested_at into v_attestations_requested_at
  from public.incidents where id = v_incident_id;

  select action, content_hash, created_at
  into v_latest_action, v_latest_hash, v_latest_created_at
  from public.incident_attestations
  where incident_staff_id = p_incident_staff_id
  order by created_at desc
  limit 1;

  if v_latest_action is null then
    return 'not_attested';
  elsif v_latest_action = 'withdrawn' then
    return 'withdrawn';
  elsif v_latest_hash = v_current_hash
    and (v_attestations_requested_at is null or v_latest_created_at >= v_attestations_requested_at)
  then
    return 'current';
  else
    return 'stale';
  end if;
end;
$function$;


-- =====================================================================
-- 5. get_stale_categories() (0088) -- surfaces a re-request as its own
-- distinct reported reason, 'attestation_reset', rather than an empty
-- list that would misleadingly suggest nothing changed.
-- =====================================================================

create or replace function public.get_stale_categories(p_incident_staff_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_incident_id uuid;
  v_latest_action text;
  v_latest_category_hashes jsonb;
  v_latest_created_at timestamptz;
  v_current_category_hashes jsonb;
  v_attestations_requested_at timestamptz;
  v_stale text[] := array[]::text[];
  v_key text;
begin
  select st.incident_id into v_incident_id
  from public.incident_staff st
  where st.id = p_incident_staff_id;

  if v_incident_id is null or not public.can_view_incident(v_incident_id) then
    return null;
  end if;

  select action, category_hashes, created_at
  into v_latest_action, v_latest_category_hashes, v_latest_created_at
  from public.incident_attestations
  where incident_staff_id = p_incident_staff_id
  order by created_at desc
  limit 1;

  if v_latest_action is distinct from 'attested' then
    return null;
  end if;

  select attestations_requested_at into v_attestations_requested_at
  from public.incidents where id = v_incident_id;

  if v_attestations_requested_at is not null and v_latest_created_at < v_attestations_requested_at then
    v_stale := array_append(v_stale, 'attestation_reset');
  end if;

  if v_latest_category_hashes is null then
    -- Pre-0088 attestation: no per-category detail available. If the
    -- reset marker above already explains the staleness, return that
    -- rather than null -- there IS something honest to report, just
    -- not a category breakdown.
    return case when array_length(v_stale, 1) > 0 then v_stale else null end;
  end if;

  v_current_category_hashes := public.compute_incident_category_hashes(v_incident_id);

  for v_key in select jsonb_object_keys(v_current_category_hashes) loop
    if v_current_category_hashes ->> v_key is distinct from v_latest_category_hashes ->> v_key then
      v_stale := array_append(v_stale, v_key);
    end if;
  end loop;

  return v_stale;
end;
$$;
