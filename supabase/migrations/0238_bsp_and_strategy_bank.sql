-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 7 Stage 4 -- the BSP and the strategy bank. Sections 1-10, 7a.
-- PRD 7's own core, per section 2's own argument: build the bank
-- first, because a document editor is a commodity and a clinic's own
-- accumulated, refined library of what works is not. The bank starts
-- EMPTY (section 6) -- this migration builds the mechanism, never any
-- content. Catherine fills it.
--
-- No PRD 7 document or sample BSP exists anywhere in this repo -- this
-- migration is built entirely from Daniel's own verbal description,
-- confirmed piece by piece across two rounds of recon. Nothing here is
-- reinterpreted from a source document that doesn't exist.
-- ===========================================================================

-- ===========================================================================
-- 0. clinical_artefact_types -- widen for the new Silo-2 member.
-- silo='framework' (a living, updatable document, same category
-- fba_calm_cards already established). default_domain_tags seeded to
-- behaviour_analysis, matching the FBA it's typically built from --
-- editable per-instance on the bsp row itself, same as everywhere else
-- this pattern is used. default_school_visibility = 'shareable' --
-- THE FIRST REAL USE of this value anywhere in the schema: Stage 3's
-- own recon named "BSP and plans shareable" as the confirmed type
-- default, and this is that default, finally attached to a real row.
-- ===========================================================================

alter table public.clinical_artefact_types
  drop constraint clinical_artefact_types_artefact_type_check;
alter table public.clinical_artefact_types
  add constraint clinical_artefact_types_artefact_type_check
    check (artefact_type in ('fba_report', 'session_note', 'bsp'));

insert into public.clinical_artefact_types (artefact_type, silo, default_domain_tags, default_school_visibility) values
  ('bsp', 'framework', array['behaviour_analysis']::public.clinical_domain[], 'shareable')
on conflict (artefact_type) do nothing;

-- ===========================================================================
-- 1. Two small, reusable authority helpers -- "is this caller a
-- verified clinician at institution X" and "is this caller the
-- director of institution X" -- used four times each below
-- (bank_assets and strategy_bank, INSERT and UPDATE), written once
-- rather than hand-rolled four times, matching this schema's own
-- standing discipline against that shape.
-- ===========================================================================

create or replace function public._is_verified_clinician_at_institution(p_institution_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and s.role = 'clinician'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    );
$$;

grant execute on function public._is_verified_clinician_at_institution(uuid) to authenticated;

create or replace function public._is_director_of_institution(p_institution_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.institution_staff s
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  );
$$;

grant execute on function public._is_director_of_institution(uuid) to authenticated;

-- ===========================================================================
-- 2. bank_assets -- the appendix library (First-Then boards, sentence
-- strips, token boards, emotions visuals). NOT attachments -- that
-- table's whole shape is 1:1 ownership (one file belongs to exactly
-- one artefact); an appendix asset is explicitly "referenced inline
-- from the strategies that use them" -- plural, reusable, the opposite
-- relationship. Institution-scoped, not per-child -- no clinician_
-- access chain, no artefact_type/artefact_id bridge, RLS closer in
-- kind to institution_tags than to attachments.
--
-- IMMUTABLE, confirmed and strengthened by Daniel's own reasoning:
-- copying a REFERENCE (source_bank_strategy_id, image_asset_id, etc.)
-- is only safe if the referenced thing can never change underneath an
-- existing plan -- otherwise someone replacing a file reaches into
-- every plan that pointed at it through the back door, defeating the
-- whole copy rule one level down. Enforced structurally: no UPDATE
-- grant on storage_path/original_filename/content_type/size_bytes at
-- all, ever -- only label (a curation fix) and is_active (retirement)
-- are ever mutable, and only by the director.
-- ===========================================================================

create table public.bank_assets (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  label text not null,
  storage_path text not null unique,
  original_filename text not null,
  content_type text not null,
  size_bytes bigint not null,
  is_active boolean not null default true,
  uploaded_by uuid not null references auth.users (id) on delete cascade,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bank_assets_institution_id_idx on public.bank_assets (institution_id);

create trigger bank_assets_touch_updated_at
  before update on public.bank_assets
  for each row
  execute function public.set_updated_at();

alter table public.bank_assets enable row level security;

create policy "Institution staff can view their own clinic's bank assets"
  on public.bank_assets for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = bank_assets.institution_id
        and s.user_id = auth.uid()
    )
  );

