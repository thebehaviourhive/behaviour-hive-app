-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 7 Stage 3 -- the artefact model. Sections 11, 13b, 15. Three
-- interlocking pieces, confirmed by Daniel after a recon pass: which
-- silo an artefact belongs to, a domain-tag layer that decides what a
-- COLLEAGUE can do with an artefact they can already reach (never what
-- they can reach in the first place), and a type-level default for
-- school visibility with a per-instance override. This is what makes
-- every future instrument/artefact consistent rather than decided case
-- by case -- the whole point of this stage.
--
-- ===========================================================================
-- 1. THE SILOS, AND WHAT CARRIES THEM.
--
-- Two registries, not one, because the two granularities that already
-- exist in this schema genuinely differ and forcing them into one table
-- would mean mixing a table-name key with a per-instrument uuid key in
-- the same column:
--
--   - assessment_instruments (0231) is ALREADY the correct per-INSTRUMENT
--     registry for Silo 1's instrument-shaped members -- MAS and WISC-V
--     genuinely want different defaults, and that table already varies
--     at that granularity. Extended below with three new columns rather
--     than duplicated into a second table.
--
--   - clinical_artefact_types (new, this migration) is the registry for
--     every OTHER clinical artefact KIND, one row per Postgres table,
--     not per instance -- fba_report (Silo 1, though structurally
--     richer than an instrument), session_note (Silo 3), and bsp (Silo
--     2, once built). Same closed-vocabulary, Behaviour-Hive-controlled,
--     select-only posture as assessment_instruments/cpi_reason_types/
--     discharge_reasons.
--
-- incidents is a genuine Silo-3 shape (event log, its own strict
-- attestation lifecycle) but deliberately NOT included here -- it's a
-- structurally separate track (teacher/SNA/principal-authored, zero
-- clinician involvement, already 100% school-side with no clinic
-- boundary to cross), and neither domain tags nor a school-visibility
-- default means anything for a record with no clinician author and no
-- clinic side to be visible from.
--
-- ONE RESOLUTION FUNCTION, per Daniel's explicit condition: two
-- registries is fine; two registries plus every future caller deciding
-- for itself which one to query is the "six hand-rolled copies" shape
-- this schema has a standing entry against. resolve_clinical_artefact_
-- type() is the only place that decision is made, ever -- see part 4.
-- ===========================================================================

-- The six domain values, once, as a native Postgres type rather than a
-- text[] CHECK repeated across five separate columns (clinical_artefact_
-- types, assessment_instruments, assessments, fba_reports, clinicians --
-- five places that would otherwise all need the identical six-literal
-- array edited in lockstep the day a seventh domain is added). This
-- schema's own dominant idiom elsewhere is text+CHECK, not a native
-- enum -- deliberately departed from here because this is the one
-- vocabulary genuinely shared across five tables at once, which no
-- other CHECK-constrained column in this schema is.
create type public.clinical_domain as enum (
  'cognition',
  'behaviour_analysis',
  'communication',
  'sensory_motor',
  'adaptive_living',
  'statutory_education'
);

-- ===========================================================================
-- clinical_artefact_types -- the non-instrument registry.
-- ===========================================================================

create table public.clinical_artefact_types (
  -- Deliberately excludes 'assessment' -- that kind resolves through
  -- assessment_instruments by instrument id, never through a row here.
  -- The CHECK below is the closed list this migration knows about;
  -- adding bsp when it's built means widening this constraint the same
  -- way attachments.artefact_type already gets widened one arm at a
  -- time.
  artefact_type text primary key check (artefact_type in ('fba_report', 'session_note')),
  silo text not null check (silo in ('assessment', 'framework', 'log')),
  default_domain_tags public.clinical_domain[] not null default '{}',
  default_school_visibility text check (default_school_visibility in ('clinic_only', 'shareable')),
  created_at timestamptz not null default now()
);

alter table public.clinical_artefact_types enable row level security;

create policy "Clinical artefact type registry is readable by every authenticated user"
  on public.clinical_artefact_types for select to authenticated
  using (true);

-- No write policy at all -- Behaviour-Hive-controlled, same posture as
-- assessment_instruments/cpi_reason_types/discharge_reasons.

