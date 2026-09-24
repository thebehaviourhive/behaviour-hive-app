-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 11 STAGE 4 -- THE ACCESS MODEL. Recon reported, confirmed, and
-- built in the same pass, per Daniel's own instruction.
--
-- WHAT ACTIVATION GATES, confirmed before writing a line of SQL:
--   - the passport's behavioural profile (sections B, C, D, E --
--     triggers, communication, calming, medical and intimate care)
--   - the FBA and the BSP (bsp AND bsp_strategies -- the strategies are
--     the point)
--   - calm cards (published only, on a completed FBA -- matching the
--     parent's own existing gate)
--   - clinical_plans -- BODY ONLY. Attachments are deliberately NOT
--     touched by this migration, anywhere -- a respite worker reads
--     the crisis plan's own text but cannot fetch a signed PDF, exactly
--     the way PRD 7 Stage 2 already drew that line for the school
--     track ("uploaded files clinic-only ALWAYS -- a raw report
--     crossing is a deliberate act, never a consequence"). This is the
--     same line, held for a second institution type.
--
-- EXPLICITLY NOT GATED, on purpose: session_notes, assessments (raw
-- Silo 1 material), and every attachment on every table. A clinical
-- lead at the very clinic that WROTE a session note cannot read it --
-- that asymmetry is deliberate (0228/0233) and respite gets nothing
-- more permissive than a clinical_lead at the child's own clinic.
--
-- afls_assessments IS DELIBERATELY EXCLUDED FROM THIS MIGRATION TOO,
-- even though it's part of "the FBA". Same reasoning the clinical
-- export screen already established (0246 header, and this file's own
-- "THE FBA IS NOT TO BE TOUCHED" standing rule): AFLS is raw scored
-- assessment data, not the FBA's own conclusions, and extending it to
-- a new class of reader is a decision nobody has asked for. A respite
-- worker reads fba_reports.content_data (the sections, the strategies)
-- and never afls_assessments. THE FBA ITSELF -- fba_reports' own
-- table, its columns, its RLS shape -- gets exactly one thing done to
-- it in this whole migration: two new ADDITIVE select policies, the
-- same "build around it, never through it" move 0245's cross-org-grant
-- branch already made on this same table. Nothing about fba_reports'
-- own components, save paths, or data shape changes. Standing.
--
-- THE MECHANISM, per Daniel's own precedent naming: a deliberate,
-- write-triggered flip (sign_bsp()'s own shape), never a passive clock
-- comparison (temporary_access's own wrong-precedent shape, confirmed
-- in Stage 1 recon and again here). respite_activations is a new
-- table, one open (closed_at is null) row at most per stay -- a
-- partial unique index enforces that structurally, the same shape
-- clinician_access/episodes_of_care already use for their own
-- "at most one active" guarantees.
--
-- ACTIVATION IS STAY-SCOPED, READ IS STAY-SCOPED -- BUT THE MANAGER'S
-- OWN REACH IS NOT. This is the one thing that could not be gotten
-- from the write side alone, and it is the same split 0299/0300 (the
-- ABC log fix) already established for the identical reason: writing
-- only makes sense while genuinely on site (or, for a report, while
-- assembling one after a stay ends); a centre_manager assembling the
-- post-stay report needs the WHOLE PLACEMENT's own history, not just
-- whatever activation happens to be open right now -- a report is
-- written once the relevant stay has ALREADY ended, so a stay-scoped
-- read would refuse the manager reading the very material the report
-- is about. So: care_staff reads through an OPEN ACTIVATION
-- (respite_activations, closed_at is null); centre_manager reads
-- through the PLACEMENT ITSELF (episodes_of_care, ended_at is null),
-- exactly matching 0299/0300's own two branches, extended to six more
-- tables.
--
-- WHY ABC READ STAYS OUTSIDE THIS GATE ENTIRELY, RECORDED HERE TOO,
-- NOT JUST IN 0299/0300's OWN COMMENTS: if ABC read were inside the
-- activation gate, finalising the report -- the very act that closes
-- activation -- would close read access to the entries the report is
-- assembling from, at the exact moment they're needed. abc_logs'
-- own read stays exactly as 0299/0300 built it: placement-scoped,
-- untouched by anything in this migration.
--
-- THREE WAYS AN ACTIVATION CLOSES, not two -- Daniel's own correction
-- of the original brief ("access ends when the report is finalised,
-- or earlier by hand"). A placement runs for years; a stay from March
-- with no report would otherwise leave staff access open until the
-- child leaves the centre entirely -- a real data protection problem,
-- not a process one:
--   1. report_finalised -- the poka-yoke. finalize_respite_stay_report()
--      closes the stay's own open activation atomically, in the same
--      transaction as finalising the report, the same shape sign_bsp()
--      already uses for its own atomic supersede.
--   2. manual -- a centre_manager closes it by hand, any time, no
--      reason required beyond being the one closing it.
--   3. expired -- a TIMED BACKSTOP. expire_stale_respite_activations()
--      closes any activation whose own stay ended more than 7 days ago
--      and was never otherwise closed. 7 IS A CONSERVATIVE, ARBITRARY
--      STARTING NUMBER, matching the stagnation queue's own evidence
--      floor in spirit -- the real number comes from real use, not
--      invented here. Service-role only, matching
--      purge_stale_app_events()/fail_stale_pending_bookings()'s own
--      established shape -- no grant to authenticated, callable only
--      from a scheduled job or this session's own verification script.
--
-- A FOURTH closing event, added while building this, not asked for
-- directly but the same shape as the other three and worth the same
-- honesty: discharging the WHOLE PLACEMENT (end_clinic_episode()'s own
-- respite branch) now also closes any still-open activation for that
-- exact child at that exact centre, reason 'discharged' -- a coarser,
-- later backstop than the 7-day expiry, so a discharge never leaves a
-- stray open activation dangling after the relationship itself has
-- ended. A no-op for a clinic discharge -- clinics have no activation
-- concept at all.
--
-- THIS DOES NOT BLOCK THE REPORT. A centre_manager's own read of every
-- gated table stays placement-scoped, completely independent of
-- whether any activation is open or closed -- an overdue report can
-- still be written today, next week, or next year, for as long as the
-- placement itself stays open. Staff access is stay-scoped and
-- expires; a manager's reach is placement-scoped and does not. This is
-- the whole reason the two branches are built separately rather than
-- as one shared predicate.
--
-- ACTIVATION CAN BE SET UP IN ADVANCE: activate_respite_stay() has no
-- time-window check against the stay's own starts_at/ends_at at all --
-- a manager may activate before a scheduled stay begins, exactly as
-- asked. The gate a caller passes is "does an open activation exist
-- for this child at my centre", never "is now() inside this stay's own
-- window" -- the deliberate flip is the fact that matters, not a clock.
--
-- OUTSTANDING WORK, DATA ONLY, NO SCREEN YET -- matching PRD 5 Stage
-- 7's own "build the data, not the screen" posture exactly.
-- get_respite_stays_awaiting_report() lists a centre's own stays that
-- have ended with no finalised report -- infrastructure for whichever
-- future pass builds the centre dashboard's own outstanding-work
-- bucket, the same relationship Stage 7's own RPCs had to the director
-- dashboard that was eventually built around them.
--
-- THE FBA IS NOT TOUCHED BY ANY PART OF THIS MIGRATION.

-- =====================================================================
-- 1. respite_activations
-- =====================================================================

create table public.respite_activations (
  id uuid primary key default gen_random_uuid(),
  stay_id uuid not null references public.respite_stays (id) on delete cascade,
  institution_id uuid not null references public.institutions (id) on delete cascade,
  passport_id uuid not null references public.passports (id) on delete cascade,
  activated_at timestamptz not null default now(),
  activated_by uuid not null references auth.users (id),
  closed_at timestamptz,
  closed_by uuid references auth.users (id),
  closed_reason text check (closed_reason in ('report_finalised', 'manual', 'expired', 'discharged')),
  constraint respite_activations_closed_fields_consistent check (
    (closed_at is null and closed_by is null and closed_reason is null)
    or (closed_at is not null and closed_reason is not null)
  )
);

comment on table public.respite_activations is
  'A deliberate, write-triggered read window for care_staff over a specific respite_stays row -- matching sign_bsp()''s own atomic-flip shape, never temporary_access''s passive clock comparison (confirmed as the wrong precedent in PRD 11 Stage 1 recon and again here). At most one open (closed_at is null) row per stay, enforced structurally below. A centre_manager''s own read of the gated clinical tables never consults this table at all -- their reach is placement-scoped (episodes_of_care), not activation-scoped, so a manager can always write the post-stay report regardless of whether this row is open, closed, or never existed.';

create unique index respite_activations_one_open_per_stay
  on public.respite_activations (stay_id)
  where closed_at is null;

create index respite_activations_passport_id_idx on public.respite_activations (passport_id);
create index respite_activations_institution_id_idx on public.respite_activations (institution_id);

alter table public.respite_activations enable row level security;

-- Institution-wide read for any currently-standing staff at the centre
-- (centre_manager or care_staff) -- this table carries no clinical
-- content of its own, only the fact and timing of an access window, so
-- there's no reason to narrow this further than "you work here".
create policy "Institution staff can view their own centre's activations"
  on public.respite_activations
  for select
  to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.institution_id = respite_activations.institution_id
        and s.role in ('centre_manager', 'care_staff')
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  );

-- No client INSERT/UPDATE policy at all -- every transition goes
-- through activate_respite_stay() / close_respite_activation() /
-- finalize_respite_stay_report() / expire_stale_respite_activations(),
-- matching bsp's/episodes_of_care's own "functions only" posture.

-- =====================================================================
-- 2. respite_post_stay_reports
-- =====================================================================

create table public.respite_post_stay_reports (
  id uuid primary key default gen_random_uuid(),
  stay_id uuid not null references public.respite_stays (id) on delete cascade,
  institution_id uuid not null references public.institutions (id) on delete cascade,
  passport_id uuid not null references public.passports (id) on delete cascade,
  body text,
  finalized_at timestamptz,
  finalized_by uuid references auth.users (id),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.respite_post_stay_reports is
  'One report per stay -- a minimal shape (free-text body) built only far enough to give finalisation a real, atomic side effect (closing the stay''s own open activation). The report''s own real content model -- ABC entries assembling in rather than being retyped, per PRD 11 section 7 -- is not built by this migration; this table exists so that mechanism has somewhere real to land.';

create unique index respite_post_stay_reports_one_per_stay
  on public.respite_post_stay_reports (stay_id);

create index respite_post_stay_reports_institution_id_idx on public.respite_post_stay_reports (institution_id);

create trigger respite_post_stay_reports_touch_updated_at
  before update on public.respite_post_stay_reports
  for each row
  execute function public.set_updated_at();

alter table public.respite_post_stay_reports enable row level security;

-- Placement-scoped, centre_manager only -- matching the manager's own
-- read reach on every clinical table below, never activation-scoped.
create policy "Centre managers can view their own centre's post-stay reports"
  on public.respite_post_stay_reports
  for select
  to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.institution_id = respite_post_stay_reports.institution_id
        and s.role = 'centre_manager'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  );

-- No client INSERT/UPDATE policy -- creation, drafting, and
-- finalisation all go through finalize_respite_stay_report() below,
-- which is deliberately the ONLY write path (a draft-and-save-without-
-- finalising step is real future work this migration doesn't build).

-- =====================================================================
-- 3. RPCs
-- =====================================================================

create or replace function public.activate_respite_stay(p_stay_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stay public.respite_stays;
  v_activation_id uuid;
begin
  select * into v_stay from public.respite_stays where id = p_stay_id;
  if not found then
    raise exception 'Stay not found.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    where s.user_id = auth.uid()
      and s.institution_id = v_stay.institution_id
      and s.role = 'centre_manager'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'Only a centre manager can activate a stay.';
  end if;

  if exists (
    select 1 from public.respite_activations
    where stay_id = p_stay_id and closed_at is null
  ) then
    raise exception 'This stay is already active.';
  end if;

  insert into public.respite_activations (stay_id, institution_id, passport_id, activated_by)
  values (p_stay_id, v_stay.institution_id, v_stay.passport_id, auth.uid())
  returning id into v_activation_id;

  return v_activation_id;
end;
$$;

grant execute on function public.activate_respite_stay(uuid) to authenticated;

create or replace function public.close_respite_activation(p_activation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activation public.respite_activations;
begin
  select * into v_activation from public.respite_activations where id = p_activation_id;
  if not found then
    raise exception 'Activation not found.';
  end if;

  if v_activation.closed_at is not null then
    raise exception 'This activation is already closed.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    where s.user_id = auth.uid()
      and s.institution_id = v_activation.institution_id
      and s.role = 'centre_manager'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'Only a centre manager can close an activation.';
  end if;

  update public.respite_activations
  set closed_at = now(), closed_by = auth.uid(), closed_reason = 'manual'
  where id = p_activation_id
    and closed_at is null;
end;
$$;

grant execute on function public.close_respite_activation(uuid) to authenticated;

-- THE POKA-YOKE: finalising the report and closing the stay's own open
-- activation happen in the SAME transaction, the same shape sign_bsp()
-- already uses for its own atomic supersede -- a caller cannot
-- finalise a report and separately "forget" to close access, because
-- there is no separate step to forget.
create or replace function public.finalize_respite_stay_report(
  p_stay_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stay public.respite_stays;
  v_report_id uuid;
  v_existing public.respite_post_stay_reports;
begin
  select * into v_stay from public.respite_stays where id = p_stay_id;
  if not found then
    raise exception 'Stay not found.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    where s.user_id = auth.uid()
      and s.institution_id = v_stay.institution_id
      and s.role = 'centre_manager'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'Only a centre manager can finalise a post-stay report.';
  end if;

  select * into v_existing from public.respite_post_stay_reports where stay_id = p_stay_id;

  if v_existing.id is not null and v_existing.finalized_at is not null then
    raise exception 'This report has already been finalised.';
  end if;

  if v_existing.id is not null then
    update public.respite_post_stay_reports
    set body = p_body, finalized_at = now(), finalized_by = auth.uid()
    where id = v_existing.id
    returning id into v_report_id;
  else
    insert into public.respite_post_stay_reports
      (stay_id, institution_id, passport_id, body, finalized_at, finalized_by, created_by)
    values
      (p_stay_id, v_stay.institution_id, v_stay.passport_id, p_body, now(), auth.uid(), auth.uid())
    returning id into v_report_id;
  end if;

  update public.respite_activations
  set closed_at = now(), closed_by = auth.uid(), closed_reason = 'report_finalised'
  where stay_id = p_stay_id
    and closed_at is null;

  return v_report_id;
end;
$$;

grant execute on function public.finalize_respite_stay_report(uuid, text) to authenticated;

-- Service-role only, no grant to authenticated -- matching
-- purge_stale_app_events()/fail_stale_pending_bookings()'s own
-- established shape exactly. p_grace_days defaults to 7, a deliberately
-- conservative, arbitrary starting number -- the real number comes
-- from real use, not invented here.
create or replace function public.expire_stale_respite_activations(p_grace_days integer default 7)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closed bigint;
begin
  update public.respite_activations a
  set closed_at = now(), closed_reason = 'expired'
  from public.respite_stays s
  where a.stay_id = s.id
    and a.closed_at is null
    and s.ends_at < now() - (p_grace_days || ' days')::interval;
  get diagnostics v_closed = row_count;
  return v_closed;
end;
$$;

-- Outstanding work, data only -- a stay whose own window has ended
-- with no finalised report against it. No UI consumes this yet.
create or replace function public.get_respite_stays_awaiting_report(p_institution_id uuid)
returns table (
  stay_id uuid,
  passport_id uuid,
  child_name text,
  ends_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not exists (
    select 1 from public.institution_staff s
    where s.user_id = auth.uid()
      and s.institution_id = p_institution_id
      and s.role = 'centre_manager'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'Only a centre manager can view this.';
  end if;

  return query
  select rs.id, rs.passport_id, p.child_name, rs.ends_at
  from public.respite_stays rs
  join public.passports p on p.id = rs.passport_id
  left join public.respite_post_stay_reports r on r.stay_id = rs.id and r.finalized_at is not null
  where rs.institution_id = p_institution_id
    and rs.ends_at < now()
    and r.id is null
  order by rs.ends_at asc;
end;
$$;

grant execute on function public.get_respite_stays_awaiting_report(uuid) to authenticated;

-- =====================================================================
-- 4. end_clinic_episode() widened -- discharge as a fourth, coarser
-- backstop. Same signature, CREATE OR REPLACE is safe.
-- =====================================================================

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

  -- Respite only, added in this migration: discharging the whole
  -- placement is a coarser, later backstop than the 7-day expiry
  -- above -- closes any activation still open for this exact child at
  -- this exact centre, so a discharge never leaves a stray open
  -- activation dangling after the relationship itself has ended. A
  -- no-op for a clinic discharge -- clinics have no activation concept.
  if v_caller_institution_type = 'respite_centre' then
    update public.respite_activations
    set closed_at = now(), closed_by = auth.uid(), closed_reason = 'discharged'
    where passport_id = v_episode.passport_id
      and institution_id = v_episode.institution_id
      and closed_at is null;
  end if;
end;
$$;

-- =====================================================================
-- 5. THE READ GATE ITSELF, one table at a time.
--
-- Every one of the eight targets below gets the identical shape,
-- twice: a centre_manager branch (placement-scoped, episodes_of_care)
-- and a care_staff branch (activation-scoped, respite_activations,
-- with an additional episodes_of_care check as a structural belt-and-
-- braces -- a discharged placement closes staff read even in the rare
-- case an activation was never explicitly closed).
-- =====================================================================

-- 5a. passport_section_b/c/d/e -- the behavioural profile.

create policy "Centre managers can view section B for a child active at their centre"
  on public.passport_section_b for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.role = 'centre_manager'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
        and exists (
          select 1 from public.episodes_of_care e
          where e.passport_id = passport_section_b.passport_id
            and e.institution_id = s.institution_id
            and e.ended_at is null
        )
    )
  );

create policy "Care staff can view section B for a child active at their centre"
  on public.passport_section_b for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.role = 'care_staff'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
        and exists (
          select 1 from public.respite_activations a
          where a.passport_id = passport_section_b.passport_id
            and a.institution_id = s.institution_id
            and a.closed_at is null
        )
        and exists (
          select 1 from public.episodes_of_care e
          where e.passport_id = passport_section_b.passport_id
            and e.institution_id = s.institution_id
            and e.ended_at is null
        )
    )
  );

create policy "Centre managers can view section C for a child active at their centre"
  on public.passport_section_c for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.role = 'centre_manager'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
        and exists (
          select 1 from public.episodes_of_care e
          where e.passport_id = passport_section_c.passport_id
            and e.institution_id = s.institution_id
            and e.ended_at is null
        )
    )
  );

create policy "Care staff can view section C for a child active at their centre"
  on public.passport_section_c for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.role = 'care_staff'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
        and exists (
          select 1 from public.respite_activations a
          where a.passport_id = passport_section_c.passport_id
            and a.institution_id = s.institution_id
            and a.closed_at is null
        )
        and exists (
          select 1 from public.episodes_of_care e
          where e.passport_id = passport_section_c.passport_id
            and e.institution_id = s.institution_id
            and e.ended_at is null
        )
    )
  );

create policy "Centre managers can view section D for a child active at their centre"
  on public.passport_section_d for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.role = 'centre_manager'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
        and exists (
          select 1 from public.episodes_of_care e
          where e.passport_id = passport_section_d.passport_id
            and e.institution_id = s.institution_id
            and e.ended_at is null
        )
    )
  );