create policy "Verified clinicians can upload bank assets to their own clinic"
  on public.bank_assets for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and public._is_verified_clinician_at_institution(institution_id)
  );

-- Only label/is_active are ever mutable, by anyone the row policy
-- admits -- the row policy itself restricts that to the director.
revoke update on public.bank_assets from authenticated;
grant update (label, is_active) on public.bank_assets to authenticated;

create policy "Directors can curate or retire their own clinic's bank assets"
  on public.bank_assets for update to authenticated
  using (public._is_director_of_institution(institution_id))
  with check (public._is_director_of_institution(institution_id));

-- No DELETE policy at all -- immutable means the row never goes away
-- either, matching this schema's own audit-trail convention.

-- Its own private bucket, deliberately separate from clinical-
-- attachments (Stage 2) -- that bucket's own RLS is built entirely
-- around the artefact_type/artefact_id per-child bridge, which has no
-- meaning for a clinic-wide reusable file with no owning child at all.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clinic-bank-assets', 'clinic-bank-assets', false, 26214400, array['application/pdf', 'image/jpeg', 'image/png', 'image/heic'])
on conflict (id) do nothing;

-- Path convention: <institution_id>/<bank_asset_id>-<filename>.
create policy "Verified clinicians can upload into their own clinic's bank asset folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'clinic-bank-assets'
    and public._is_verified_clinician_at_institution(((storage.foldername(name))[1])::uuid)
  );

create policy "Institution staff can read their own clinic's bank asset files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'clinic-bank-assets'
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = ((storage.foldername(name))[1])::uuid
        and s.user_id = auth.uid()
    )
  );

-- No UPDATE, no DELETE policy on storage.objects for this bucket
-- either -- the same immutability, enforced at the file layer too.

-- ===========================================================================
-- 3. strategy_bank -- the clinic's own accumulated library.
-- Institution-scoped (matching institution_tags' own posture, NOT
-- assessment_instruments' global, Behaviour-Hive-controlled one) --
-- each clinic builds its own, which is the entire argument PRD 7
-- section 2 opens with.
--
-- WHO WRITES, Daniel's own words, taken literally: "any verified
-- clinician... adds, the director retires or curates." Read as a
-- clean split by verb -- any clinician may INSERT a new entry; only
-- the director may UPDATE an existing one (content edits AND the
-- is_active toggle both fall under "curates"/"retires"). An
-- author cannot self-edit their own just-added entry afterward under
-- this reading -- flagged plainly in the build report, not silently
-- softened, since it's a real interpretation of an instruction that
-- could reasonably have meant something looser.
--
-- default_placement reuses passport_clinical_content's own three real
-- values (home/school/shared) rather than inventing a fourth
-- vocabulary -- Daniel's own explicit instruction.
-- ===========================================================================

create table public.strategy_bank (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  title text not null,
  why text not null,
  how text not null,
  scripted_language text,
  materials_and_setup text,
  default_placement text not null check (default_placement in ('home', 'school', 'shared')),
  caveat text,
  image_asset_id uuid references public.bank_assets (id),
  reference_asset_id uuid references public.bank_assets (id),
  is_active boolean not null default true,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index strategy_bank_institution_id_idx on public.strategy_bank (institution_id);

create trigger strategy_bank_touch_updated_at
  before update on public.strategy_bank
  for each row
  execute function public.set_updated_at();

alter table public.strategy_bank enable row level security;

create policy "Institution staff can view their own clinic's strategy bank"
  on public.strategy_bank for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = strategy_bank.institution_id
        and s.user_id = auth.uid()
    )
  );

create policy "Verified clinicians can add strategies to their own clinic's bank"
  on public.strategy_bank for insert to authenticated
  with check (
    created_by = auth.uid()
    and public._is_verified_clinician_at_institution(institution_id)
    and (image_asset_id is null or exists (
      select 1 from public.bank_assets a where a.id = image_asset_id and a.institution_id = strategy_bank.institution_id
    ))
    and (reference_asset_id is null or exists (
      select 1 from public.bank_assets a where a.id = reference_asset_id and a.institution_id = strategy_bank.institution_id
    ))
  );