-- fba_report: silo 'assessment' (point-in-time, drafted then locked),
-- default_domain_tags seeded to behaviour_analysis (an FBA is
-- fundamentally a behaviour-analytic document; real cases can and do
-- span further -- per-instance domain_tags on fba_reports, below, is
-- what lets a clinician widen this for a case that genuinely touches
-- communication or sensory_motor too). default_school_visibility is
-- NULL -- deliberately, not an oversight: FBA's own school-crossing
-- mechanism is passport_clinical_content.item_type, chosen per section
-- at authoring time (trigger/setting_event/strategy_home/strategy_
-- school/strategy_shared) -- already more expressive than a single
-- type-level default would be, confirmed during this stage's own
-- recon. FBA keeps that mechanism exactly as it is; this migration adds
-- no default_school_visibility value for it and no new column on
-- fba_reports to hold one.
--
-- session_note: silo 'log', default_domain_tags left EMPTY, deliberately,
-- and default_school_visibility NULL, deliberately -- read the entry
-- below before assuming either is an oversight.
--
-- ***************************************************************************
-- WHY SESSION_NOTE SITS IN THIS REGISTRY WITH NO DOMAIN LAYER OF ITS OWN,
-- SO NOBODY LATER ADDS ONE "FOR CONSISTENCY":
--
-- session_notes' own SELECT policy (0228, tightened 0233) is already
-- STRICTER than what a domain-tag colleague branch would produce: only
-- the author (with live clinician_access) or their clinic's own
-- director may read a session note -- no peer-colleague branch exists
-- at all, for anyone, regardless of domain. Adding domain-tag gating
-- here would not be adding a restriction on top of an open policy; it
-- would be OPENING a policy that is deliberately closed to every
-- colleague today. A session note is a clinician's own write-up of an
-- encounter -- the raw material that FEEDS a Silo-1 analysis, never
-- itself something a same-domain colleague is meant to browse. Domain
-- tags exist to let a legitimate MDT colleague read a teammate's
-- FINISHED assessment or plan; they were never meant to open a private
-- clinical diary to anyone whose specialty happens to overlap.
--
-- Structurally this needs no enforcement beyond leaving session_notes'
-- own RLS untouched -- there is no peer branch on that table for a
-- domain tag to modify, so the gate is enforced by absence, not by a
-- special-cased skip. The registry row exists only so silo
-- classification for session_note lives in the same place as every
-- other artefact kind's; its own default_domain_tags/default_school_
-- visibility values are inert by construction and must stay that way.
-- ***************************************************************************
insert into public.clinical_artefact_types (artefact_type, silo, default_domain_tags, default_school_visibility) values
  ('fba_report', 'assessment', array['behaviour_analysis']::public.clinical_domain[], null),
  ('session_note', 'log', '{}'::public.clinical_domain[], null);

