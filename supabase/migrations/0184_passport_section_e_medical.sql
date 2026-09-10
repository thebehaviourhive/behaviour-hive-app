-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- MEDICAL AND INTIMATE CARE NEEDS -- new Section E. Neither field has
-- existed anywhere in this schema, under any name (confirmed 7 Sept
-- 2026, re-confirmed before writing this). Decided: a new section, not
-- an addition to B/C/D -- placement is the real risk here, not access
-- (roster tier already reaches B/C/D correctly), and burying medical
-- needs inside a triggers/calming-strategies section is the same
-- "roster tier reaches it but nobody finds it" failure arriving by a
-- different route.
--
-- Five discrete fields, not one textarea, per the brief -- a cover
-- teacher scanning before a lesson needs to find one thing fast.
-- Checked against Section A's own `diagnoses`/`diagnosis_other`
-- (passports table) before adding anything: that field is a fixed
-- neurodevelopmental/diagnosis list (Autism, ADHD, ASD, Dyslexia, ...)
-- -- zero overlap with medical conditions relevant to daily care.
--
-- Table shape, RLS, and trigger are a DELIBERATE, VERBATIM copy of
-- passport_section_b/c/d's own live shape (checked directly, not the
-- original 0003-era version): passport_id-keyed (post-Step-1b, no
-- stale unique(user_id)), owns_passport()-gated parent read/write,
-- has_child_access()-gated roster-tier staff read (reaches a covering
-- supply teacher through has_sna_access()'s own temporary-grant branch,
-- same as B/C/D), is_verified_clinician()-gated clinician read. Copying
-- a proven-correct pattern rather than inventing a new one.

create table public.passport_section_e (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  allergies text,
  medical_conditions text,
  medications text,
  emergency_protocol text,
  intimate_care_needs text,
  section_e_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (passport_id)
);

create index passport_section_e_user_id_idx on public.passport_section_e (user_id);
create index passport_section_e_passport_id_idx on public.passport_section_e (passport_id);

drop trigger if exists set_passport_section_e_updated_at on public.passport_section_e;
create trigger set_passport_section_e_updated_at
  before update on public.passport_section_e
  for each row
  execute function public.set_updated_at();

alter table public.passport_section_e enable row level security;

create policy "Users can view their own section E record"
  on public.passport_section_e
  for select
  to authenticated
  using (public.owns_passport(passport_id));

create policy "Users can insert their own section E record"
  on public.passport_section_e
  for insert
  to authenticated
  with check (public.owns_passport(passport_id) and user_id = auth.uid());

create policy "Users can update their own section E record"
  on public.passport_section_e
  for update
  to authenticated
  using (public.owns_passport(passport_id))
  with check (public.owns_passport(passport_id) and user_id = auth.uid());

create policy "Teachers with granted access can view section E"
  on public.passport_section_e
  for select
  to authenticated
  using (
    public.has_child_access(auth.uid(), passport_section_e.passport_id)
  );

create policy "Clinicians with active access can view section E"
  on public.passport_section_e
  for select
  to authenticated
  using (
    public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = passport_section_e.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );
