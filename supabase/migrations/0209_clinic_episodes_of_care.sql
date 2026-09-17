-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 5 Stage 3, Step 1 -- episodes_of_care, and the discharge_reasons
-- vocabulary. Recon's own load-bearing finding, confirmed by Daniel:
-- "reuse the enrolment shape" means the SHAPE, never the `enrolments`
-- table itself. `enrolments_one_active_per_child` (0121) is
-- `unique (passport_id) where ended_at is null` -- GLOBAL across the
-- whole system, not per institution. Episodes living in that table
-- would mean a child could never be an actively-enrolled school pupil
-- AND an active clinic client at the same time -- which is exactly the
-- cross-organisation case PRD 8 is built around. A separate table with
-- its own uniqueness scope is not a stylistic choice; it's the only way
-- both constructs can be correct at once. See CLAUDE.md's own entry on
-- this for the full reasoning -- record it there, not just here.
--
-- SHAPE: byte-identical to enrolments otherwise -- started_at/
-- started_by, ended_at/ended_by/end_reason with the same paired CHECK.
-- The one real divergence: `unique (passport_id, institution_id) where
-- ended_at is null` -- ONE ACTIVE EPISODE PER CLIENT PER ORGANISATION
-- (PRD section 8's own words), not per client globally.
--
-- REOPENING: handled by the SAME mechanism re-enrolment already proves
-- -- the constraint is partial (WHERE ended_at IS NULL), so a new
-- active row inserts cleanly the moment the old one has ended_at set.
-- No special-casing. What reopening DOES need, built in the next
-- migration: a path that opens a new episode for a passport that
-- ALREADY has a passport_institution_links row at this institution --
-- structurally the same shape as the school side's own parked
-- "transfer-in" case (0121's header: "Enrolling an ALREADY-EXISTING
-- passport... is not attempted here, parked"). This migration and the
-- next build that case FOR THE CLINIC ONLY. The school's own
-- transfer-in stays exactly as parked as it always was -- this is not
-- that, and does not touch enrolments or create_school_passport() at
-- all.
--
-- end_reason is plain TEXT, not a CHECK enumeration -- the school's
-- three-value CHECK is the wrong shape here on purpose. Daniel's own
-- framing: "the clinic's to define" means real per-clinic variation is
-- expected, and if every clinic invents its own outcome vocabulary,
-- cross-clinic reporting (Tusla/HSE returns) becomes impossible. A
-- vocabulary TABLE, Behaviour-Hive-controlled (no client write policy,
-- matching cpi_reason_types/cpi_disengagement_types/cpi_result_types/
-- incident_injury_types' own established shape and CLAUDE.md's own
-- closed "CPI VOCABULARY EDITING" decision almost word for word), is
-- the answer -- not a schema migration every time a clinic's real
-- practice needs a value the last migration didn't anticipate.
--
-- SEEDED VALUES ARE NOT FINAL. Six values seeded below as a reasonable
-- starting point -- NOT clinically authored, NOT signed off. Daniel's
-- own instruction: "the values are Catherine's, not ours." Flagged for
-- her review before this is treated as a settled clinical vocabulary.
-- Two of the six exist specifically because Daniel named the gap in the
-- first draft: a client who simply disengages (no formal transfer, no
-- goals met, just stops), and one who moves to adult services.

create table public.episodes_of_care (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  institution_id uuid not null references public.institutions (id) on delete cascade,
  started_at timestamptz not null default now(),
  started_by uuid not null references auth.users (id),
  ended_at timestamptz,
  ended_by uuid references auth.users (id),
  end_reason text,
  constraint episodes_of_care_end_paired check (
    (ended_at is null and ended_by is null and end_reason is null)
    or (ended_at is not null and ended_by is not null and end_reason is not null)
  )
);

create index episodes_of_care_passport_id_idx on public.episodes_of_care (passport_id);
create index episodes_of_care_institution_id_idx on public.episodes_of_care (institution_id);

-- The one real divergence from enrolments_one_active_per_child: scoped
-- to (passport_id, institution_id), not passport_id alone.
create unique index episodes_of_care_one_active_per_institution
  on public.episodes_of_care (passport_id, institution_id)
  where ended_at is null;

alter table public.episodes_of_care enable row level security;

-- Institution-wide, matching enrolments' own "Active institution staff
-- can view enrolments" policy exactly -- any currently active, approved
-- staff member at the institution.
create policy "Active institution staff can view episodes of care"
  on public.episodes_of_care for select to authenticated
  using (
    public.institution_staff_has_current_standing(auth.uid(), episodes_of_care.institution_id)
  );

-- No client-facing write policy -- onboard_clinic_client(),
-- reopen_clinic_episode(), and end_clinic_episode() (next two
-- migrations) are the only write paths, matching enrolments' own
-- established convention exactly.

-- =====================================================================
-- discharge_reasons -- Behaviour-Hive-controlled vocabulary, same shape
-- as cpi_reason_types (0068): institution_id nullable (global default
-- row), value/sort_order/is_active, no client write policy at all --
-- not even an institution-scoped override write, matching CLAUDE.md's
-- own closed decision on cpi_reason_types rather than the narrower
-- incident_locations exception. A clinic's own outcome categories stay
-- centrally defined so cross-clinic reporting is possible; a clinic
-- that genuinely needs a value the seed list doesn't have gets it added
-- by Behaviour Hive, not by an in-app settings screen.
-- =====================================================================

create table public.discharge_reasons (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions (id) on delete cascade,
  value text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index discharge_reasons_institution_id_idx on public.discharge_reasons (institution_id);

insert into public.discharge_reasons (value, sort_order) values
  ('Goals met', 10),
  ('Transferred to another provider', 20),
  ('Client disengaged', 30),
  ('Relocated', 40),
  ('No longer eligible', 50),
  ('Transitioned to adult services', 60);

alter table public.discharge_reasons enable row level security;

create policy "Vocabulary is readable by global default or own institution"
  on public.discharge_reasons for select to authenticated
  using (
    institution_id is null or exists (
      select 1 from public.institution_staff s
      where s.institution_id = discharge_reasons.institution_id and s.user_id = auth.uid()
    )
  );
