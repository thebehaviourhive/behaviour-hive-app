-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 5 Stage 4, Step 1 -- the tag data model. Two tables, deliberately
-- matching clinical_lead_scope's own (dimension, value) shape exactly
-- (0207) so scope-matching becomes a direct set-intersection between
-- two same-shaped tables later in this stage, not a translation between
-- different representations.
--
-- institution_tags -- the CATALOG: which (dimension, value) pairs a
-- clinic has configured as valid. institution_id is NOT nullable --
-- unlike discharge_reasons (0209, Behaviour-Hive-controlled, no client
-- write path at all), tags are explicitly clinic-configured, PRD
-- section 6's own words: "Clinics configure their own -- dimensions and
-- values both. A clinic adding 'Programme' or renaming 'Location' to
-- 'Region' should not need us." Write policy matches institution_
-- vocabulary_overrides (0200) and clinical_lead_scope (0207) exactly:
-- director-only, direct action.
--
-- Deliberately NOT built here: any "is this dimension scoping-eligible"
-- flag. PRD section 7's director-only-for-scoping-dimensions approval
-- rule is change-request machinery (Stage 5, out of this stage's scope
-- per Daniel's own instruction) -- nothing in Stage 4 needs to know
-- whether a dimension is "scoping" as a stored property, only whether
-- clinical_lead_scope rows happen to reference it, which is a fact
-- already derivable from clinical_lead_scope itself. Adding the flag
-- now would be building for a stage that hasn't decided it needs one.
--
-- episode_tags -- the ATTACHMENT: which (dimension, value) pairs are
-- actually on a given episode. Multi-value by construction (no unique
-- constraint on (episode_id, dimension) -- PRD section 6: "a client can
-- receive two services at once", stated as a general property of tags,
-- not scoped to one dimension). Each value is still checked against the
-- clinic's own institution_tags catalog at write time (next migration's
-- RPC), not by a table-level FK -- matching clinical_lead_scope's own
-- deliberate text-not-FK shape from 0207, kept consistent rather than
-- switching representations between the two tables that need to
-- intersect directly.

create table public.institution_tags (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  dimension text not null,
  value text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (institution_id, dimension, value)
);

create index institution_tags_institution_id_idx on public.institution_tags (institution_id);

alter table public.institution_tags enable row level security;

-- Read: broad, matching institution_vocabulary_overrides' own posture --
-- any active staff member at the institution needs to see the catalog
-- to tag or filter by it; matches clinical_lead_scope's own "operational
-- information, not private data" read policy exactly.
create policy "Institution staff can view their own institution's tag catalog"
  on public.institution_tags for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = institution_tags.institution_id
        and s.user_id = auth.uid()
    )
  );

-- Write: director-only, matching institution_vocabulary_overrides (0200)
-- and clinical_lead_scope (0207) exactly -- direct action, no request
-- queue (that's Stage 5's own territory, for CHANGES to an episode's
-- tags, not for defining the catalog itself).
create policy "Directors can manage their own institution's tag catalog"
  on public.institution_tags for all to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = institution_tags.institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  )
  with check (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = institution_tags.institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  );

create table public.episode_tags (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes_of_care (id) on delete cascade,
  dimension text not null,
  value text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (episode_id, dimension, value)
);

create index episode_tags_episode_id_idx on public.episode_tags (episode_id);
-- Read via this index is what a scope-match query does -- (dimension,
-- value) lookups against a specific episode's own rows, not a scan.
create index episode_tags_dimension_value_idx on public.episode_tags (dimension, value);

alter table public.episode_tags enable row level security;

-- Read: same institution-wide standing set_episode_of_care's own SELECT
-- policy already uses (0209) -- an episode's tags are as visible as the
-- episode itself.
create policy "Active institution staff can view episode tags"
  on public.episode_tags for select to authenticated
  using (
    exists (
      select 1 from public.episodes_of_care e
      where e.id = episode_tags.episode_id
        and public.institution_staff_has_current_standing(auth.uid(), e.institution_id)
    )
  );

-- No client-facing write policy -- set_episode_tags() (next migration)
-- is the only write path, matching episodes_of_care's own established
-- convention (0209) exactly.
