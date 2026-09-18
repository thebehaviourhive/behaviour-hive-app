-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- 0235 FAILED PARTWAY THROUGH: "ERROR: 0A000: cannot use subquery in
-- DEFAULT expression" -- a real Postgres restriction on column DEFAULT
-- expressions, not something CREATE OR REPLACE FUNCTION or ALTER POLICY
-- run into. `add column domain_tags ... default (select ... from
-- resolve_clinical_artefact_type(...) r)` on fba_reports is not legal
-- syntax -- a DEFAULT clause may call a scalar FUNCTION, but may never
-- contain a SELECT of its own, even one wrapping a function call.
--
-- The Supabase SQL editor does not wrap a pasted script in one
-- transaction (confirmed by the 0234 dependency-ordering incident
-- earlier this stage) -- everything in 0235 before this statement
-- already committed; nothing from this statement onward ran. Rather
-- than guess exactly how far it got, THIS MIGRATION IS FULLY
-- IDEMPOTENT THROUGHOUT -- every statement guarded to be safe whether
-- 0235 got partway through or (after this fix is merged into the
-- source file) is run again from a clean database. It restates every
-- remaining piece of 0235's own content, not just the broken statement,
-- so this file alone is sufficient to finish the job regardless of
-- where 0235 actually stopped.
--
-- THE FIX for fba_reports specifically: a small scalar-returning helper
-- function wraps the same resolve_clinical_artefact_type() lookup --
-- DEFAULT can call a function freely (even one whose own body contains
-- a subquery; the restriction is on the DEFAULT clause's own syntax,
-- not on what a function it calls is allowed to do internally), it
-- just can't inline a SELECT directly in the clause itself.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. clinical_domain -- guarded, since Postgres has no CREATE TYPE IF
-- NOT EXISTS.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'clinical_domain' and n.nspname = 'public'
  ) then
    create type public.clinical_domain as enum (
      'cognition',
      'behaviour_analysis',
      'communication',
      'sensory_motor',
      'adaptive_living',
      'statutory_education'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. clinical_artefact_types -- guarded table creation, drop+recreate
-- for the policy (create policy has no IF NOT EXISTS), ON CONFLICT DO
-- NOTHING for the seed rows.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_artefact_types (
  artefact_type text primary key check (artefact_type in ('fba_report', 'session_note')),
  silo text not null check (silo in ('assessment', 'framework', 'log')),
  default_domain_tags public.clinical_domain[] not null default '{}',
  default_school_visibility text check (default_school_visibility in ('clinic_only', 'shareable')),
  created_at timestamptz not null default now()
);

alter table public.clinical_artefact_types enable row level security;

drop policy if exists "Clinical artefact type registry is readable by every authenticated user"
  on public.clinical_artefact_types;
create policy "Clinical artefact type registry is readable by every authenticated user"
  on public.clinical_artefact_types for select to authenticated
  using (true);

-- See 0235's own header for why session_note carries no real domain
-- layer despite sitting in this registry -- its own SELECT policy is
-- already stricter than any colleague-read branch would produce, so
-- adding one would OPEN a deliberately closed policy, not restrict an
-- open one.
insert into public.clinical_artefact_types (artefact_type, silo, default_domain_tags, default_school_visibility) values
  ('fba_report', 'assessment', array['behaviour_analysis']::public.clinical_domain[], null),
  ('session_note', 'log', '{}'::public.clinical_domain[], null)
on conflict (artefact_type) do nothing;

-- ---------------------------------------------------------------------------
-- 3. assessment_instruments -- IF NOT EXISTS on every added column;
-- the UPDATEs are plain idempotent re-sets, safe to run unconditionally
-- either way.
-- ---------------------------------------------------------------------------
alter table public.assessment_instruments
  add column if not exists silo text not null default 'assessment' check (silo = 'assessment'),
  add column if not exists default_domain_tags public.clinical_domain[] not null default '{}',
  add column if not exists default_school_visibility text check (default_school_visibility in ('clinic_only', 'shareable'));

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

-- ---------------------------------------------------------------------------
-- 4. The single resolution function -- CREATE OR REPLACE is always
-- idempotent, no guard needed.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 5. assessments -- IF NOT EXISTS on both added columns; trigger is
-- CREATE OR REPLACE, always safe.
-- ---------------------------------------------------------------------------
alter table public.assessments
  add column if not exists domain_tags public.clinical_domain[] not null default '{}',
  add column if not exists school_visibility_override text
    check (school_visibility_override is null or school_visibility_override in ('clinic_only', 'shareable'));

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

  if new.domain_tags is null or new.domain_tags = '{}'::public.clinical_domain[] then
    new.domain_tags := coalesce(v_default_domain_tags, '{}'::public.clinical_domain[]);
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. fba_reports -- THE ACTUAL FIX. A scalar helper function wraps the
-- resolve() lookup so DEFAULT can call it directly (a plain function
-- call, no inline SELECT) -- evaluated fresh at every future insert,
-- same "reads the live registry, never frozen" property the original,
-- illegal subquery-default was trying to have.
-- ---------------------------------------------------------------------------
create or replace function public._fba_reports_default_domain_tags()
returns public.clinical_domain[]
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(r.default_domain_tags, '{}'::public.clinical_domain[])
  from public.resolve_clinical_artefact_type('fba_report', null) r;
$$;

grant execute on function public._fba_reports_default_domain_tags() to authenticated;

alter table public.fba_reports
  add column if not exists domain_tags public.clinical_domain[] not null default '{}';

-- Backfill any row that landed with the plain '{}' default above
-- (there is, at most, one real FBA in production at the time of this
-- migration -- this is a genuine backfill, not a no-op, for that row).
update public.fba_reports
  set domain_tags = public._fba_reports_default_domain_tags()
  where domain_tags = '{}'::public.clinical_domain[];

-- The column's own DEFAULT going forward, for every future insert.
alter table public.fba_reports
  alter column domain_tags set default public._fba_reports_default_domain_tags();

-- ---------------------------------------------------------------------------
-- 7. clinicians -- IF NOT EXISTS; grant is idempotent.
-- ---------------------------------------------------------------------------
alter table public.clinicians
  add column if not exists domain_tags public.clinical_domain[] not null default '{}';

grant update (domain_tags) on public.clinicians to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The colleague-read composition -- CREATE OR REPLACE and ALTER
-- POLICY are both always idempotent, no guard needed. See 0235's own
-- header for the full reasoning (the empty-either-side fallback, the
-- author exclusion, why this is never an alternate route to reach a
-- child).
-- ---------------------------------------------------------------------------
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

alter policy "Clinicians read their own assessments"
  on public.assessments
  using (
    public._assessment_is_readable_by_caller(clinician_id, passport_id)
    or public._clinical_colleague_domain_match(clinician_id, passport_id, domain_tags)
  );

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

-- attachments -- deliberately untouched, exactly as 0235's own header
-- explains. Nothing to do here in this fix either.