create policy "Care staff can view section D for a child active at their centre"
  on public.passport_section_d for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.role = 'care_staff'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
        and exists (
          select 1 from public.respite_activations a
          where a.passport_id = passport_section_d.passport_id
            and a.institution_id = s.institution_id
            and a.closed_at is null
        )
        and exists (
          select 1 from public.episodes_of_care e
          where e.passport_id = passport_section_d.passport_id
            and e.institution_id = s.institution_id
            and e.ended_at is null
        )
    )
  );

create policy "Centre managers can view section E for a child active at their centre"
  on public.passport_section_e for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.role = 'centre_manager'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
        and exists (
          select 1 from public.episodes_of_care e
          where e.passport_id = passport_section_e.passport_id
            and e.institution_id = s.institution_id
            and e.ended_at is null
        )
    )
  );

create policy "Care staff can view section E for a child active at their centre"
  on public.passport_section_e for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.role = 'care_staff'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
        and exists (
          select 1 from public.respite_activations a
          where a.passport_id = passport_section_e.passport_id
            and a.institution_id = s.institution_id
            and a.closed_at is null
        )
        and exists (
          select 1 from public.episodes_of_care e
          where e.passport_id = passport_section_e.passport_id
            and e.institution_id = s.institution_id
            and e.ended_at is null
        )
    )
  );

