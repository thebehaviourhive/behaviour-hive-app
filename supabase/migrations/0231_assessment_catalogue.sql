-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 7, Stage 1 -- the instrument catalogue and the assessment record.
-- Built AROUND the three existing instrument implementations (AFLS,
-- MAS, QABF), never on top of them -- see the standing CLAUDE.md entry
-- ("STEP 0 FINDINGS...") for what each of those already stores and why
-- neither is touched here. This migration introduces a wholly separate,
-- NEW mechanism for a clinician creating a standalone assessment from
-- the Clinical File; it does not read from, write to, or reconcile with
-- fba_instruments, fba_instrument_requests, or afls_assessments.
--
-- ***********************************************************************
-- MAS, QABF AND AFLS PREDATE THIS CATALOGUE AND FOLLOW A DIFFERENT,
-- DEFERRED MODEL. THEY ARE NOT THE PATTERN TO COPY. Do not read
-- fba_instruments' full-item-text-plus-automated-scoring shape, or
-- afls_assessments' 225-task item bank, as precedent for how a NEW
-- instrument should be built here. Every instrument added to
-- assessment_instruments from this migration onward follows section
-- 13a/13b of PRD 7 instead: a response sheet holds numbered rows and a
-- response scale, NEVER item text; an external record holds only the
-- outcome (scores, interpretation, administration details), never the
-- instrument itself. Daniel's own instruction, given after Step 0's
-- recon confirmed MAS/QABF are full reproductions (verbatim item text,
-- subscale structure, and automated scoring) and AFLS is a narrower but
-- real one (225 task descriptions, no criteria/examples): leave all
-- three exactly as they are, licensing handled separately, build this
-- new catalogue around them. This is a decision DEFERRED, not made --
-- the two real MAS/QABF entries seeded below use the safe 13a shape
-- deliberately, coexisting with (not replacing) the older, unsafe
-- fba_instruments-based MAS/QABF the FBA's own indirect-assessment flow
-- still uses unchanged.
-- ***********************************************************************

-- ===========================================================================
-- assessment_instruments -- the catalogue. Behaviour-Hive-controlled,
-- same closed-vocabulary posture as cpi_reason_types (0068) and
-- discharge_reasons (0209): no client write policy at all, select-only.
-- Global, not per-institution -- unlike those two, there is no clinic-
-- specific notion of "our own instrument catalogue"; every clinic picks
-- from the same fixed, real list of instruments.
--
-- record_type is the three patterns from PRD 7 section 13b, plus
-- 'built_in_full' for the one artefact that isn't a licensed instrument
-- at all (the FBA) -- selecting it never creates an assessments row
-- below; it opens the existing FBA builder unchanged, exactly as the
-- flow describes.
--
-- item_count/response_scale exist ONLY for response_sheet rows (CHECK
-- below) -- item_count is a bare number of rows to present (1..N,
-- never bound to any stored item text), response_scale is the small set
-- of response options a clinician/respondent taps per row (e.g. MAS's
-- own 7-point word scale, QABF's X/0/1/2/3). Storing the response scale
-- itself is the sanctioned half of the 13a pattern -- "numbered rows
-- AND a response scale, no item text" -- the dividing line is item
-- text, not the scale.
--
-- Deliberately absent: any subscale/category structure. "The clinician
-- enters subscale totals from the paper's own scoring key" (13a, and
-- section 4 of Daniel's own Stage 1 brief) means the app holds neither
-- an item-to-subscale mapping nor even a pre-seeded list of subscale
-- NAMES -- the clinician builds a free-form (label, total) list
-- themselves on the assessment record, see below. This keeps the
-- catalogue clear of the instrument's own scoring structure entirely,
-- not just its item text.
-- ===========================================================================

create table public.assessment_instruments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  record_type text not null check (record_type in ('response_sheet', 'external_record', 'built_in_full')),
  item_count integer,
  response_scale jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint assessment_instruments_response_sheet_fields_check check (
    (record_type = 'response_sheet' and item_count is not null and response_scale is not null)
    or
    (record_type <> 'response_sheet' and item_count is null and response_scale is null)
  )
);

alter table public.assessment_instruments enable row level security;

create policy "Assessment catalogue is readable by every authenticated user"
  on public.assessment_instruments for select to authenticated
  using (true);

-- The instruments THE FLOW section names explicitly, and only those --
-- not a broader sweep of section 12's own "can be implemented" table.
-- FAST is deliberately excluded: PRD 7 section 12 itself flags it as
-- "the one genuine unknown... verify before treating it either way",
-- an unresolved licensing question of its own, not something to seed
-- ahead of that check. IISCA is likewise not seeded here -- it isn't
-- named in Stage 1's own flow section, and adding it is a call for
-- whoever scopes it deliberately, not a default extension of this list.
insert into public.assessment_instruments (name, record_type, item_count, response_scale) values
  ('FBA', 'built_in_full', null, null),
  ('MAS', 'response_sheet', 16, '["Never", "Almost Never", "Seldom", "Half the Time", "Usually", "Almost Always", "Always"]'::jsonb),
  ('QABF', 'response_sheet', 25, '["X", "0", "1", "2", "3"]'::jsonb),
  ('WISC-V', 'external_record', null, null),
  ('ADOS-2', 'external_record', null, null),
  ('Vineland-3', 'external_record', null, null),
  ('BASC-3', 'external_record', null, null),
  ('CARS-2', 'external_record', null, null),
  ('ADI-R', 'external_record', null, null);

