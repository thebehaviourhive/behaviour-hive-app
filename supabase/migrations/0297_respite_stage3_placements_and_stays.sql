-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 11 STAGE 3 -- placement, stay, the clinic-side link-code
-- generator, and the respite arm on redemption. Five decisions from
-- Daniel, each recorded at its own piece below rather than only here.
--
-- DECISION 1 -- episodes_of_care IS THE PLACEMENT, NOT DUPLICATED, NOT
-- RENAMED. The table and its one RLS policy already carry no
-- institutions.type check at all (confirmed by reading both directly
-- before this migration was written) -- the type constraint has always
-- lived entirely in the three writer functions. A respite centre's own
-- staff never see the word "episode" -- getRoleLabel/vocabulary.ts is
-- what a respite user actually reads, the same layer that already
-- turns "principal" into "Centre Manager" for this institution type.
-- Duplicating the table would mean the roster, discharge, exports, and
-- the stagnation queue all branching across two identical tables
-- forever -- a permanent cost, versus a table name nobody outside the
-- schema ever sees. The three writers (onboard_clinic_client(),
-- reopen_clinic_episode(), end_clinic_episode()) are WIDENED below with
-- an additive respite branch, matching PRD 11 Stage 2's own standing
-- rule (0296's header): every widened check is an explicit OR branch,
-- never a bare widened list a respite role could slip through
-- unintentionally. Function NAMES are left exactly as they are --
-- "widen the three writers" was the instruction, not "rename them,"
-- and a rename risks the one thing this migration should not touch:
-- principal/passports/enrol/page.tsx, the one live client caller of
-- onboard_clinic_client() today.
--
-- centre_manager onboards/reopens/ends; care_staff never does any of
-- the three, matching clinical_lead's own exclusion from onboarding on
-- the clinic side exactly (PRD section 5 never names onboarding among
-- a lead's capabilities; PRD 11 never names it among care staff's).
-- No toggle exists for respite the way practitioner_can_onboard/
-- practitioner_can_discharge_own_clients gate a clinic practitioner --
-- not invented here; centre_manager's own authority is unconditional,
-- matching how a clinic's own director (principal) is never toggle-
-- gated either.
--
-- DECISION 2 -- CONCURRENCY, LEFT EXACTLY AS IT IS. episodes_of_care_
-- one_active_per_institution (0209) already scopes to (passport_id,
-- institution_id) -- one active placement per centre, no constraint at
-- all across DIFFERENT centres. A child moving between two respite
-- centres is one placement ending and a new one starting at the new
-- centre, which the existing partial unique index already permits with
-- zero change. Nothing added here.
--
-- DECISION 3 -- abc_logs.stay_id IS NULLABLE BY NECESSITY, NOT
-- LOOSENESS. abc_logs is passport-wide -- a parent logs at home, a
-- clinician logs about their own client, neither of those happens
-- during a respite stay and neither should ever carry a stay_id. Only
-- an entry logged BY CARE STAFF, during an active stay, carries one --
-- enforced two ways, not one: the new INSERT policy below structurally
-- cannot admit a care_staff row without a valid stay_id (the policy's
-- own EXISTS clause matches on stay_id, so a null value can never
-- satisfy it), and a CHECK constraint restates the same guarantee
-- directly on the table, as a second, standing fact rather than
-- something only a policy happens to enforce today. Documented in the
-- column's own COMMENT ON COLUMN, per Daniel's own explicit
-- instruction, so nobody reads "nullable" as "optional" and tries to
-- make it required later.
--
-- DECISION 4 -- THE CLINIC GENERATES ITS OWN LINK CODE. A genuinely NEW
-- generator (generate_institution_link_code_for_clinic()), not a
-- widening of generate_institution_link_code() (0294), which stays
-- exactly as it was -- parent-only, via owns_passport(). The clinic's
-- own generator is gated on the CLINIC'S OWN standing relationship to
-- the child, never owns_passport(): an active episode of care at the
-- caller's own clinic (the institution-level relationship), OR --
-- for a clinician specifically -- their own active clinician_access to
-- this passport (the personal relationship, which can exist without an
-- institutional episode row at all, e.g. a parent-engaged clinician who
-- also happens to be institution_staff at a clinic). Daniel's own
-- reasoning: the clinic already holds a proven relationship with the
-- child, so there is nothing to disclose to a family that doesn't
-- already know their own clinic, and no parent approval step belongs
-- at generation time -- the family finds out via decision 5's own
-- notification instead, after the fact, not before.
--
-- The personal-relationship fallback (clinician_access, no institutional
-- episode needed) is NOT clinician-only -- widened to include clinical_
-- lead and principal too, caught by this build's own clinician-role-
-- target scanner before this ever shipped: PRD 10 section 4a made a
-- director/lead genuine practitioners, so either can hold their own
-- real clinician_access row with no episode behind it yet, same as any
-- other practitioner. See the function body's own comment for the fix.
--
-- Reuses passport_link_codes (the SAME table the parent's own generator
-- writes to) rather than a second table -- the shared partial unique
-- index (one active code per passport, regardless of who generated it)
-- already means a fresh clinic-generated code correctly revokes any
-- outstanding parent-generated one, and vice versa; nothing about
-- redemption ever needs to know or care who generated the code it's
-- consuming. NOT built here, and recorded as a real gap rather than a
-- silent omission: a clinic-side revoke. Today only the parent (via
-- owns_passport()) can revoke an outstanding code, including one the
-- clinic itself just generated -- a real limitation if the parent
-- hasn't claimed the passport yet (see decision 5's own precondition).
-- Not asked for in this stage; a clinic that mis-generates has to wait
-- out the 7-day expiry or ask the parent, once claimed, to revoke.
--
-- DECISION 5 -- "THE PARENT IS TOLD" WORKS BECAUSE OF HOW THESE CHILDREN
-- ARRIVE, WITH A REAL PRECONDITION, STATED PLAINLY. The clinic creates
-- the passport (onboard_clinic_client()), generates a genuine parent
-- CLAIM code (generate_passport_claim_code(), the existing school-shape
-- mechanism, already usable by a clinic since it only checks the
-- caller's own institution_staff standing, not institution type), and
-- the parent claims -- so owns_passport() standing exists before the
-- respite centre is ever linked, in the ordinary case. get_parent_
-- activity_feed()'s own gate (0152, re-confirmed unchanged by 0228/0246)
-- is a DENYLIST -- any new event_type reaches a parent's feed with zero
-- RPC change, the same mechanism 0294's own team_linked already proved
-- live for a clinician's feed. respite_centre_linked (new event_type,
-- below) is that same mechanism, parent-facing.
--
-- THE PRECONDITION, stated here and at the write site so a future
-- reader never assumes it always works: if nobody has claimed the
-- passport yet (no passport_guardians row), owns_passport() is false
-- for everyone, and this notification reaches literally nobody --
-- structurally inert, not broken, the identical property team_linked
-- already has for a school-created-but-unclaimed passport (a real,
-- symmetric, pre-existing case this migration does not introduce).
--
-- THE FBA IS NOT TOUCHED BY ANY PART OF THIS MIGRATION.