-- 5b. fba_reports -- completed only, matching the parent's own gate.
-- content_data only; afls_assessments is not touched by this migration.

create policy "Centre managers can view a completed FBA for a child active at their centre"
  on public.fba_reports for select to authenticated
  using (
    status = 'completed'
    and exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.role = 'centre_manager'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
        and exists (
          select 1 from public.episodes_of_care e
          where e.passport_id = fba_reports.passport_id
            and e.institution_id = s.institution_id
            and e.ended_at is null
        )
    )
  );

create policy "Care staff can view a completed FBA for a child active at their centre"
  on public.fba_reports for select to authenticated
  using (
    status = 'completed'
    and exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.role = 'care_staff'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
        and exists (
          select 1 from public.respite_activations a
          where a.passport_id = fba_reports.passport_id
            and a.institution_id = s.institution_id
            and a.closed_at is null
        )
        and exists (
          select 1 from public.episodes_of_care e
          where e.passport_id = fba_reports.passport_id
            and e.institution_id = s.institution_id
            and e.ended_at is null
        )
    )
  );

-- 5c. bsp -- active only ("the strategies" currently in force; a
-- superseded plan's own history is out of scope for this pass).
-- bsp_strategies inherits this for free via _bsp_is_readable_by_caller()
-- below, the same lever 0245 already used for its own cross-org branch.

create policy "Centre managers can view an active BSP for a child active at their centre"
  on public.bsp for select to authenticated
  using (
    status = 'active'
    and exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.role = 'centre_manager'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
        and exists (
          select 1 from public.episodes_of_care e
          where e.passport_id = bsp.passport_id
            and e.institution_id = s.institution_id
            and e.ended_at is null
        )
    )
  );

