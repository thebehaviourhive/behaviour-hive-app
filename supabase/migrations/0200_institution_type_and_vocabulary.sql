-- PRD 5 Stage 1: institution type, and the per-institution vocabulary
-- override table. Foundation only -- no new institution_staff role
-- values, no clinic-specific access rules. See PRD 5 section 2 ("what
-- is decided") and CLAUDE.md's own account of this stage's recon and
-- the eight build decisions.

-- Every real institution today is implicitly a school (PRD 5's own
-- framing) -- default 'school' means every existing row is correctly
-- typed with zero backfill.
alter table public.institutions
  add column if not exists type text not null default 'school'
  check (type in ('school', 'clinic'));

-- Confirmed in recon: institutions' own SELECT policy is `using (true)`
-- -- every authenticated user can already read every column of every
-- institution row. type is exposed automatically the same way; no
-- policy change needed for reads.

-- The vocabulary-override table. Follows 0068's own proven pattern
-- (incident_locations and its six siblings) closely, with one
-- deliberate difference: institution_id here is NOT nullable. 0068's
-- pattern uses a null institution_id row to mean "the global default";
-- there is no equivalent here, because the global default for role/
-- noun vocabulary is small, fixed, and owned by code (src/lib/
-- vocabulary.ts's own type->label map), not a data-driven list an
-- institution needs to see and extend. Every row in this table is one
-- specific institution's own override of one specific vocabulary key.
create table public.institution_vocabulary_overrides (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  key text not null,
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, key)
);

alter table public.institution_vocabulary_overrides enable row level security;

-- Read: broad, matching institutions' own `using (true)` SELECT policy
-- -- a vocabulary label is not private data, and every surface that
-- renders a role label needs to be able to read the override for
-- whichever institution it's rendering, regardless of the viewer's own
-- relationship to that institution (a parent reading their child's
-- incident from a clinic needs the clinic's own override, and a parent
-- has no institution_staff row there at all).
create policy "Authenticated users can read vocabulary overrides"
  on public.institution_vocabulary_overrides for select to authenticated
  using (true);

-- Write: director/principal-only, matching institutions' own "Institution
-- admins can update their own institution" policy shape exactly.
-- Stage 1 deliberately ships no UI for this -- writes are raw SQL only,
-- run by hand, so the read path can be proven end-to-end before any
-- settings screen exists (PRD 5 section 10: real settings UI is a
-- later stage). The policy is still real and correct now, not a
-- placeholder, since the write path itself must be proven too.
create policy "Institution admins can manage their own vocabulary overrides"
  on public.institution_vocabulary_overrides for all to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = institution_vocabulary_overrides.institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  )
  with check (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = institution_vocabulary_overrides.institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  );

create trigger institution_vocabulary_overrides_set_updated_at
  before update on public.institution_vocabulary_overrides
  for each row execute function public.set_updated_at();