-- =====================================================================
-- 1. respite_stays. A stay's own scheduling shape is nothing like
-- bookings (0255) -- single clinician, single Google-anchored session --
-- and nothing like enrolments/episodes_of_care either (a multi-day span
-- within an already-open placement, not the placement itself). Its own
-- small table: institution_id/passport_id denormalised directly onto
-- the row (matching bookings' own precedent) rather than resolved via
-- a join to episodes_of_care every time a policy or query needs them --
-- both are derived from the episode at INSERT time inside create_
-- respite_stay() below, never trusted from the client.
--
-- No stored status column -- matching this schema's own standing
-- convention (bookings' "confirmed"/"completed", passport_completion_
-- requests' derived status). "Derived status" per Daniel's own
-- instruction means computed at READ time, in get_respite_stays_for_
-- placement() below: upcoming (now() < starts_at), current (starts_at
-- <= now() < ends_at), completed (now() >= ends_at). No cancellation
-- state -- not asked for in this stage, not invented.
-- =====================================================================
create table public.respite_stays (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes_of_care (id) on delete cascade,
  institution_id uuid not null references public.institutions (id) on delete cascade,
  passport_id uuid not null references public.passports (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  constraint respite_stays_ends_after_starts check (ends_at > starts_at)
);

create index respite_stays_episode_id_idx on public.respite_stays (episode_id);
create index respite_stays_institution_id_idx on public.respite_stays (institution_id);
create index respite_stays_passport_id_idx on public.respite_stays (passport_id);

alter table public.respite_stays enable row level security;

-- Institution-wide, matching episodes_of_care's own "Active institution
-- staff can view episodes of care" policy exactly -- any currently
-- active, approved staff member at the centre (centre_manager or
-- care_staff both satisfy institution_staff_has_current_standing()).
create policy "Active institution staff can view respite stays"
  on public.respite_stays for select to authenticated
  using (
    public.institution_staff_has_current_standing(auth.uid(), respite_stays.institution_id)
  );

-- No client-facing write policy -- create_respite_stay() below is the
-- only write path, matching episodes_of_care's own established
-- convention.

-- =====================================================================
-- 2. create_respite_stay() -- the activation action the centre
-- manager's own consent screen already describes ("You activate a
-- child's record when they arrive for a stay"). centre_manager only --
-- no toggle, matching decision 1's own reasoning above.
-- =====================================================================
create or replace function public.create_respite_stay(
  p_episode_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_episode public.episodes_of_care;
  v_stay_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'A stay must end after it starts.';
  end if;

  select * into v_episode from public.episodes_of_care where id = p_episode_id;
  if not found then
    raise exception 'Placement not found.';
  end if;

  if v_episode.ended_at is not null then
    raise exception 'This placement has ended -- a stay cannot be created against it.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = v_episode.institution_id
      and s.user_id = auth.uid()
      and inst.status = 'verified'
      and inst.type = 'respite_centre'
      and s.role = 'centre_manager'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'Only a centre manager can activate a stay.';
  end if;

  insert into public.respite_stays (episode_id, institution_id, passport_id, starts_at, ends_at, created_by)
  values (p_episode_id, v_episode.institution_id, v_episode.passport_id, p_starts_at, p_ends_at, auth.uid())
  returning id into v_stay_id;

  return v_stay_id;
end;
$$;

grant execute on function public.create_respite_stay(uuid, timestamptz, timestamptz) to authenticated;

-- =====================================================================
-- 3. get_respite_stays_for_placement() -- the derived-status read.
-- Institution-scoped the same way the table's own SELECT policy is;
-- built as a function (rather than relying on the raw table read
-- alone) specifically so "derived status" is computed once, in one
-- place, not reimplemented per caller.
-- =====================================================================
create or replace function public.get_respite_stays_for_placement(p_episode_id uuid)
returns table (
  id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    rs.id,
    rs.starts_at,
    rs.ends_at,
    case
      when now() < rs.starts_at then 'upcoming'
      when now() < rs.ends_at then 'current'
      else 'completed'
    end as status,
    rs.created_at
  from public.respite_stays rs
  where rs.episode_id = p_episode_id
    and public.institution_staff_has_current_standing(auth.uid(), rs.institution_id)
  order by rs.starts_at desc;
$$;

grant execute on function public.get_respite_stays_for_placement(uuid) to authenticated;

-- =====================================================================
-- 4. abc_logs -- care_staff admitted to logged_by_role_check, stay_id
-- added (nullable, see decision 3 above), a paired CHECK, and a new
-- INSERT policy scoped to an ACTIVE stay -- matching this schema's own
-- per-role-policy convention (one policy per logging role) rather than
-- folding care_staff into an existing, differently-shaped policy.
-- =====================================================================
alter table public.abc_logs
  drop constraint if exists abc_logs_logged_by_role_check;
alter table public.abc_logs
  add constraint abc_logs_logged_by_role_check
  check (logged_by_role in ('parent', 'class_teacher', 'clinician', 'sna', 'principal', 'clinical_lead', 'care_staff'));

alter table public.abc_logs
  add column stay_id uuid references public.respite_stays (id) on delete set null;

comment on column public.abc_logs.stay_id is
  'Nullable by necessity, not looseness: abc_logs is passport-wide -- a parent logs at home, a clinician logs about their own client, neither during a stay. Only an entry logged by care_staff during an active respite stay carries a stay_id; every other role''s entry leaves it null. The report reads entries WITH a given stay''s id. Never make this column required.';

alter table public.abc_logs
  add constraint abc_logs_care_staff_requires_stay
  check (logged_by_role <> 'care_staff' or stay_id is not null);

create policy "Care staff can insert abc logs during an active stay"
  on public.abc_logs
  for insert
  to authenticated
  with check (
    auth.uid() = logged_by
    and logged_by_role = 'care_staff'
    and stay_id is not null
    and exists (
      select 1 from public.respite_stays rs
      where rs.id = abc_logs.stay_id
        and rs.passport_id = abc_logs.passport_id
        and now() >= rs.starts_at
        and now() < rs.ends_at
        and public.institution_staff_has_current_standing(auth.uid(), rs.institution_id)
    )
  );

-- =====================================================================
-- 5. The three episode writers, widened with an additive respite
-- branch each. Reused verbatim otherwise -- read the live 0210/0216
-- definitions directly before writing these, not assumed from memory.
-- =====================================================================

create or replace function public.onboard_clinic_client(
  p_institution_id uuid,
  p_client_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_passport_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if coalesce(trim(p_client_name), '') = '' then
    raise exception 'A client name is required.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and inst.status = 'verified'
      and inst.type in ('clinic', 'respite_centre')
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
      and (
        (inst.type = 'clinic' and (
          s.role in ('principal', 'clinic_admin')
          or (s.role = 'clinician' and inst.practitioner_can_onboard)
        ))
        or (inst.type = 'respite_centre' and s.role = 'centre_manager')
      )
  ) then
    raise exception 'Only a clinical director, admin, (where enabled) a practitioner, or a centre manager can onboard a new client.';
  end if;

  insert into public.passports (child_name, passport_status)
  values (trim(p_client_name), 'not_started')
  returning id into v_passport_id;

  -- approved_by_parent = true here is a compatibility default, not a
  -- consent record -- see 0210's own header and CLAUDE.md's "A COLUMN
  -- NAME IS A CLAIM" entry. Unchanged by this widening -- a respite
  -- centre onboarding its own client has no parent to seek approval
  -- from either.
  insert into public.passport_institution_links (passport_id, institution_id, approved_by_parent, parent_approved_at)
  values (v_passport_id, p_institution_id, true, null);

  insert into public.episodes_of_care (passport_id, institution_id, started_by)
  values (v_passport_id, p_institution_id, auth.uid());

  return v_passport_id;
end;
$$;

grant execute on function public.onboard_clinic_client(uuid, text) to authenticated;

create or replace function public.reopen_clinic_episode(
  p_institution_id uuid,
  p_passport_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_episode_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and inst.status = 'verified'
      and inst.type in ('clinic', 'respite_centre')
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
      and (
        (inst.type = 'clinic' and (
          s.role in ('principal', 'clinic_admin')
          or (s.role = 'clinician' and inst.practitioner_can_onboard)
        ))
        or (inst.type = 'respite_centre' and s.role = 'centre_manager')
      )
  ) then
    raise exception 'Only a clinical director, admin, (where enabled) a practitioner, or a centre manager can reopen an episode.';
  end if;

  if not exists (
    select 1 from public.passport_institution_links pil
    where pil.passport_id = p_passport_id
      and pil.institution_id = p_institution_id
  ) then
    raise exception 'This client has never been linked to your organisation. Use onboarding for a new client.';
  end if;

  if exists (
    select 1 from public.episodes_of_care
    where passport_id = p_passport_id
      and institution_id = p_institution_id
      and ended_at is null
  ) then
    raise exception 'This client already has an active episode of care at your organisation.';
  end if;

  insert into public.episodes_of_care (passport_id, institution_id, started_by)
  values (p_passport_id, p_institution_id, auth.uid())
  returning id into v_episode_id;

  return v_episode_id;
end;
$$;

grant execute on function public.reopen_clinic_episode(uuid, uuid) to authenticated;

create or replace function public.end_clinic_episode(
  p_episode_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_episode public.episodes_of_care;
  v_caller_staff_id uuid;
  v_caller_role text;
  v_caller_institution_type text;
begin
  select * into v_episode from public.episodes_of_care where id = p_episode_id;
  if not found then
    raise exception 'Episode of care not found.';
  end if;

  if v_episode.ended_at is not null then
    raise exception 'This episode of care has already ended.';
  end if;

  if not exists (
    select 1 from public.discharge_reasons dr
    where dr.value = p_reason
      and dr.is_active = true
      and (dr.institution_id is null or dr.institution_id = v_episode.institution_id)
  ) then
    raise exception 'A valid discharge reason is required.';
  end if;

  select s.id, s.role, inst.type into v_caller_staff_id, v_caller_role, v_caller_institution_type
  from public.institution_staff s
  join public.institutions inst on inst.id = s.institution_id
  where s.institution_id = v_episode.institution_id
    and s.user_id = auth.uid()
    and inst.status = 'verified'
    and inst.type in ('clinic', 'respite_centre')
    and public.institution_staff_has_current_standing(s.user_id, s.institution_id);

  if v_caller_role is null or not (
    (v_caller_institution_type = 'clinic' and (
      v_caller_role = 'principal'
      or (
        v_caller_role = 'clinician'
        and exists (
          select 1 from public.institutions inst
          where inst.id = v_episode.institution_id
            and inst.practitioner_can_discharge_own_clients
        )
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = v_episode.passport_id
            and ca.clinician_id = auth.uid()
            and ca.engaged_by = 'institution'
            and ca.engaged_by_institution_id = v_episode.institution_id
            and ca.is_active = true
        )
      )
      or (
        v_caller_role = 'clinical_lead'
        and exists (
          select 1 from public.institutions inst
          where inst.id = v_episode.institution_id
            and inst.lead_can_discharge_within_scope
        )
        and public._lead_episode_in_scope(v_caller_staff_id, p_episode_id)
      )
    ))
    or (v_caller_institution_type = 'respite_centre' and v_caller_role = 'centre_manager')
  ) then
    raise exception 'Only a clinical director, a practitioner discharging their own client (where enabled), a lead discharging within their own scope (where enabled), or a centre manager, can end an episode of care.';
  end if;

  update public.episodes_of_care
  set ended_at = now(), ended_by = auth.uid(), end_reason = p_reason
  where id = p_episode_id
    and ended_at is null;
end;
$$;

grant execute on function public.end_clinic_episode(uuid, text) to authenticated;

-- =====================================================================
-- 6. generate_institution_link_code_for_clinic() -- decision 4's own
-- new generator, alongside generate_institution_link_code() (0294),
-- which is untouched.
-- =====================================================================
create or replace function public.generate_institution_link_code_for_clinic(p_passport_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_child_name text;
  v_prefix text;
  v_code text;
  v_found boolean := false;
  v_attempt int;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.user_id = v_uid
      and inst.status = 'verified'
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(v_uid, s.institution_id)
      and s.role in ('principal', 'clinic_admin', 'clinical_lead', 'clinician')
      and (
        exists (
          select 1 from public.episodes_of_care e
          where e.passport_id = p_passport_id
            and e.institution_id = s.institution_id
            and e.ended_at is null
        )
        or (
          -- Caught by the build's own clinician-role-target scanner:
          -- a bare `role = 'clinician'` here would be this session's
          -- own already-documented bug class (CLAUDE.md's "QUEUED: A
          -- FULL SWEEP FOR role = 'clinician' LITERAL CHECKS..." entry)
          -- -- PRD 10 section 4a made a director/clinical_lead genuine
          -- practitioners too, so either can hold their own real
          -- clinician_access row with no institutional episode behind
          -- it yet. Widened to match 0275/0276/0277's own fix for the
          -- identical shape, before this ever shipped as a live gap.
          s.role in ('clinician', 'clinical_lead', 'principal')
          and exists (
            select 1 from public.clinician_access ca
            where ca.passport_id = p_passport_id
              and ca.clinician_id = v_uid
              and ca.is_active = true
          )
        )
      )
  ) then
    raise exception 'Only clinic staff with a current relationship to this client can generate a link code.';
  end if;

  select p.child_name into v_child_name from public.passports p where p.id = p_passport_id;
  if v_child_name is null then
    raise exception 'Passport not found.';
  end if;

  -- Same shared-table, single-active-code convention generate_
  -- institution_link_code() (0294) already established -- a fresh
  -- code here revokes any outstanding one regardless of who generated
  -- it, matching the table's own partial unique index.
  update public.passport_link_codes
  set revoked_at = now(), revoked_by = v_uid
  where passport_id = p_passport_id
    and revoked_at is null
    and redeemed_at is null;

  v_prefix := upper(left(regexp_replace(coalesce(v_child_name, 'CHD'), '[^a-zA-Z]', '', 'g') || 'XXX', 3));

  for v_attempt in 1..10 loop
    v_code := v_prefix || '-' || lpad(floor(random() * 10000)::int::text, 4, '0');
    if not exists (select 1 from public.passport_link_codes where code = v_code) then
      v_found := true;
      exit;
    end if;
  end loop;

  if not v_found then
    raise exception 'Could not generate a unique code. Please try again.';
  end if;

  insert into public.passport_link_codes (passport_id, code, created_by, expires_at)
  values (p_passport_id, v_code, v_uid, now() + interval '7 days');

  return v_code;
end;
$$;

grant execute on function public.generate_institution_link_code_for_clinic(uuid) to authenticated;

-- =====================================================================
-- 6b. activity_log.event_type -- widened for respite_centre_linked.
-- The LIVE definition is 0246's, not 0228's (0246 is the higher-
-- numbered migration and the one that actually touched this constraint
-- last -- confirmed by reading it directly rather than assuming 0228
-- was still current). Reproduced verbatim, one value added.
-- =====================================================================
alter table public.activity_log drop constraint if exists activity_log_event_type_check;
alter table public.activity_log add constraint activity_log_event_type_check
  check (event_type in (
    'passport_updated', 'morning_checkin', 'afternoon_update', 'abc_logged',
    'passport_shared', 'team_linked', 'clinician_logged', 'strategy_logged',
    'access_revoked', 'fba_started', 'fba_completed', 'clinical_content_added',
    'questionnaire_sent', 'questionnaire_completed', 'calm_escalation',
    'session_note_shared', 'session_note_updated', 'clinical_export_generated',
    'respite_centre_linked'
  ));

-- =====================================================================
-- 7. The respite arm on redemption -- peek_institution_link_code() and
-- redeem_institution_link_code() both widened. Read live 0294 bodies
-- directly before writing these; the school branch is reproduced
-- byte-identical, the respite branch is additive.
-- =====================================================================

create or replace function public.peek_institution_link_code(p_code text)
returns table (passport_id uuid, child_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_recent_failures integer;
  v_link_id uuid;
  v_passport_id uuid;
  v_expires_at timestamptz;
  v_revoked_at timestamptz;
  v_redeemed_at timestamptz;
  v_child_name text;
  v_display_name text;
  v_parts text[];
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.user_id = v_uid
      and public.institution_staff_has_current_standing(v_uid, s.institution_id)
      and inst.status = 'verified'
      and (
        (inst.type = 'school' and s.role = 'principal')
        or (inst.type = 'respite_centre' and s.role = 'centre_manager')
      )
  ) then
    raise exception 'Only an active, verified principal or centre manager can look up a link code.';
  end if;

  select count(*) into v_recent_failures
  from public.code_lookup_attempts
  where user_id = v_uid
    and lookup_type = 'institution_link'
    and attempted_at > now() - interval '1 hour';

  if v_recent_failures >= 10 then
    raise exception 'Too many failed attempts. Please try again later.';
  end if;

  select lc.id, lc.passport_id, lc.expires_at, lc.revoked_at, lc.redeemed_at, p.child_name
  into v_link_id, v_passport_id, v_expires_at, v_revoked_at, v_redeemed_at, v_child_name
  from public.passport_link_codes lc
  join public.passports p on p.id = lc.passport_id
  where lc.code ilike p_code
  limit 1;

  if v_link_id is null then
    insert into public.code_lookup_attempts (user_id, lookup_type) values (v_uid, 'institution_link');
    return;
  end if;

  if v_revoked_at is not null then
    raise exception 'This code has been revoked. Please ask the family for a new one.';
  end if;

  if v_redeemed_at is not null then
    raise exception 'This code has already been used. Please ask the family for a new one.';
  end if;

  if v_expires_at < now() then
    raise exception 'This code has expired. Please ask the family for a new one.';
  end if;

  v_parts := regexp_split_to_array(trim(v_child_name), '\s+');
  if array_length(v_parts, 1) = 1 then
    v_display_name := v_parts[1];
  else
    v_display_name := v_parts[1] || ' ' || upper(left(v_parts[array_length(v_parts, 1)], 1)) || '.';
  end if;

  return query select v_passport_id, v_display_name;
end;
$$;

revoke all on function public.peek_institution_link_code(text) from public;
revoke all on function public.peek_institution_link_code(text) from anon;
revoke all on function public.peek_institution_link_code(text) from authenticated;
grant execute on function public.peek_institution_link_code(text) to authenticated;

create or replace function public.redeem_institution_link_code(p_institution_id uuid, p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_recent_failures integer;
  v_link_id uuid;
  v_passport_id uuid;
  v_expires_at timestamptz;
  v_revoked_at timestamptz;
  v_redeemed_at timestamptz;
  v_institution_name text;
  v_institution_type text;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  select inst.type into v_institution_type from public.institutions inst where inst.id = p_institution_id;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = v_uid
      and public.institution_staff_has_current_standing(v_uid, p_institution_id)
      and inst.status = 'verified'
      and (
        (inst.type = 'school' and s.role = 'principal')
        or (inst.type = 'respite_centre' and s.role = 'centre_manager')
      )
  ) then
    raise exception 'Only an active, verified principal or centre manager can link an existing record to your organisation.';
  end if;

  select count(*) into v_recent_failures
  from public.code_lookup_attempts
  where user_id = v_uid
    and lookup_type = 'institution_link'
    and attempted_at > now() - interval '1 hour';

  if v_recent_failures >= 10 then
    raise exception 'Too many failed attempts. Please try again later.';
  end if;

  select lc.id, lc.passport_id, lc.expires_at, lc.revoked_at, lc.redeemed_at
  into v_link_id, v_passport_id, v_expires_at, v_revoked_at, v_redeemed_at
  from public.passport_link_codes lc
  where lc.code ilike p_code
  limit 1;

  if v_link_id is null then
    insert into public.code_lookup_attempts (user_id, lookup_type) values (v_uid, 'institution_link');
    raise exception 'We couldn''t find a record with that code. Please check with the family and try again.';
  end if;

  if v_revoked_at is not null then
    raise exception 'This code has been revoked. Please ask the family for a new one.';
  end if;

  if v_redeemed_at is not null then
    raise exception 'This code has already been used. Please ask the family for a new one.';
  end if;

  if v_expires_at < now() then
    raise exception 'This code has expired. Please ask the family for a new one.';
  end if;

  if exists (
    select 1 from public.passport_institution_links pil
    where pil.passport_id = v_passport_id and pil.institution_id = p_institution_id
  ) then
    raise exception 'This child is already linked to your organisation.';
  end if;

  -- School-specific: enrolments_one_active_per_child is a GLOBAL
  -- uniqueness constraint, so a school redemption must refuse an
  -- already-enrolled-elsewhere child explicitly (0294's own reasoning,
  -- unchanged). Respite has no equivalent global constraint -- decision
  -- 2 leaves episodes_of_care's own per-institution scoping exactly as
  -- it is -- so the respite check below is narrower: only refuse an
  -- ALREADY-ACTIVE placement at THIS SAME centre, matching reopen_
  -- clinic_episode()'s own identical check.
  if v_institution_type = 'school' then
    if exists (
      select 1 from public.enrolments e
      where e.passport_id = v_passport_id and e.ended_at is null
    ) then
      raise exception 'This child is already enrolled at another school. Transferring a child between schools isn''t supported yet -- contact Behaviour Hive.';
    end if;
  elsif v_institution_type = 'respite_centre' then
    if exists (
      select 1 from public.episodes_of_care e
      where e.passport_id = v_passport_id and e.institution_id = p_institution_id and e.ended_at is null
    ) then
      raise exception 'This client already has an active placement at your centre.';
    end if;
  end if;

  update public.passport_link_codes
  set redeemed_at = now(), redeemed_by = v_uid, redeemed_institution_id = p_institution_id
  where id = v_link_id
    and redeemed_at is null
    and revoked_at is null
    and expires_at > now();

  if not found then
    raise exception 'This code has already been used. Please ask the family for a new one.';
  end if;

  -- approved_by_parent = true HERE IS A GENUINE CONSENT RECORD -- 0294's
  -- own reasoning, unchanged: a parent generated (or, per decision 4,
  -- a clinic generated on a family it already has standing with) the
  -- code that authorises this exact link.
  insert into public.passport_institution_links (passport_id, institution_id, approved_by_parent, parent_approved_at)
  values (v_passport_id, p_institution_id, true, now());

  select i.name into v_institution_name from public.institutions i where i.id = p_institution_id;

  if v_institution_type = 'school' then
    insert into public.enrolments (passport_id, institution_id, started_by)
    values (v_passport_id, p_institution_id, v_uid);

    -- team_linked, byte-identical to 0294's own write -- reaches every
    -- clinician holding active clinician_access for this child, via
    -- get_clinician_activity_feed(), and (an already-live, unremarked
    -- side effect of the denylist shape decision 5's own header
    -- explains) the parent's own feed too, since get_parent_activity_
    -- feed() never excluded this type either.
    insert into public.activity_log (passport_id, actor_id, event_type, event_description)
    values (v_passport_id, v_uid, 'team_linked', coalesce(v_institution_name, 'A school') || ' now has access to this record.');
  elsif v_institution_type = 'respite_centre' then
    insert into public.episodes_of_care (passport_id, institution_id, started_by)
    values (v_passport_id, p_institution_id, v_uid);

    -- respite_centre_linked -- decision 5's own new event type,
    -- PARENT-facing (there is no "engaged clinician" audience for a
    -- respite link the way team_linked has one). Reaches the parent's
    -- own activity feed via the same denylist mechanism, zero RPC
    -- change needed -- confirmed by reading get_parent_activity_feed()
    -- directly. Reaches NOBODY if the passport has never been claimed
    -- (no passport_guardians row, owns_passport() false for everyone)
    -- -- see this migration's own header for why that is a real,
    -- disclosed precondition, not a silent gap.
    insert into public.activity_log (passport_id, actor_id, event_type, event_description)
    values (v_passport_id, v_uid, 'respite_centre_linked', coalesce(v_institution_name, 'A respite centre') || ' now has access to this record.');
  end if;

  return v_passport_id;
end;
$$;

revoke all on function public.redeem_institution_link_code(uuid, text) from public;
revoke all on function public.redeem_institution_link_code(uuid, text) from anon;
revoke all on function public.redeem_institution_link_code(uuid, text) from authenticated;
grant execute on function public.redeem_institution_link_code(uuid, text) to authenticated;