create policy "Care staff can view an active BSP for a child active at their centre"
  on public.bsp for select to authenticated
  using (
    status = 'active'
    and exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.role = 'care_staff'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
        and exists (
          select 1 from public.respite_activations a
          where a.passport_id = bsp.passport_id
            and a.institution_id = s.institution_id
            and a.closed_at is null
        )
        and exists (
          select 1 from public.episodes_of_care e
          where e.passport_id = bsp.passport_id
            and e.institution_id = s.institution_id
            and e.ended_at is null
        )
    )
  );

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
          and exists (
            select 1 from public.institution_staff s
            where s.user_id = auth.uid()
              and s.role = 'centre_manager'
              and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
              and exists (
                select 1 from public.episodes_of_care e
                where e.passport_id = b.passport_id
                  and e.institution_id = s.institution_id
                  and e.ended_at is null
              )
          )
        )
        or (
          b.status = 'active'
          and exists (
            select 1 from public.institution_staff s
            where s.user_id = auth.uid()
              and s.role = 'care_staff'
              and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
              and exists (
                select 1 from public.respite_activations a
                where a.passport_id = b.passport_id
                  and a.institution_id = s.institution_id
                  and a.closed_at is null
              )
              and exists (
                select 1 from public.episodes_of_care e
                where e.passport_id = b.passport_id
                  and e.institution_id = s.institution_id
                  and e.ended_at is null
              )
          )
        )
      )
  );
