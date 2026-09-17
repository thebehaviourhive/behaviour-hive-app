-- PRD 5 Stage 2: a clinical lead's scope, and the five named toggles.

-- SCOPE, stored now rather than waiting for tags (Stage 4). All three
-- of a lead's own described capabilities (PRD section 5) are
-- explicitly scope-gated -- "reassign WITHIN SCOPE", "discharge WITHIN
-- SCOPE", "approve non-scoping tag changes WITHIN SCOPE" -- so without
-- somewhere to store scope, Stage 2 could not build the code paths for
-- any of them at all. dimension/value are plain text, deliberately NOT
-- foreign keys into a tag_dimensions/tag_values table, because that
-- table doesn't exist yet -- this is the honest shape of what's
-- actually known today, the same hook-point pattern institutionType.ts
-- already used successfully in Stage 1 (a plain, commented placeholder
-- a later stage reads or migrates, not a fabricated reference to
-- something not yet real). Stage 4 either starts validating these
-- values against real configured dimensions, or migrates the column
-- into a proper FK -- no reshaping of what this stage built either way.
--
-- Zero scope rows = empty effective scope, matching this schema's own
-- default-deny posture (a new access source defaults to nothing, never
-- everything). A clinical_lead with no scope configured can do nothing
-- beyond a practitioner -- the honest, correct state until a director
-- (or Stage 4) populates it, not a gap.
--
-- Assignment is director-only, direct action, not the change-request
-- queue (PRD section 7's queue governs an EPISODE's own tags; a lead's
-- scope is an authority grant, and authority grants in this product
-- are direct and audited, never requested -- matching how a principal
-- assigns a school's own staff roles today).
create table public.clinical_lead_scope (
  id uuid primary key default gen_random_uuid(),
  institution_staff_id uuid not null references public.institution_staff (id) on delete cascade,
  dimension text not null,
  value text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (institution_staff_id, dimension, value)
);

create index clinical_lead_scope_institution_staff_id_idx on public.clinical_lead_scope (institution_staff_id);

alter table public.clinical_lead_scope enable row level security;

-- Read: any active staff member at the same institution can see a
-- lead's own scope (it's operational information about who covers
-- what, not private data) -- matching institution_staff's own general
-- visibility posture, not locked to the lead or the director alone.
create policy "Institution staff can view clinical lead scope at their own institution"
  on public.clinical_lead_scope for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff target
      join public.institution_staff caller
        on caller.institution_id = target.institution_id
      where target.id = clinical_lead_scope.institution_staff_id
        and caller.user_id = auth.uid()
        and public.institution_staff_has_current_standing(caller.user_id, caller.institution_id)
    )
  );

-- Write: director-only, matching the institution_vocabulary_overrides
-- write policy shape exactly (0200) -- direct action, no request queue.
create policy "Institution admins can manage clinical lead scope at their own institution"
  on public.clinical_lead_scope for all to authenticated
  using (
    exists (
      select 1 from public.institution_staff target
      join public.institution_staff director
        on director.institution_id = target.institution_id
      where target.id = clinical_lead_scope.institution_staff_id
        and director.user_id = auth.uid()
        and director.role = 'principal'
        and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
    )
  )
  with check (
    exists (
      select 1 from public.institution_staff target
      join public.institution_staff director
        on director.institution_id = target.institution_id
      where target.id = clinical_lead_scope.institution_staff_id
        and director.user_id = auth.uid()
        and director.role = 'principal'
        and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
    )
  );

-- TOGGLES. Five, named, boolean, director-only to set (PRD section 2:
-- "named toggles, director-only... not a permission matrix"). Plain
-- columns on institutions, not a generic key-value toggle table --
-- deliberately different from tags, which are clinic-DEFINED and
-- open-ended (needing a flexible table). Toggles are a fixed, small
-- set BEHAVIOUR HIVE defines; a clinic only ever sets them. Matches
-- the precedent already live on this table (temporary_access_cutoff_
-- time/start_time, Stage 1's own recon finding) rather than inventing
-- a second pattern for the same kind of thing.
alter table public.institutions
  add column if not exists lead_can_reassign_within_scope boolean not null default true,
  add column if not exists lead_can_discharge_within_scope boolean not null default true,
  add column if not exists lead_can_approve_non_scoping_tag_changes boolean not null default true,
  add column if not exists practitioner_can_onboard boolean not null default false,
  add column if not exists practitioner_can_discharge_own_clients boolean not null default false;
