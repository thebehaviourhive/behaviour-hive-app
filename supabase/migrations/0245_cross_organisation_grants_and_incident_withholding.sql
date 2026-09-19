-- PRD 8, Stage 1 -- the grant mechanism, sized down from the PRD's own
-- literal reading by a real, checked fact rather than a guess. Full
-- account in CLAUDE.md ("PRD 8 STAGE 1"); summarised here because it
-- shapes every decision in this file.
--
-- THE INCIDENT-FLOW CHECK. Section 4 lists "organisation-to-organisation
-- access grants -- a clinic granting a school, and the reverse" as one
-- item. Checked before building either direction as a grant: the
-- "reverse" (school -> clinic) already exists, unconditionally, and has
-- since the clinician track shipped. get_clinician_incidents() (0095)
-- and get_abc_logs() (0190) both already grant any clinician holding a
-- live clinician_access row full read of a child's incidents and ABC
-- logs -- zero institution-linkage check, zero grant table involved.
-- So "the reverse" needs no grant mechanism at all; the only genuinely
-- missing piece in that direction is section 12's withholding decision,
-- built in section 3 of this file as a small, targeted addition to the
-- existing countersign path -- not a grant.
--
-- That leaves exactly one real direction for a NEW grant mechanism:
-- clinic -> school (section 2's "FBA case", section 3's consent
-- handshake). Section 1 of this file builds it.
--
-- SECTION 1: cross_organisation_grants -- clinic proposes, parent
-- confirms (section 3, explicitly decided, not open for relitigation).
-- Scope: fba_report and bsp only. clinical_plans (the Silo 2
-- placeholders, migration 0244) already crosses to school by default
-- via type-level school-visibility -- no grant needed, already shipped.
-- session_notes and assessments (Silo 1 raw instrument data -- MAS,
-- QABF, WISC-V, etc.) never cross, full stop, per section 8's own
-- table ("Session notes: Never", "Raw assessment: Never") -- excluded
-- from the scope vocabulary structurally (a CHECK-enumerated allow-list
-- that simply never names them), not by a runtime judgment call anyone
-- could get wrong later.
--
-- SECTION 2: has_cross_org_grant_access() -- the sibling chokepoint
-- function. Section 5 says a cross-organisation grant "must resolve
-- through has_child_access(), not around it" and warns that six
-- functions have already hand-rolled that logic and drifted. Resolved
-- the way PRD 5 and 6 already resolved the identical tension against
-- the same function (has_child_access() backs 30 call sites, 3 of them
-- write paths, and must never carry a branch relevant to only two
-- tables): a NEW sibling function is the "one place" the PRD is really
-- asking for, composed via an additive OR policy at the two read call
-- sites that need it (fba_reports, bsp/bsp_strategies), never a
-- widening of has_child_access() itself.
--
-- SECTION 3: incident withholding -- section 12's own explicit,
-- decided design: "A principal chooses whether to withhold an incident
-- from an engaged clinic at the moment they countersign it... Not a
-- separate step, and not available afterwards." Built as a real
-- database-level guarantee, not a UI convention: the decision can only
-- be set in the exact same statement that sets countersigned_at
-- (guard_incident_immutability()'s mutable-keys list, 0089), and is
-- force-reverted to its already-decided value on every write after
-- that (derive_countersign_fields(), 0090).
--
-- Section 12's own framing -- "not available afterwards" -- presupposes
-- nothing is visible to the clinic before that one decision point. The
-- incident-flow check found that untrue: get_clinician_incidents()'s
-- gate (status <> 'draft') is satisfied by derive_incident_status()
-- (0089) as early as attestations_requested -- long before teacher
-- sign-off, let alone countersign -- and notify_clinicians_of_incident_
-- signoff() (0094) actively notifies the clinician at teacher sign-off,
-- earlier still than a passive query would need. This migration closes
-- that gap at the root: the clinician's own read gate moves to
-- countersigned_at is not null (never draft/awaiting_signoff/
-- awaiting_principal), so the countersign moment is genuinely the first
-- point anything becomes visible, matching what section 12 assumes.
-- ABC logs are deliberately NOT touched by this section -- they have no
-- countersign step to gate on, section 2's "incidents flow" language
-- names incidents specifically, and their own already-shipped default-
-- share behaviour predates this PRD and is out of its scope to revisit.


-- =====================================================================
-- SECTION 1: cross_organisation_grants
-- =====================================================================

create table public.cross_organisation_grants (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  granting_institution_id uuid not null references public.institutions (id),
  receiving_institution_id uuid not null references public.institutions (id),
  -- The sharpest thing in this recon, per Daniel: a positive,
  -- CHECK-enumerated allow-list. 'session_note' and 'assessment' are
  -- illegal values because they are simply never named here, not
  -- because a runtime check excludes them -- the constraint IS the
  -- guarantee.
  scope_items text[] not null check (
    array_length(scope_items, 1) > 0
    and scope_items <@ array['fba_report', 'bsp']::text[]
  ),
  status text not null default 'proposed' check (status in ('proposed', 'active', 'declined', 'revoked')),
  proposed_by uuid not null references auth.users (id),
  proposed_at timestamptz not null default now(),
  confirmed_by uuid references auth.users (id),
  confirmed_at timestamptz,
  declined_by uuid references auth.users (id),
  declined_at timestamptz,
  decline_reason text,
  revoked_by uuid references auth.users (id),
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default now(),
  constraint cross_organisation_grants_different_institutions
    check (granting_institution_id <> receiving_institution_id)
);

create index cross_organisation_grants_passport_id_idx on public.cross_organisation_grants (passport_id);
create index cross_organisation_grants_receiving_institution_id_idx on public.cross_organisation_grants (receiving_institution_id);
create index cross_organisation_grants_granting_institution_id_idx on public.cross_organisation_grants (granting_institution_id);

-- One active, and separately one proposed-but-undecided, grant per
-- (passport, granting institution, receiving institution) triple --
-- matches bsp_one_active_per_passport_per_institution's own shape.
-- Prevents a clinic re-proposing while an identical proposal already
-- awaits the parent, and prevents two simultaneously "active" grants
-- for the same triple (a revoke-then-repropose is a fresh row, not a
-- reactivation, matching this schema's own "never resurrect, always a
-- fresh row" precedent from bsp's own revision shape).
create unique index cross_organisation_grants_one_active
  on public.cross_organisation_grants (passport_id, granting_institution_id, receiving_institution_id)
  where status = 'active';
create unique index cross_organisation_grants_one_proposed
  on public.cross_organisation_grants (passport_id, granting_institution_id, receiving_institution_id)
  where status = 'proposed';

-- Enforces the direction section 3 actually describes -- "the clinic
-- proposes" -- structurally, not by convention. A trigger, not a CHECK,
-- because validating institutions.type needs a subquery.
create or replace function public._validate_cross_organisation_grant_direction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_granting_type text;
  v_receiving_type text;
begin
  select type into v_granting_type from public.institutions where id = new.granting_institution_id;
  select type into v_receiving_type from public.institutions where id = new.receiving_institution_id;

  if v_granting_type <> 'clinic' then
    raise exception 'Only a clinic may grant access to material it holds.';
  end if;

  if v_receiving_type <> 'school' then
    raise exception 'A cross-organisation grant may only be proposed to a school.';
  end if;

  return new;
end;
$$;

create trigger validate_cross_organisation_grant_direction
  before insert on public.cross_organisation_grants
  for each row
  execute function public._validate_cross_organisation_grant_direction();

alter table public.cross_organisation_grants enable row level security;

-- Read: staff at either institution (active standing), or the child's
-- own guardian -- matching tag_change_requests' own template plus the
-- parent branch this table needs that one never did (a parent is a
-- real party to this specific consent, unlike a clinic's internal tag
-- vocabulary).
create policy "Staff at either institution, or the passport's guardian, can read a grant"
  on public.cross_organisation_grants for select to authenticated
  using (
    public.owns_passport(passport_id)
    or exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.institution_id in (granting_institution_id, receiving_institution_id)
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  );

-- No direct client INSERT/UPDATE policy at all -- every transition goes
-- through the RPCs below (SECURITY DEFINER), matching bsp's own "no
-- INSERT/UPDATE policy, creation and transitions only through
-- functions" posture, for the same reason: each transition has real
-- authorization logic (who may propose, who may confirm, who may
-- revoke) that a raw RLS policy on this table can express only badly.

grant select on public.cross_organisation_grants to authenticated;

-- propose_cross_organisation_grant -- the clinic's own director offers
-- access to material it holds. Requires an active passport_institution_
-- links row at the granting (clinic) institution -- a clinic cannot
-- propose sharing a child it has no relationship to.
create or replace function public.propose_cross_organisation_grant(
  p_passport_id uuid,
  p_receiving_institution_id uuid,
  p_scope_items text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_granting_institution_id uuid;
  v_grant_id uuid;
begin
  select pil.institution_id into v_granting_institution_id
  from public.passport_institution_links pil
  join public.institutions i on i.id = pil.institution_id
  where pil.passport_id = p_passport_id
    and i.type = 'clinic'
    and public._is_director_of_institution(pil.institution_id)
  limit 1;

  if v_granting_institution_id is null then
    raise exception 'You must be the director of a clinic already linked to this child to propose a grant.';
  end if;

  insert into public.cross_organisation_grants (
    passport_id, granting_institution_id, receiving_institution_id, scope_items, proposed_by
  )
  values (
    p_passport_id, v_granting_institution_id, p_receiving_institution_id, p_scope_items, auth.uid()
  )
  returning id into v_grant_id;

  return v_grant_id;
end;
$$;

grant execute on function public.propose_cross_organisation_grant(uuid, uuid, text[]) to authenticated;

-- confirm_cross_organisation_grant -- "nothing crosses unless two
-- parties act" (section 3). Only the passport's own guardian, only
-- while still proposed. confirmed_at is the forward-only boundary the
-- chokepoint function below compares every artefact's created_at
-- against.
create or replace function public.confirm_cross_organisation_grant(p_grant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant public.cross_organisation_grants;
begin
  select * into v_grant from public.cross_organisation_grants where id = p_grant_id;
  if not found then
    raise exception 'Grant not found, or you do not have permission to act on it.';
  end if;

  if not public.owns_passport(v_grant.passport_id) then
    raise exception 'Only this child''s own guardian may confirm a cross-organisation grant.';
  end if;

  if v_grant.status <> 'proposed' then
    raise exception 'This grant is no longer awaiting confirmation.';
  end if;

  update public.cross_organisation_grants
  set status = 'active', confirmed_by = auth.uid(), confirmed_at = now()
  where id = p_grant_id;
end;
$$;

grant execute on function public.confirm_cross_organisation_grant(uuid) to authenticated;

create or replace function public.decline_cross_organisation_grant(p_grant_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant public.cross_organisation_grants;
begin
  select * into v_grant from public.cross_organisation_grants where id = p_grant_id;
  if not found then
    raise exception 'Grant not found, or you do not have permission to act on it.';
  end if;

  if not public.owns_passport(v_grant.passport_id) then
    raise exception 'Only this child''s own guardian may decline a cross-organisation grant.';
  end if;

  if v_grant.status <> 'proposed' then
    raise exception 'This grant is no longer awaiting confirmation.';
  end if;

  update public.cross_organisation_grants
  set status = 'declined', declined_by = auth.uid(), declined_at = now(), decline_reason = p_reason
  where id = p_grant_id;
end;
$$;

grant execute on function public.decline_cross_organisation_grant(uuid, text) to authenticated;

-- revoke_cross_organisation_grant -- the granting clinic's own director
-- may withdraw what it offered (ownership follows authorship; the
-- material stays the clinic's to decide about). The receiving school
-- has no revoke path -- it can simply stop reading; the PRD names no
-- school-initiated "give this back" action.
create or replace function public.revoke_cross_organisation_grant(p_grant_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant public.cross_organisation_grants;
begin
  select * into v_grant from public.cross_organisation_grants where id = p_grant_id;
  if not found then
    raise exception 'Grant not found, or you do not have permission to act on it.';
  end if;

  if not public._is_director_of_institution(v_grant.granting_institution_id) then
    raise exception 'Only the granting clinic''s own director may revoke this grant.';
  end if;

  if v_grant.status <> 'active' then
    raise exception 'Only an active grant can be revoked.';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required to revoke a grant.';
  end if;

  update public.cross_organisation_grants
  set status = 'revoked', revoked_by = auth.uid(), revoked_at = now(), revoke_reason = p_reason
  where id = p_grant_id;
end;
$$;

grant execute on function public.revoke_cross_organisation_grant(uuid, text) to authenticated;


-- =====================================================================
-- SECTION 2: has_cross_org_grant_access() -- the sibling chokepoint
-- =====================================================================

create or replace function public.has_cross_org_grant_access(
  p_user_id uuid,
  p_passport_id uuid,
  p_artefact_type text,
  p_artefact_created_at timestamptz
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.cross_organisation_grants g
    join public.institution_staff s on s.institution_id = g.receiving_institution_id
    where g.passport_id = p_passport_id
      and g.status = 'active'
      and p_artefact_type = any (g.scope_items)
      -- Forward-only by default (section 2, decided): a grant confirmed
      -- today does not retroactively expose material authored before
      -- it. Historical sharing is a deliberate, separate act -- not
      -- built in this migration, per section 9's own sequencing (this
      -- is Stage 1's grant mechanism, not a "share history too" option).
      and g.confirmed_at is not null
      and p_artefact_created_at >= g.confirmed_at
      and s.user_id = p_user_id
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  );
$$;

grant execute on function public.has_cross_org_grant_access(uuid, uuid, text, timestamptz) to authenticated;

-- fba_reports currently has no school-facing branch at all (zero
-- access by omission, per 0040's own header) -- this is the FBA case
-- section 2 names as "the test". Only a COMPLETED fba_report can ever
-- be granted -- a school never sees a draft, matching every other
-- completed-lock precedent in this schema.
create policy "A school with an active cross-organisation grant can view a completed, granted FBA"
  on public.fba_reports for select to authenticated
  using (
    status = 'completed'
    and public.has_cross_org_grant_access(auth.uid(), passport_id, 'fba_report', created_at)
  );

-- bsp's own existing SELECT policy is clinician-only, by design (what
-- crosses today is only its extracted strategies, via
-- passport_clinical_content -- PRD 7 Stage 4). This is the first time
-- the bsp document itself, not just its strategies, becomes readable
-- by a school -- and only a SIGNED (status = 'active') plan, never a
-- draft.
create policy "A school with an active cross-organisation grant can view a signed, granted BSP"
  on public.bsp for select to authenticated
  using (
    status = 'active'
    and public.has_cross_org_grant_access(auth.uid(), passport_id, 'bsp', created_at)
  );

-- bsp_strategies reads through _bsp_is_readable_by_caller() -- extend
-- that ONE place rather than adding a second policy here, so this
-- table's own readability never has to be re-derived a third way.
create or replace function public._bsp_is_readable_by_caller(p_bsp_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.bsp b
    where b.id = p_bsp_id
      and (
        (b.clinician_id = auth.uid() and public._caller_has_live_clinician_access(b.passport_id))
        or public._clinical_colleague_domain_match(b.clinician_id, b.passport_id, b.domain_tags)
        or (
          b.status = 'active'
          and public.has_cross_org_grant_access(auth.uid(), b.passport_id, 'bsp', b.created_at)
        )
      )
  );
$$;


-- =====================================================================
-- SECTION 3: incident withholding, decided at countersign
-- =====================================================================

alter table public.incidents add column withheld_from_clinic boolean not null default false;
alter table public.incidents add column withheld_from_clinic_reason text;
alter table public.incidents add column withheld_from_clinic_decided_at timestamptz;
alter table public.incidents add column withheld_from_clinic_decided_by uuid references auth.users (id);

alter table public.incidents add constraint incidents_withhold_reason_required
  check (not withheld_from_clinic or withheld_from_clinic_reason is not null);

-- guard_incident_immutability -- the four new columns join the
-- mutable-keys allow-list, same shape as countersigned_at/by/
-- role_at_time/via joining it in 0090. This is what lets the withhold
-- decision be written in the SAME statement as countersigned_at at all
-- -- without this, the immutability guard would reject the write
-- outright the moment teacher_signed_at is set, before countersigning
-- ever happens.
create or replace function public.guard_incident_immutability()
returns trigger
language plpgsql
as $function$
declare
  v_mutable_keys text[] := array[
    'updated_at', 'countersigned_at', 'countersigned_by', 'countersigned_role_at_time', 'countersigned_via', 'status',
    'withheld_from_clinic', 'withheld_from_clinic_reason', 'withheld_from_clinic_decided_at', 'withheld_from_clinic_decided_by'
  ];
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
$function$;

-- derive_countersign_fields -- extended with the withhold decision's
-- own two rules, per section 12: settable ONLY at the exact
-- countersigned_at null->not-null transition (auto-stamping who/when,
-- same pattern as countersigned_by/role_at_time), and force-reverted to
-- its already-decided value on every write after that -- "not available
-- afterwards" enforced structurally, not left to client discipline.
-- Pre-countersign writes (there are none today, but the guard doesn't
-- know that) are reverted the same way, since this trigger is the only
-- legitimate writer of these columns at any point.
create or replace function public.derive_countersign_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text;
begin
  if new.countersigned_at is not null and old.countersigned_at is null then
    select s.role into v_role
    from public.institution_staff s
    where s.institution_id = new.institution_id
      and s.user_id = auth.uid();

    new.countersigned_by := auth.uid();
    new.countersigned_role_at_time := v_role;
    new.countersigned_via := case when v_role = 'principal' then 'principal_role' else 'grant' end;

    new.withheld_from_clinic_decided_at := now();
    new.withheld_from_clinic_decided_by := auth.uid();
  elsif old.countersigned_at is not null then
    new.withheld_from_clinic := old.withheld_from_clinic;
    new.withheld_from_clinic_reason := old.withheld_from_clinic_reason;
    new.withheld_from_clinic_decided_at := old.withheld_from_clinic_decided_at;
    new.withheld_from_clinic_decided_by := old.withheld_from_clinic_decided_by;
  else
    new.withheld_from_clinic := old.withheld_from_clinic;
    new.withheld_from_clinic_reason := old.withheld_from_clinic_reason;
  end if;
  return new;
end;
$function$;

-- countersign_incident -- signature grows (two new trailing defaulted
-- params). Per this schema's own hard-learned rule (send_message(),
-- 0169), a new trailing defaulted parameter is never safe via bare
-- CREATE OR REPLACE -- DROP the old signature first.
drop function if exists public.countersign_incident(uuid);

create or replace function public.countersign_incident(
  p_incident_id uuid,
  p_withhold_from_clinic boolean default false,
  p_withhold_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_incident public.incidents;
begin
  select * into v_incident from public.incidents where id = p_incident_id;
  if not found then
    raise exception 'Incident not found, or you do not have permission to view it.';
  end if;

  if v_incident.teacher_signed_at is null then
    raise exception 'This incident has not yet been signed off by its teacher.';
  end if;

  if v_incident.countersigned_at is not null then
    raise exception 'This incident has already been countersigned.';
  end if;

  if not public.can_countersign_incident(auth.uid(), v_incident.institution_id) then
    raise exception 'You do not have permission to countersign this incident.';
  end if;

  if p_withhold_from_clinic and (p_withhold_reason is null or trim(p_withhold_reason) = '') then
    raise exception 'A reason is required to withhold this incident from an engaged clinic.';
  end if;

  update public.incidents
  set countersigned_at = now(),
      withheld_from_clinic = p_withhold_from_clinic,
      withheld_from_clinic_reason = case when p_withhold_from_clinic then p_withhold_reason else null end
  where id = p_incident_id;
end;
$function$;

grant execute on function public.countersign_incident(uuid, boolean, text) to authenticated;

-- get_countersign_summary -- surfaces whether there is even an engaged
-- clinician to withhold from (has_engaged_clinic), so the client only
-- shows the withhold control when it means something, plus the decided
-- outcome once already countersigned.
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
  v_has_engaged_clinic boolean;
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

  select exists (
    select 1
    from public.incident_children ic
    join public.clinician_access ca on ca.passport_id = ic.passport_id
    where ic.incident_id = p_incident_id and ca.is_active = true
  ) into v_has_engaged_clinic;

  return jsonb_build_object(
    'staff_attestations', v_staff,
    'teacher_signed_at', v_incident.teacher_signed_at,
    'teacher_signed_by_name', v_teacher_name,
    'anyone_injured', jsonb_build_object(
      'value', v_incident.anyone_injured,
      'note', case when v_incident.anyone_injured is null then 'not recorded' else null end
    ),
    'already_countersigned', v_incident.countersigned_at is not null,
    'countersigned_at', v_incident.countersigned_at,
    'countersigned_by_name', v_countersigner_name,
    'countersigned_role_at_time', v_incident.countersigned_role_at_time,
    'countersigned_via', v_incident.countersigned_via,
    'has_engaged_clinic', v_has_engaged_clinic,
    'withheld_from_clinic', v_incident.withheld_from_clinic,
    'withheld_from_clinic_reason', v_incident.withheld_from_clinic_reason
  );
end;
$function$;

-- get_clinician_incidents -- the gate itself moves. Was status <>
-- 'draft' (satisfiable as early as attestations_requested); now
-- countersigned_at is not null and not withheld_from_clinic, per the
-- incident-flow check above. Signature and return shape unchanged.
create or replace function public.get_clinician_incidents(p_passport_id uuid)
returns table (
  incident_id uuid, occurred_at timestamptz, recorded_at timestamptz, location text,
  status text, category text, party text[], party_other text, item_involved text,
  narrative text, parent_summary text, staff_count_needed text, staff_distressed text,
  risk_reduction_future text, other_information text, anyone_injured boolean,
  debrief_required boolean, teacher_signed_at timestamptz, countersigned_at timestamptz,
  child_index text, distress_level text, remained_on_site boolean, remained_detail text,
  recovery_methods text[], actions jsonb, injuries jsonb, restrictive_practice jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select
    i.id as incident_id, i.occurred_at, i.recorded_at, loc.value as location, i.status,
    i.category, i.party, i.party_other, i.item_involved, i.narrative, i.parent_summary,
    i.staff_count_needed, i.staff_distressed, i.risk_reduction_future, i.other_information,
    i.anyone_injured, i.debrief_required, i.teacher_signed_at, i.countersigned_at,
    ic.child_index, ic.distress_level, ic.remained_on_site, ic.remained_detail, ic.recovery_methods,
    coalesce((
      select jsonb_agg(jsonb_build_object('value', at.value, 'other_detail', ia.other_detail))
      from public.incident_actions ia
      join public.incident_action_types at on at.id = ia.action_type_id
      where ia.incident_id = i.id
    ), '[]'::jsonb) as actions,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'injury_types', inj.injury_types, 'injury_notes', inj.injury_notes,
        'first_aider_called', inj.first_aider_called, 'first_aider_name', inj.first_aider_name,
        'doctor_ambulance_called', inj.doctor_ambulance_called, 'treatments', inj.treatments,
        'treatment_other', inj.treatment_other, 'remained_on_site', inj.remained_on_site, 'remained_detail', inj.remained_detail
      ))
      from public.incident_injuries inj
      where inj.incident_id = i.id and inj.injured_party_type = 'student' and inj.passport_id = p_passport_id
    ), '[]'::jsonb) as injuries,
    coalesce((
      select jsonb_agg(jsonb_build_object('planning_status', rp.planning_status, 'ncse_report_complete', rp.ncse_report_complete))
      from public.restrictive_practices rp
      where rp.incident_id = i.id and rp.passport_id = p_passport_id
    ), '[]'::jsonb) as restrictive_practice
  from public.incidents i
  join public.incident_children ic on ic.incident_id = i.id and ic.passport_id = p_passport_id
  join public.incident_locations loc on loc.id = i.location_id
  where public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = p_passport_id and ca.clinician_id = auth.uid() and ca.is_active = true
    )
    and i.countersigned_at is not null
    and i.withheld_from_clinic = false
  order by i.occurred_at desc;
$$;

-- notify_clinicians_of_incident_signoff -- moved from teacher_signed_at
-- to countersigned_at, and skips a withheld incident entirely. Left
-- wired to teacher_signed_at, this trigger would notify a clinician
-- about an incident they then could not open until countersign (and,
-- if withheld, never) -- a dead, confusing notification. Fires at the
-- one point the clinician's own read gate (above) actually opens.
create or replace function public.notify_clinicians_of_incident_signoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child record;
begin
  if new.countersigned_at is not null and old.countersigned_at is null and not new.withheld_from_clinic then
    for v_child in
      select ic.passport_id from public.incident_children ic where ic.incident_id = new.id
    loop
      if exists (
        select 1 from public.clinician_access ca
        where ca.passport_id = v_child.passport_id and ca.is_active = true
      ) then
        insert into public.clinician_incident_notices (notice_type, incident_id, passport_id, institution_id)
        values ('incident_summary_ready', new.id, v_child.passport_id, new.institution_id);
      end if;
    end loop;
  end if;
  return new;
end;
$$;

-- The trigger's own name predates this migration and named its old
-- firing condition -- renamed so it doesn't read as still tied to
-- teacher_signed_at once someone greps for it.
drop trigger if exists notify_clinicians_on_teacher_signoff on public.incidents;
create trigger notify_clinicians_on_countersign
  after update on public.incidents
  for each row
  execute function public.notify_clinicians_of_incident_signoff();