-- ===========================================================================
-- 2. assessment_instruments -- extended, not duplicated, with the same
-- three type-level facts. silo is forced to 'assessment' by its own
-- CHECK (every row in this table only ever backs a Silo-1 record, or --
-- for the FBA row specifically, record_type = 'built_in_full' -- backs
-- no assessments row at all, per 0231's own trigger refusal) so the
-- resolution function's own shape stays uniform across both registries
-- without a caller needing to know which one is constant.
-- ===========================================================================

alter table public.assessment_instruments
  add column silo text not null default 'assessment' check (silo = 'assessment'),
  add column default_domain_tags public.clinical_domain[] not null default '{}',
  add column default_school_visibility text check (default_school_visibility in ('clinic_only', 'shareable'));

-- Seeded defaults below are a first, reasonable clinical classification,
-- not a clinically-authored vocabulary -- flagged for Catherine's
-- review, same posture this schema already takes with discharge_reasons'
-- own seed list. Editable per-instance (assessments.domain_tags, part 3)
-- regardless of what's set here.
--
-- 'diagnostic assessments clinic-only' (Daniel's own framing) applies to
-- every seeded instrument except FBA, whose own row is left with no
-- default_domain_tags/default_school_visibility value at all -- both are
-- structurally unreachable for it, since a built_in_full instrument can
-- never produce an assessments row for either column to apply to.
update public.assessment_instruments set
  default_domain_tags = array['behaviour_analysis']::public.clinical_domain[],
  default_school_visibility = 'clinic_only'
  where name = 'MAS';
update public.assessment_instruments set
  default_domain_tags = array['behaviour_analysis']::public.clinical_domain[],
  default_school_visibility = 'clinic_only'
  where name = 'QABF';
update public.assessment_instruments set
  default_domain_tags = array['cognition']::public.clinical_domain[],
  default_school_visibility = 'clinic_only'
  where name = 'WISC-V';
update public.assessment_instruments set
  default_domain_tags = array['communication', 'behaviour_analysis']::public.clinical_domain[],
  default_school_visibility = 'clinic_only'
  where name = 'ADOS-2';
update public.assessment_instruments set
  default_domain_tags = array['adaptive_living']::public.clinical_domain[],
  default_school_visibility = 'clinic_only'
  where name = 'Vineland-3';
update public.assessment_instruments set
  default_domain_tags = array['behaviour_analysis']::public.clinical_domain[],
  default_school_visibility = 'clinic_only'
  where name = 'BASC-3';
update public.assessment_instruments set
  default_domain_tags = array['behaviour_analysis', 'communication']::public.clinical_domain[],
  default_school_visibility = 'clinic_only'
  where name = 'CARS-2';
update public.assessment_instruments set
  default_domain_tags = array['communication', 'behaviour_analysis']::public.clinical_domain[],
  default_school_visibility = 'clinic_only'
  where name = 'ADI-R';
-- 'FBA' left as-is: default_domain_tags '{}', default_school_visibility
-- null -- both genuinely unreachable, see the migration header above.

-- ===========================================================================
-- 3. The single resolution function. Every future caller -- an insert
-- trigger, a column default, a client screen prefilling a new
-- assessment/FBA's own domain tags, whatever asks next -- calls this,
-- never queries either registry directly. p_artefact_type = 'assessment'
-- means "look in assessment_instruments by p_instrument_id"; any other
-- value means "look in clinical_artefact_types by that key directly".
-- One function, one branch point, so the which-registry decision is
-- never re-implemented at a second call site.
-- ===========================================================================

create or replace function public.resolve_clinical_artefact_type(
  p_artefact_type text,
  p_instrument_id uuid default null
)
returns table (
  silo text,
  default_domain_tags public.clinical_domain[],
  default_school_visibility text
)
language sql
security definer
set search_path = public
stable
as $$
  select ai.silo, ai.default_domain_tags, ai.default_school_visibility
  from public.assessment_instruments ai
  where p_artefact_type = 'assessment' and ai.id = p_instrument_id
  union all
  select cat.silo, cat.default_domain_tags, cat.default_school_visibility
  from public.clinical_artefact_types cat
  where p_artefact_type <> 'assessment' and cat.artefact_type = p_artefact_type;
$$;

grant execute on function public.resolve_clinical_artefact_type(text, uuid) to authenticated;

-- ===========================================================================
-- 4. assessments -- domain_tags (per-instance, seeded from the chosen
-- instrument's own default at insert, editable afterward) and
-- school_visibility_override (nullable -- null means "inherit the
-- instrument's own default_school_visibility"; forward infrastructure
-- only, not yet consulted by anything -- the school-facing READ path
-- for this content is a real, separate stage, same posture Stage 1's
-- own SELECT-policy comment already took for the director branch that
-- Stage 2 later built).
-- ===========================================================================

alter table public.assessments
  add column domain_tags public.clinical_domain[] not null default '{}',
  add column school_visibility_override text
    check (school_visibility_override is null or school_visibility_override in ('clinic_only', 'shareable'));

-- Extends 0231's own record_type-deriving trigger rather than adding a
-- second one -- both facts come from the same instrument lookup, no
-- reason to query assessment_instruments twice per insert. Goes through
-- resolve_clinical_artefact_type() rather than querying assessment_
-- instruments directly, per part 3's own rule -- even here, inside the
-- one place that already knows it's instrument-backed, the single
-- resolution function is still the one source, not a second
-- hand-rolled lookup.
create or replace function public._assessments_set_record_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record_type text;
  v_default_domain_tags public.clinical_domain[];
begin
  select r.default_domain_tags into v_default_domain_tags
  from public.resolve_clinical_artefact_type('assessment', new.instrument_id) r;

  select record_type into v_record_type
  from public.assessment_instruments
  where id = new.instrument_id;

  if v_record_type is null then
    raise exception 'Unknown assessment instrument.';
  end if;

  if v_record_type = 'built_in_full' then
    raise exception 'This instrument opens its own existing builder -- it is never recorded as an assessments row.';
  end if;

  new.record_type := v_record_type;

  -- Seed from the instrument's own default only when the client hasn't
  -- already supplied real tags -- a clinician's own explicit choice at
  -- creation time is never overwritten.
  if new.domain_tags is null or new.domain_tags = '{}'::public.clinical_domain[] then
    new.domain_tags := coalesce(v_default_domain_tags, '{}'::public.clinical_domain[]);
  end if;

  return new;
end;
$$;

-- ===========================================================================
-- 5. fba_reports -- domain_tags only (no school_visibility_override
-- column -- confirmed: FBA keeps its existing item_type mechanism
-- unchanged, no default column of its own). Seeded via a plain column
-- DEFAULT, not a trigger -- fba_report's own registry lookup needs no
-- per-row correlation (no instrument choice involved, unlike
-- assessments), so a scalar subquery evaluated fresh at each insert is
-- simpler than a trigger and reads the CURRENT registry value, not one
-- frozen at migration time.
-- ===========================================================================

alter table public.fba_reports
  add column domain_tags public.clinical_domain[] not null default (
    select coalesce(r.default_domain_tags, '{}'::public.clinical_domain[])
    from public.resolve_clinical_artefact_type('fba_report', null) r
  );

-- ===========================================================================
-- 6. clinicians -- the practitioner's own profile-level domain tags.
-- Self-set, no verification, exactly select_clinician_specialty()'s own
-- precedent (0026/0223): nobody needs to check a fact a person is
-- simply stating about themselves. Same client-writable-column-via-
-- scoped-grant shape operating_counties already uses (0057) -- no RPC,
-- a plain client .update() scoped to the caller's own row via the
-- existing "Clinicians can update their own review cadence" policy's
-- row-level predicate (user_id = auth.uid()), which already covers any
-- column carrying a grant, this one included.
-- ===========================================================================

alter table public.clinicians
  add column domain_tags public.clinical_domain[] not null default '{}';

grant update (domain_tags) on public.clinicians to authenticated;

-- ===========================================================================
-- 7. The colleague-read composition. THE THING THAT WOULD HAVE BROKEN
-- ON DAY ONE, FOUND BEFORE SHIPPING: every organisation-verified
-- practitioner has clinicians.domain_tags = '{}' today (their specialty
-- itself is still the 'unspecified' placeholder, per 0222, and nothing
-- has ever prompted a change) -- so artefact.domain_tags && caller.
-- domain_tags is false for literally everyone, and a naive AND-gate
-- would have locked every practitioner out of every colleague's
-- assessment the moment this shipped. The structurally-inert-role shape,
-- a third time.
--
-- THE FIX: the domain clause applies only when BOTH sides carry real
-- tags. If either the artefact or the calling practitioner is
-- untagged, the domain layer falls through to reachability alone --
-- today's behaviour, unchanged, for anyone who hasn't declared yet.
-- This is honest about "not yet declared" rather than treating an
-- empty set as a decision, and it means the feature turns ON as
-- declarations happen rather than breaking BEFORE they do.
--
-- Composed on top of the existing chain, never replacing it -- caller
-- always excludes the artefact's own author (who already reads it,
-- unconditionally, via _assessment_is_readable_by_caller/the existing
-- fba_reports predicate -- if this branch didn't exclude the author, a
-- DISCHARGED author reading their own now-untagged-relative artefact
-- via self-domain-overlap would silently reopen the exact hole 0233
-- closed), requires the caller to be a verified clinician with LIVE
-- clinician_access to the SAME passport (never an alternate route in --
-- a domain tag can only narrow who, among people who can already reach
-- this child, gets to open a teammate's Silo 1/2 artefact; it can never
-- grant reach to a child nobody has any other standing with), and
-- checks the caller's own director is not what's being asked here --
-- the director's own unconditional read is untouched, granted by an
-- entirely separate branch in each policy, unaffected by this function.
--
-- Takes the artefact's own domain_tags as a PARAMETER, read directly
-- from the row already in scope in each policy's USING clause -- never
-- re-queried from assessments/fba_reports by id. This is 0234's own
-- lesson, applied before the mistake, not after it: a SECURITY DEFINER
-- helper called by a table's own RLS policy must never re-query that
-- SAME table, or a chained insert().select() against it can silently
-- fail to see its own just-inserted row.
-- ===========================================================================

create or replace function public._clinical_colleague_domain_match(
  p_author_clinician_id uuid,
  p_passport_id uuid,
  p_artefact_domain_tags public.clinical_domain[]
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    auth.uid() <> p_author_clinician_id
    and public.is_verified_clinician(auth.uid())
    and public._caller_has_live_clinician_access(p_passport_id)
    and (
      p_artefact_domain_tags = '{}'::public.clinical_domain[]
      or coalesce(
           (select c.domain_tags from public.clinicians c where c.user_id = auth.uid()),
           '{}'::public.clinical_domain[]
         ) = '{}'::public.clinical_domain[]
      or p_artefact_domain_tags && coalesce(
           (select c.domain_tags from public.clinicians c where c.user_id = auth.uid()),
           '{}'::public.clinical_domain[]
         )
    );
$$;

grant execute on function public._clinical_colleague_domain_match(uuid, uuid, public.clinical_domain[]) to authenticated;

-- assessments: the existing author-or-director predicate stays exactly
-- as 0234 left it; this ORs in the new colleague branch alongside it.
alter policy "Clinicians read their own assessments"
  on public.assessments
  using (
    public._assessment_is_readable_by_caller(clinician_id, passport_id)
    or public._clinical_colleague_domain_match(clinician_id, passport_id, domain_tags)
  );

-- fba_reports: same shape, added to the one SELECT policy that gates a
-- clinician's own read (the separate "Parents can view completed FBAs"
-- policy is untouched -- parents were never part of this question).
-- fba_reports has NO director branch today (0233 explicitly found it
-- didn't need the live-access fix, since every branch already required
-- it -- it was never extended with a director branch either, and
-- adding one is a real, separate decision this migration does not make
-- by analogy).
alter policy "Clinicians can view their own linked FBAs"
  on public.fba_reports
  using (
    (
      clinician_id = auth.uid()
      and public.is_verified_clinician(auth.uid())
      and exists (
        select 1 from public.clinician_access ca
        where ca.passport_id = fba_reports.passport_id
          and ca.clinician_id = auth.uid()
          and ca.is_active = true
      )
    )
    or public._clinical_colleague_domain_match(clinician_id, passport_id, domain_tags)
  );

-- ===========================================================================
-- 8. attachments -- DELIBERATELY UNTOUCHED. Confirmed rather than
-- assumed: the colleague-domain-match branch above is NOT extended to
-- the attachments bridge (_caller_owns_artefact's 'assessment' arm) in
-- this migration. A domain-matched colleague can now read an
-- assessment's own interpretation/scores/subscale_totals but not any
-- file attached to it -- a real, known asymmetry, flagged rather than
-- silently resolved either way, because extending the bridge to a new
-- class of reader is a genuine additional decision nobody has
-- explicitly asked for yet, the same caution 0233's own header already
-- applied to the write side of this exact bridge.
--
-- Separately, and this is the sharpest point in this whole stage:
-- attachments carries NO school-visibility column of any kind, and
-- none is added here. Daniel's own framing: "uploaded files clinic-only
-- ALWAYS -- a raw report crossing is a deliberate act, never a
-- consequence." A type-level default that could ever cause a FILE to
-- cross the clinic/school boundary as a side effect of its parent
-- artefact being marked shareable is exactly the failure mode this
-- rule exists to prevent -- so this migration adds no column on
-- attachments that default inheritance could ever reach, structurally,
-- not by convention. The shape a real, explicit "share this file with
-- the school" action would eventually need -- a genuine shared_with_
-- school_at/_by pair, set only by a deliberate act, plus its own
-- storage.objects read branch -- is exactly what 0232's own header
-- already sketched, and stays exactly that: a sketch for a future
-- stage, not built here.
-- ===========================================================================