$$;

-- 5d. fba_calm_cards -- published only, on a completed FBA, matching
-- the parent's own existing gate exactly.

create policy "Centre managers can view published calm cards for a child active at their centre"
  on public.fba_calm_cards for select to authenticated
  using (
    is_published = true
    and exists (
      select 1 from public.fba_reports fr
      where fr.id = fba_calm_cards.fba_id
        and fr.status = 'completed'
        and exists (
          select 1 from public.institution_staff s
          where s.user_id = auth.uid()
            and s.role = 'centre_manager'
            and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
            and exists (
              select 1 from public.episodes_of_care e
              where e.passport_id = fr.passport_id
                and e.institution_id = s.institution_id
                and e.ended_at is null
            )
        )
    )
  );

create policy "Care staff can view published calm cards for a child active at their centre"
  on public.fba_calm_cards for select to authenticated
  using (
    is_published = true
    and exists (
      select 1 from public.fba_reports fr
      where fr.id = fba_calm_cards.fba_id
        and fr.status = 'completed'
        and exists (
          select 1 from public.institution_staff s
          where s.user_id = auth.uid()
            and s.role = 'care_staff'
            and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
            and exists (
              select 1 from public.respite_activations a
              where a.passport_id = fr.passport_id
                and a.institution_id = s.institution_id
                and a.closed_at is null
            )
            and exists (
              select 1 from public.episodes_of_care e
              where e.passport_id = fr.passport_id
                and e.institution_id = s.institution_id
                and e.ended_at is null
            )
        )
    )
  );