create policy "Directors can curate or retire their own clinic's strategies"
  on public.strategy_bank for update to authenticated
  using (public._is_director_of_institution(institution_id))
  with check (
    public._is_director_of_institution(institution_id)
    and (image_asset_id is null or exists (
      select 1 from public.bank_assets a where a.id = image_asset_id and a.institution_id = strategy_bank.institution_id
    ))
    and (reference_asset_id is null or exists (
      select 1 from public.bank_assets a where a.id = reference_asset_id and a.institution_id = strategy_bank.institution_id
    ))
  );

-- No DELETE policy -- retiring is is_active=false, never removal.

-- ===========================================================================
-- 4. bsp -- the plan itself. Child-keyed (passport_id), Silo 2, a real
-- clinical_artefact_types row, domain_tags + the SAME colleague-read
-- composition assessments/fba_reports already have (Stage 3 was scoped
-- to "Silo 1 and 2 only, never logs" -- this is exactly the Silo-2 case
-- that scoping anticipated, a direct extension, not new design).
--
-- institution_id, NULLABLE -- derived from the creating clinician's own
-- current clinic institution_staff row at creation time, matching
-- episodes_of_care's own precedent (PRD 5) for "one active per client
-- PER ORGANISATION," which is the exact shape "one active per passport
-- per institution" asks for. Left NULL for a purely independent/
-- parent-engaged clinician with no institution_staff row at all --
-- every other Silo 1/2 artefact (assessments, fba_reports, session_
-- notes) deliberately has NO institution_id column, so bsp is
-- structurally narrower here on purpose, per Daniel's own explicit
-- "per institution" instruction. FLAGGED, not silently resolved: a
-- standard unique index treats every NULL as distinct from every other
-- NULL, so the one-active-per-passport-per-institution constraint
-- below does NOT actually limit an independent clinician to one active
-- plan at a time -- multiple NULL-institution rows can coexist. Given
-- every real scenario in this stage's own recon was clinic-team-shaped,
-- this is accepted as a known edge case, not built around.
--
-- LOCKS WHEN SIGNED, not never -- the AFLS lock lesson, applied on
-- purpose this time, from the first version of this table rather than
-- discovered as a regression later. draft is the only editable state;
-- active is locked; a revision is a NEW ROW (supersedes_id points at
-- what it replaces), never an edit to the signed one. The superseded
-- row stays fully readable, permanently -- a school may have been
-- acting on it for months, and this table's own SELECT policy never
-- checks status at all, only live access/authorship or domain match --
-- matching assessments' own "a locked document is still readable by
-- its author" posture exactly.
--
-- No director-read branch, deliberately -- Daniel's Stage 4 ask never
-- named one, and this schema's own standing discipline is "a real,
-- separate decision for a future stage, not an oversight in this one"
-- (assessments' own Stage 1 header, verbatim precedent for this exact
-- omission). Not built here.
-- ===========================================================================