-- ===========================================================================
-- assessments -- the record. passport_id, not episode_id -- the exact
-- structural reason session_notes (0228) used passport_id: a school-
-- engaged or parent-engaged clinician never gets an episode row at all,
-- and clinician_access (not episodes_of_care) is the one relationship
-- table identical across all three engagement types.
--
-- Two record shapes in one table, discriminated by record_type (set by
-- trigger below, never client-supplied), matching each other's mutual
-- exclusivity via CHECK -- same shape session_notes' own two-column
-- (clinical_record/parent_note) split established, just with more
-- fields per side because these are two genuinely different forms, not
-- two views of the same content.
--
-- SILO 1 BEHAVIOUR: LOCKED ONCE COMPLETED, enforced in the UPDATE
-- policy's own USING clause from this migration's first version --
-- built in from day one, not added after the fact. This is the AFLS
-- lock regression's own lesson (CLAUDE.md: 0060 dropped fba_afls_data's
-- original completed-lock and it went unnoticed for months): a policy
-- is what actually enforces this, never a UI state, and it has to be
-- right the first time a table like this is created.
-- ===========================================================================

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  clinician_id uuid not null references auth.users (id) on delete cascade,
  instrument_id uuid not null references public.assessment_instruments (id),
  -- Set by the trigger below from instrument_id, never trusted from the
  -- client -- guarantees an assessments row can never disagree with its
  -- own instrument's catalogue type.
  record_type text not null check (record_type in ('response_sheet', 'external_record')),

  assessment_date date not null default current_date,
  completed_at timestamptz,

  -- Response sheet fields -- null for an external_record row (CHECK below).
  respondent_type text check (respondent_type in ('parent', 'school_staff', 'interview')),
  -- Keyed by row NUMBER as a string ("1".."item_count"), never an item
  -- id or item text -- {"1": "Usually", "2": "X", ...}.
  responses jsonb,
  -- Free-form, clinician-entered, never derived: [{"label": "Attention", "total": 7}, ...].
  -- The app never computes this from responses -- per 13a, scoring stays
  -- with the clinician and the paper's own key.
  subscale_totals jsonb,

  -- External record fields -- null for a response_sheet row (CHECK below).
  instrument_version text,
  administrator_name text,
  location text,
  -- Free-form, generic: [{"label": "FSIQ", "value": "87"}, ...]. Per
  -- PRD section 13: start generic, add a per-instrument structured form
  -- only once Catherine supplies real output structures -- nothing here
  -- migrates when that happens, a structured form is simply offered
  -- alongside this same column.
  scores jsonb,
  interpretation text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint assessments_record_type_fields_check check (
    (record_type = 'response_sheet'
      and instrument_version is null and administrator_name is null and location is null
      and scores is null and interpretation is null)
    or
    (record_type = 'external_record'
      and respondent_type is null and responses is null and subscale_totals is null)
  )
);

create index assessments_passport_id_idx on public.assessments (passport_id);
create index assessments_clinician_id_idx on public.assessments (clinician_id);

create trigger assessments_touch_updated_at
  before update on public.assessments
  for each row
  execute function public.set_updated_at();

-- Sets record_type from the instrument and refuses a built_in_full
-- target outright -- FBA (and anything else typed built_in_full later)
-- opens its own existing builder and is never represented as a row in
-- this table at all.
create or replace function public._assessments_set_record_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record_type text;
begin
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
  return new;
end;
$$;

create trigger assessments_set_record_type
  before insert on public.assessments
  for each row
  execute function public._assessments_set_record_type();

alter table public.assessments enable row level security;

-- INSERT: the author, verified, with a real active relationship to this
-- passport at the moment of writing -- identical shape to session_notes'
-- own INSERT policy (0228).
create policy "Clinicians can create assessments for their own caseload"
  on public.assessments for insert to authenticated
  with check (
    clinician_id = auth.uid()
    and public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = assessments.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

-- SELECT: author-only, deliberately, for Stage 1. Daniel's own "NOT IN
-- STAGE 1" list names school visibility explicitly and says nothing
-- about a director's own read -- unlike session_notes, which built the
-- director-read branch as its own later stage (PRD 6 Stage 4) once
-- asked for. Do not add a director/school branch here by analogy to
-- that precedent; it is a real, separate decision for a future stage,
-- not an oversight in this one.
create policy "Clinicians read their own assessments"
  on public.assessments for select to authenticated
  using (clinician_id = auth.uid());

-- UPDATE: author-only, AND NOT COMPLETED. The lock. Built in here, not
-- added after a regression -- see this migration's own header.
create policy "Clinicians can edit their own uncompleted assessments"
  on public.assessments for update to authenticated
  using (clinician_id = auth.uid() and completed_at is null)
  with check (clinician_id = auth.uid());

-- No DELETE policy, matching this schema's own audit-trail convention
-- for clinical records -- once created, an assessment stays.