-- 5e. clinical_plans -- BODY ONLY. Deliberately independent of
-- school_visibility_override/_clinical_plan_is_school_visible() -- that
-- flag governs SCHOOL visibility specifically; respite gets its own
-- dedicated gate, the same way FBA/BSP each have their own rather than
-- reusing a column built for a different audience. Attachments are
-- NOT touched -- the attachments bridge (_caller_owns_artefact's
-- 'clinical_plan' arm) has no new branch here, matching PRD 7 Stage
-- 2/3's own "uploaded files clinic-only always" line exactly.

create policy "Centre managers can view plans for a child active at their centre"
  on public.clinical_plans for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.role = 'centre_manager'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
        and exists (
          select 1 from public.episodes_of_care e
          where e.passport_id = clinical_plans.passport_id
            and e.institution_id = s.institution_id
            and e.ended_at is null
        )
    )
  );

create policy "Care staff can view plans for a child active at their centre"
  on public.clinical_plans for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.role = 'care_staff'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
        and exists (
          select 1 from public.respite_activations a
          where a.passport_id = clinical_plans.passport_id
            and a.institution_id = s.institution_id
            and a.closed_at is null
        )
        and exists (
          select 1 from public.episodes_of_care e
          where e.passport_id = clinical_plans.passport_id
            and e.institution_id = s.institution_id
            and e.ended_at is null
        )
    )
  );