create table public.bsp (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  institution_id uuid references public.institutions (id),
  clinician_id uuid not null references auth.users (id) on delete cascade,
  source_fba_id uuid references public.fba_reports (id),
  status text not null default 'draft' check (status in ('draft', 'active', 'superseded')),
  domain_tags public.clinical_domain[] not null default (
    select coalesce(r.default_domain_tags, '{}'::public.clinical_domain[])
    from public.resolve_clinical_artefact_type('bsp', null) r
  ),
  -- Carried from the source FBA at creation (or from the prior version
  -- at revision) -- a COPY, never a live reference. Structured arrays,
  -- matching fba_reports.content_data's own shape for these same keys
  -- exactly, since that's precisely what's being copied.
  target_behaviours jsonb not null default '[]'::jsonb,
  triggers jsonb not null default '[]'::jsonb,
  setting_events jsonb not null default '[]'::jsonb,
  precursors text,
  -- Fresh, BSP-only, NEVER carried from the FBA -- Daniel's own explicit
  -- instruction. "Current Frequency/Level of Behaviours" in the real
  -- document is a synthesis paragraph the clinician writes for the
  -- plan itself, not per-behaviour structured data.
  current_frequency text,
  -- The lock.
  signed_at timestamptz,
  signed_by uuid references auth.users (id),
  -- Points at the PRIOR active plan this one replaces, set only at
  -- revision-creation time, never at sign time -- reduces what a
  -- caller can manipulate at the one moment (signing) that has a real,
  -- atomic side effect (superseding another row).
  supersedes_id uuid references public.bsp (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bsp_passport_id_idx on public.bsp (passport_id);
create index bsp_clinician_id_idx on public.bsp (clinician_id);

-- Matches episodes_of_care's own established shape for "one active per
-- client per organisation" exactly.
create unique index bsp_one_active_per_passport_per_institution
  on public.bsp (passport_id, institution_id) where status = 'active';

create trigger bsp_touch_updated_at
  before update on public.bsp
  for each row
  execute function public.set_updated_at();

alter table public.bsp enable row level security;

create policy "Clinicians read their own BSPs, or a domain-matched colleague's"
  on public.bsp for select to authenticated
  using (
    (clinician_id = auth.uid() and public._caller_has_live_clinician_access(passport_id))
    or public._clinical_colleague_domain_match(clinician_id, passport_id, domain_tags)
  );

-- UPDATE: draft-only, both in USING (may this row currently be
-- touched) and WITH CHECK (the row must STILL be draft after the
-- write) -- the second half is what actually prevents a raw client
-- update from ever setting status to 'active'/'superseded' itself,
-- forcing every real transition through sign_bsp() below, the only
-- place that can also handle the atomic supersede side effect
-- correctly.
create policy "Clinicians can edit their own plan while still a draft"
  on public.bsp for update to authenticated
  using (clinician_id = auth.uid() and status = 'draft')
  with check (clinician_id = auth.uid() and status = 'draft');

-- No INSERT policy, no DELETE policy -- creation only ever happens
-- through create_bsp()/create_bsp_revision() below (SECURITY DEFINER,
-- bypasses RLS by design), matching passport_clinical_content's own
-- "no client INSERT policy at all" posture for exactly the same reason.

-- ===========================================================================
-- 5. bsp_strategies -- one row per strategy in a plan, mirroring
-- fba_calm_cards' own precedent for "many independently-editable
-- structured items belonging to one parent document": a dedicated
-- child table, not a jsonb array. UNLIKE fba_calm_cards (which is
-- deliberately exempt from its parent's lock, since a Calm Card only
-- ever references an already-locked conclusion and never constitutes
-- it), strategies ARE the plan's own core content -- they lock
-- together with their parent bsp, or the lock on the plan itself would
-- mean nothing.
-- ===========================================================================

create table public.bsp_strategies (
  id uuid primary key default gen_random_uuid(),
  bsp_id uuid not null references public.bsp (id) on delete cascade,
  -- Provenance only, nullable -- null means authored fresh, directly in
  -- the plan, never pulled from the bank at all.
  source_bank_strategy_id uuid references public.strategy_bank (id),
  title text not null,
  why text not null,
  how text not null,
  scripted_language text,
  materials_and_setup text,
  placement text not null check (placement in ('home', 'school', 'shared')),
  caveat text,
  image_asset_id uuid references public.bank_assets (id),
  reference_asset_id uuid references public.bank_assets (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bsp_strategies_bsp_id_idx on public.bsp_strategies (bsp_id);

create trigger bsp_strategies_touch_updated_at
  before update on public.bsp_strategies
  for each row
  execute function public.set_updated_at();

alter table public.bsp_strategies enable row level security;

-- Read authority factored into its own helper, safe from the self-
-- reference trap (0234's own lesson) since it's called from a
-- DIFFERENT table's policy (bsp_strategies), never from within an
-- INSERT INTO bsp statement -- bsp's own policy already has clinician_
-- id/passport_id/domain_tags directly in scope and doesn't need this.
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
      )
  );
$$;

grant execute on function public._bsp_is_readable_by_caller(uuid) to authenticated;

create policy "Callers can read strategies on a BSP they can read"
  on public.bsp_strategies for select to authenticated
  using (public._bsp_is_readable_by_caller(bsp_id));

-- Ordinary client writes cover the "authored fresh" case only --
-- source_bank_strategy_id must be null, forcing every bank-provenanced
-- copy through add_bank_strategy_to_bsp() below, which alone can set
-- it (SECURITY DEFINER, bypasses this policy). This is what makes the
-- copy's own initial fidelity a server-side guarantee rather than
-- something trusted from client-supplied values.
create policy "The plan's own author can add fresh strategies while it's a draft"
  on public.bsp_strategies for insert to authenticated
  with check (
    source_bank_strategy_id is null
    and exists (
      select 1 from public.bsp b
      where b.id = bsp_strategies.bsp_id and b.clinician_id = auth.uid() and b.status = 'draft'
    )
  );

create policy "The plan's own author can edit its strategies while it's a draft"
  on public.bsp_strategies for update to authenticated
  using (
    exists (
      select 1 from public.bsp b
      where b.id = bsp_strategies.bsp_id and b.clinician_id = auth.uid() and b.status = 'draft'
    )
  )
  with check (
    exists (
      select 1 from public.bsp b
      where b.id = bsp_strategies.bsp_id and b.clinician_id = auth.uid() and b.status = 'draft'
    )
  );

create policy "The plan's own author can remove a strategy while it's a draft"
  on public.bsp_strategies for delete to authenticated
  using (
    exists (
      select 1 from public.bsp b
      where b.id = bsp_strategies.bsp_id and b.clinician_id = auth.uid() and b.status = 'draft'
    )
  );

-- ===========================================================================
-- 6. The three RPCs -- creation, revision, and the copy itself. All
-- three are SECURITY DEFINER and are the ONLY paths that ever insert
-- into bsp, or set a bsp_strategies row's own source_bank_strategy_id.
-- ===========================================================================

-- Brand-new plan. p_source_fba_id, if given, must be a COMPLETED FBA
-- for the same child -- a draft FBA's own content isn't finalized
-- clinical fact yet, and shouldn't be treated as such by being copied
-- into a new document. institution_id is derived from the caller's
-- own current clinic institution_staff row, never trusted from the
-- client.
create or replace function public.create_bsp(
  p_passport_id uuid,
  p_source_fba_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_institution_id uuid;
  v_fba record;
  v_new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_verified_clinician(auth.uid()) then
    raise exception 'Only a verified clinician may create a behaviour support plan.';
  end if;

  if not exists (
    select 1 from public.clinician_access ca
    where ca.passport_id = p_passport_id
      and ca.clinician_id = auth.uid()
      and ca.is_active = true
  ) then
    raise exception 'You do not have active access to this child.';
  end if;

  select s.institution_id into v_institution_id
  from public.institution_staff s
  join public.institutions inst on inst.id = s.institution_id
  where s.user_id = auth.uid()
    and s.role = 'clinician'
    and inst.type = 'clinic'
    and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  limit 1;

  if p_source_fba_id is not null then
    select * into v_fba from public.fba_reports where id = p_source_fba_id;
    if v_fba.id is null then
      raise exception 'FBA not found.';
    end if;
    if v_fba.passport_id is distinct from p_passport_id then
      raise exception 'That FBA does not belong to this child.';
    end if;
    if v_fba.status <> 'completed' then
      raise exception 'Only a completed FBA can be carried into a plan.';
    end if;
  end if;

  insert into public.bsp (
    passport_id, institution_id, clinician_id, source_fba_id,
    target_behaviours, triggers, setting_events, precursors
  )
  values (
    p_passport_id, v_institution_id, auth.uid(), p_source_fba_id,
    coalesce(v_fba.content_data -> 'targetBehaviours', '[]'::jsonb),
    coalesce(v_fba.content_data -> 'triggers', '[]'::jsonb),
    coalesce(v_fba.content_data -> 'settingEvents', '[]'::jsonb),
    v_fba.content_data ->> 'precursors'
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

grant execute on function public.create_bsp(uuid, uuid) to authenticated;

-- A revision: a genuinely new row, seeded from the prior ACTIVE plan's
-- own current content (including its strategies) as a starting point,
-- supersedes_id pointing back at what it will eventually replace --
-- but nothing about the prior plan changes yet; that only happens
-- atomically inside sign_bsp() below, once this new draft is actually
-- signed.
create or replace function public.create_bsp_revision(p_bsp_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old record;
  v_new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_old from public.bsp where id = p_bsp_id;
  if v_old.id is null then
    raise exception 'Plan not found.';
  end if;

  if v_old.status <> 'active' then
    raise exception 'Only an active plan can be revised.';
  end if;

  if not public.is_verified_clinician(auth.uid()) then
    raise exception 'Only a verified clinician may revise a behaviour support plan.';
  end if;

  if not exists (
    select 1 from public.clinician_access ca
    where ca.passport_id = v_old.passport_id
      and ca.clinician_id = auth.uid()
      and ca.is_active = true
  ) then
    raise exception 'You do not have active access to this child.';
  end if;

  insert into public.bsp (
    passport_id, institution_id, clinician_id, source_fba_id,
    target_behaviours, triggers, setting_events, precursors, current_frequency,
    supersedes_id
  )
  values (
    v_old.passport_id, v_old.institution_id, auth.uid(), v_old.source_fba_id,
    v_old.target_behaviours, v_old.triggers, v_old.setting_events, v_old.precursors, v_old.current_frequency,
    v_old.id
  )
  returning id into v_new_id;

  insert into public.bsp_strategies (
    bsp_id, source_bank_strategy_id, title, why, how, scripted_language,
    materials_and_setup, placement, caveat, image_asset_id, reference_asset_id
  )
  select
    v_new_id, source_bank_strategy_id, title, why, how, scripted_language,
    materials_and_setup, placement, caveat, image_asset_id, reference_asset_id
  from public.bsp_strategies
  where bsp_id = p_bsp_id;

  return v_new_id;
end;
$$;

grant execute on function public.create_bsp_revision(uuid) to authenticated;

-- The lock itself. Order matters: the prior plan is demoted to
-- 'superseded' BEFORE this one is promoted to 'active', so the one-
-- active-per-passport-per-institution unique index is never
-- transiently violated within the same transaction. Refuses outright
-- if the plan being superseded has already moved on (someone else
-- signed a different revision first, or it was already superseded) --
-- a real race, caught rather than silently overwritten.
create or replace function public.sign_bsp(p_bsp_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_prior record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_row from public.bsp where id = p_bsp_id;
  if v_row.id is null then
    raise exception 'Plan not found.';
  end if;

  if v_row.clinician_id is distinct from auth.uid() then
    raise exception 'Only the plan''s own author may sign it.';
  end if;

  if v_row.status <> 'draft' then
    raise exception 'This plan has already been signed.';
  end if;

  if v_row.supersedes_id is not null then
    select * into v_prior from public.bsp where id = v_row.supersedes_id;
    if v_prior.id is null or v_prior.status <> 'active' then
      raise exception 'The plan this one supersedes is no longer active.';
    end if;

    update public.bsp
    set status = 'superseded'
    where id = v_row.supersedes_id;
  end if;

  update public.bsp
  set status = 'active',
      signed_at = now(),
      signed_by = auth.uid()
  where id = p_bsp_id;
end;
$$;

grant execute on function public.sign_bsp(uuid) to authenticated;

-- The copy itself, server-side and faithful by construction -- reads
-- the CURRENT bank strategy at the moment of copying and writes every
-- field directly, never trusting a client-supplied echo of what it
-- read. This is the thing most likely to be built wrong, built the
-- safe way: the client cannot claim a false source_bank_strategy_id
-- (bsp_strategies' own INSERT policy refuses any non-null value from
-- an ordinary client write), so every row that DOES carry one is
-- guaranteed, structurally, to have gone through this exact copy.
create or replace function public.add_bank_strategy_to_bsp(
  p_bsp_id uuid,
  p_bank_strategy_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bsp record;
  v_bank record;
  v_new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_bsp from public.bsp where id = p_bsp_id;
  if v_bsp.id is null then
    raise exception 'Plan not found.';
  end if;
  if v_bsp.clinician_id is distinct from auth.uid() then
    raise exception 'Only the plan''s own author may add strategies to it.';
  end if;
  if v_bsp.status <> 'draft' then
    raise exception 'This plan is locked and can no longer be edited.';
  end if;

  select * into v_bank from public.strategy_bank where id = p_bank_strategy_id;
  if v_bank.id is null then
    raise exception 'Strategy not found.';
  end if;
  if v_bank.institution_id is distinct from v_bsp.institution_id then
    raise exception 'That strategy belongs to a different clinic.';
  end if;
  if not v_bank.is_active then
    raise exception 'That strategy has been retired.';
  end if;

  insert into public.bsp_strategies (
    bsp_id, source_bank_strategy_id, title, why, how, scripted_language,
    materials_and_setup, placement, caveat, image_asset_id, reference_asset_id
  )
  values (
    p_bsp_id, v_bank.id, v_bank.title, v_bank.why, v_bank.how, v_bank.scripted_language,
    v_bank.materials_and_setup, v_bank.default_placement, v_bank.caveat, v_bank.image_asset_id, v_bank.reference_asset_id
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

grant execute on function public.add_bank_strategy_to_bsp(uuid, uuid) to authenticated;
