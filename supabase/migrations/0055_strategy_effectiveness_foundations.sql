/* ============================================================
   CLOSING THE LOOP -- STAGE 1: DATA FOUNDATIONS

   Strategy effectiveness tracking + regional data collection. This
   migration lays the schema/RPC groundwork for Stages 2-4 (capture UI,
   per-child effectiveness, caseload insights) -- no aggregate UI ships
   from this migration alone.

   FIVE JUDGMENT CALLS, confirmed with the product owner before writing
   this (flagged here rather than silently decided):

   1. passport_clinical_content.content previously dropped the FBA
      StrategyEntry's own id on extraction -- approve_fba_strategies()
      only ever wrote {title, description}. Without that id, a Calm
      Card's ratings (keyed by calm_card_id) can never be matched back
      to the "home" side of the same strategy's passport-facing ratings
      (keyed by strategy_content_id) for the Stage 3 home/school split.
      Fixed below: extraction now also stamps content.source_entry_id
      (the original StrategyEntry.id) and content.strategy_type_id.
      Existing extracted rows predate this and are backfilled by title
      match (see the DO block below) rather than requiring a
      re-approval, which has its own side effects (a duplicate
      activity_log row every call, and loss of the original extraction
      timestamp strategyMarkerDates() reads for the chart marker) --
      not touched here, out of scope for this migration.

   2. Regional data as a real reference table (regions), not a wider
      check-constrained enum -- every existing categorical field in
      this schema (diagnoses, communication_methods, specialty,
      door_type...) is free text[] or an inline check(in (...)) enum;
      there is no lookup-table precedent anywhere before this. The
      brief's own "structured as reference data... additions, not
      rework" phrasing reads as asking for a genuine table extensible
      by row insertion, not DDL.

   3. Calm Card tagging is its own nullable column (fba_calm_cards.
      strategy_type_id), pre-filled client-side from the linked
      strategy's tag when strategy_ref resolves, but stored and
      editable independently -- the brief asks for a real select
      control on that editor, not a read-only derived value.

   4. Post-hoc tagging on a LOCKED FBA needs a narrow companion-layer
      RPC (update_locked_strategy_tag below) rather than loosening
      fba_reports' own RLS UPDATE policy -- editing content_data stays
      blocked once completed for everything except this one JSON key,
      exactly the same "companion layer, not the FBA itself" posture
      Calm Cards already established in migration 0053.

   5. Home vs school split resolves from `context`, not a stored
      column: every calm_card_id-keyed row is parent-written
      (context='calm_episode', enforced by its own INSERT policy) and
      every strategy_content_id-keyed row is teacher-written
      (context='eod', item_type restricted to strategy_school/
      strategy_shared by its own INSERT policy) -- the split falls out
      of those two mutually-exclusive policies for free. The table-
      level CHECK constraint (exactly one of strategy_content_id /
      calm_card_id set) is a second, independent belt on top of the
      two INSERT policies -- policies decide who may write; the
      constraint decides the row shape can never be violated by any
      future policy or a service-role write that bypasses RLS.
   ============================================================ */


-- ============================================================
-- 1. strategy_types -- the controlled vocabulary
-- ============================================================

create table public.strategy_types (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.strategy_types enable row level security;

create policy "Any authenticated user can read active strategy types"
  on public.strategy_types
  for select
  to authenticated
  using (is_active);

-- Provisional canonical set (~20 patterns), per the clinical lead's own
-- brief. Refining labels/descriptions/adding new ones from here on is a
-- DATA EDIT to this table's rows -- never a code change.
insert into public.strategy_types (label, description, sort_order) values
  ('Visual schedule', 'A visual sequence of upcoming activities or steps.', 0),
  ('First-Then language', '"First X, then Y" framing to make expectations concrete.', 1),
  ('Choice-making', 'Offering a bounded choice to restore a sense of control.', 2),
  ('Sensory/movement break', 'A scheduled or on-demand break for sensory/movement regulation.', 3),
  ('Transition warning', 'Advance notice before ending an activity or changing setting.', 4),
  ('Available/Not-available system', 'A visual signal for whether a person/item is currently accessible.', 5),
  ('Token/reward system', 'A structured token economy or reward schedule.', 6),
  ('Calm adult response', 'A scripted low-arousal adult response during distress.', 7),
  ('Reduced language', 'Deliberately minimal spoken language during high arousal.', 8),
  ('Co-regulation', 'An adult actively regulating alongside the child.', 9),
  ('Task breakdown', 'Splitting a demand into smaller, sequenced steps.', 10),
  ('Preferred-item access plan', 'A plan for accessing a preferred item or activity.', 11),
  ('Social story/preparation', 'A prepared narrative or rehearsal ahead of a known trigger.', 12),
  ('Environmental adjustment', 'A change to the physical environment (noise, lighting, layout).', 13),
  ('Communication modelling', 'Modelling functional communication in the moment.', 14),
  ('Demand adjustment', 'Reducing or restructuring a demand in the moment.', 15),
  ('Waiting support', 'A tool or strategy that supports waiting.', 16),
  ('Routine consistency', 'Keeping a routine predictable and consistent.', 17),
  ('Emotional labelling', 'Naming the emotion observed, out loud.', 18),
  ('Escape/break card', 'A card or signal the child uses to request a break.', 19);


-- ============================================================
-- 2. regions -- reference data (Judgment call 2)
-- ============================================================

create table public.regions (
  id uuid primary key default gen_random_uuid(),
  country_code text not null default 'IE',
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  unique (country_code, name)
);

alter table public.regions enable row level security;

create policy "Any authenticated user can read active regions"
  on public.regions
  for select
  to authenticated
  using (is_active);

-- The 26 counties of the Republic of Ireland. Northern Irish counties /
-- future UK regions are additions to this table (a new country_code),
-- never a rework of this column or of anything that reads it.
insert into public.regions (country_code, name, sort_order) values
  ('IE', 'Carlow', 0), ('IE', 'Cavan', 1), ('IE', 'Clare', 2), ('IE', 'Cork', 3),
  ('IE', 'Donegal', 4), ('IE', 'Dublin', 5), ('IE', 'Galway', 6), ('IE', 'Kerry', 7),
  ('IE', 'Kildare', 8), ('IE', 'Kilkenny', 9), ('IE', 'Laois', 10), ('IE', 'Leitrim', 11),
  ('IE', 'Limerick', 12), ('IE', 'Longford', 13), ('IE', 'Louth', 14), ('IE', 'Mayo', 15),
  ('IE', 'Meath', 16), ('IE', 'Monaghan', 17), ('IE', 'Offaly', 18), ('IE', 'Roscommon', 19),
  ('IE', 'Sligo', 20), ('IE', 'Tipperary', 21), ('IE', 'Waterford', 22), ('IE', 'Westmeath', 23),
  ('IE', 'Wexford', 24), ('IE', 'Wicklow', 25);


-- ============================================================
-- 3. Column additions
-- ============================================================

alter table public.passports
  add column if not exists county_id uuid references public.regions (id);

alter table public.clinicians
  add column if not exists operating_counties uuid[] not null default '{}';
-- No per-element FK enforcement (Postgres has no native FK-on-array-
-- element) -- same non-enforced-reference precedent this schema
-- already accepts for e.g. passports.diagnoses text[]. Validated at
-- the RPC/application layer that writes it (Stage 2), not the DB.

alter table public.fba_calm_cards
  add column if not exists strategy_type_id uuid references public.strategy_types (id);


-- ============================================================
-- 4. strategy_feedback
-- ============================================================

create table public.strategy_feedback (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  strategy_content_id uuid references public.passport_clinical_content (id) on delete cascade,
  calm_card_id uuid references public.fba_calm_cards (id) on delete cascade,
  context text not null check (context in ('calm_episode', 'eod')),
  rating text not null check (rating in ('helped', 'partly', 'not')),
  rater_role text not null check (rater_role in ('parent', 'teacher')),
  rater_id uuid not null references auth.users (id) on delete cascade,
  calm_episode_id uuid references public.calm_episodes (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Judgment call 5, belt #2: exactly one of the two targets is ever
  -- set, enforced at the table level regardless of which policy (or
  -- future policy, or a service-role write bypassing RLS) wrote the row.
  check ((strategy_content_id is not null)::int + (calm_card_id is not null)::int = 1)
);

create index strategy_feedback_passport_id_idx on public.strategy_feedback (passport_id);
create index strategy_feedback_strategy_content_id_idx on public.strategy_feedback (strategy_content_id);
create index strategy_feedback_calm_card_id_idx on public.strategy_feedback (calm_card_id);

alter table public.strategy_feedback enable row level security;

-- Parent: rates their own child's Calm Cards only (context is always
-- 'calm_episode' for this path -- Stage 2's rating prompt on Calm
-- flow exit). The calm_card_id must genuinely belong to this
-- passport_id (via its fba_reports.passport_id), not just any card.
create policy "Parents can rate their own child's calm cards"
  on public.strategy_feedback
  for insert
  to authenticated
  with check (
    rater_id = auth.uid()
    and rater_role = 'parent'
    and context = 'calm_episode'
    and calm_card_id is not null
    and strategy_content_id is null
    and public.owns_passport(passport_id)
    and exists (
      select 1
      from public.fba_calm_cards fc
      join public.fba_reports fr on fr.id = fc.fba_id
      where fc.id = strategy_feedback.calm_card_id
        and fr.passport_id = strategy_feedback.passport_id
    )
  );

-- Teacher: rates school/shared strategies only, on an actively-linked
-- passport, via the EOD step (context is always 'eod'). The item_type
-- scope is enforced HERE, in the policy body -- a teacher inserting a
-- strategy_content_id that resolves to a strategy_home row simply fails
-- this check, satisfying "teacher can't rate a home strategy" as a
-- database-level guarantee, not a UI-only one.
create policy "Teachers can rate school/shared strategies on linked passports"
  on public.strategy_feedback
  for insert
  to authenticated
  with check (
    rater_id = auth.uid()
    and rater_role = 'teacher'
    and context = 'eod'
    and strategy_content_id is not null
    and calm_card_id is null
    and exists (
      select 1 from public.passport_access pa
      where pa.passport_id = strategy_feedback.passport_id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
    )
    and exists (
      select 1 from public.passport_clinical_content pcc
      where pcc.id = strategy_feedback.strategy_content_id
        and pcc.passport_id = strategy_feedback.passport_id
        and pcc.item_type in ('strategy_school', 'strategy_shared')
    )
  );

create policy "Parents can view their own child's strategy feedback"
  on public.strategy_feedback
  for select
  to authenticated
  using (public.owns_passport(passport_id));

create policy "Verified linked clinicians can view strategy feedback"
  on public.strategy_feedback
  for select
  to authenticated
  using (
    public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = strategy_feedback.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

-- Deliberately NO teacher SELECT policy (constraint: "teachers no
-- SELECT" -- a teacher who just submitted a rating cannot read it back,
-- by design) and NO UPDATE/DELETE policy for ANY role. Ratings are
-- immutable signal: a rater who changes their mind logs a new one next
-- time; this table never edits or erases history.


-- ============================================================
-- 5. approve_fba_strategies() -- carry the tag + source id through
--    extraction (Judgment call 1)
-- ============================================================

create or replace function public.approve_fba_strategies(p_fba_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_passport_id uuid;
  v_clinician_id uuid;
  v_status text;
  v_content jsonb;
  v_child_name text;
  v_item jsonb;
  v_inserted integer := 0;
begin
  select fr.passport_id, fr.clinician_id, fr.status, fr.content_data, p.child_name
  into v_passport_id, v_clinician_id, v_status, v_content, v_child_name
  from public.fba_reports fr
  join public.passports p on p.id = fr.passport_id
  where fr.id = p_fba_id;

  if v_passport_id is null then
    raise exception 'FBA not found';
  end if;

  if not public.owns_passport(v_passport_id) then
    raise exception 'Not authorized to approve this FBA';
  end if;

  if v_status <> 'completed' then
    raise exception 'FBA is not completed';
  end if;

  -- Idempotent: clear this FBA's previous extraction (if any) before
  -- writing fresh rows, so re-running never duplicates.
  delete from public.passport_clinical_content
  where source_document_type = 'fba_report'
    and source_document_id = p_fba_id;

  for v_item in select * from jsonb_array_elements(coalesce(v_content -> 'triggers', '[]'::jsonb))
  loop
    insert into public.passport_clinical_content
      (passport_id, author_id, author_role, source_document_type, source_document_id, item_type, content)
    values (
      v_passport_id, v_clinician_id, 'clinician', 'fba_report', p_fba_id, 'trigger',
      jsonb_build_object('title', v_item ->> 'title', 'description', v_item ->> 'description')
    );
    v_inserted := v_inserted + 1;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(v_content -> 'settingEvents', '[]'::jsonb))
  loop
    insert into public.passport_clinical_content
      (passport_id, author_id, author_role, source_document_type, source_document_id, item_type, content)
    values (
      v_passport_id, v_clinician_id, 'clinician', 'fba_report', p_fba_id, 'setting_event',
      jsonb_build_object('title', v_item ->> 'title', 'description', v_item ->> 'description')
    );
    v_inserted := v_inserted + 1;
  end loop;

  -- Strategy groups: identical shape aside from item_type, now also
  -- carrying source_entry_id (the original StrategyEntry.id, so a
  -- linked Calm Card's strategy_ref can be resolved back to this row --
  -- see judgment call 1) and strategy_type_id (the authored tag, if any).
  for v_item in select * from jsonb_array_elements(coalesce(v_content -> 'recommendationsHome', '[]'::jsonb))
  loop
    insert into public.passport_clinical_content
      (passport_id, author_id, author_role, source_document_type, source_document_id, item_type, content)
    values (
      v_passport_id, v_clinician_id, 'clinician', 'fba_report', p_fba_id, 'strategy_home',
      jsonb_build_object(
        'title', v_item ->> 'title',
        'description', array_to_string(
          array(select jsonb_array_elements_text(coalesce(v_item -> 'details', '[]'::jsonb))), E'\n'
        ),
        'source_entry_id', v_item ->> 'id',
        'strategy_type_id', v_item ->> 'strategyType'
      )
    );
    v_inserted := v_inserted + 1;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(v_content -> 'recommendationsSchool', '[]'::jsonb))
  loop
    insert into public.passport_clinical_content
      (passport_id, author_id, author_role, source_document_type, source_document_id, item_type, content)
    values (
      v_passport_id, v_clinician_id, 'clinician', 'fba_report', p_fba_id, 'strategy_school',
      jsonb_build_object(
        'title', v_item ->> 'title',
        'description', array_to_string(
          array(select jsonb_array_elements_text(coalesce(v_item -> 'details', '[]'::jsonb))), E'\n'
        ),
        'source_entry_id', v_item ->> 'id',
        'strategy_type_id', v_item ->> 'strategyType'
      )
    );
    v_inserted := v_inserted + 1;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(v_content -> 'recommendationsShared', '[]'::jsonb))
  loop
    insert into public.passport_clinical_content
      (passport_id, author_id, author_role, source_document_type, source_document_id, item_type, content)
    values (
      v_passport_id, v_clinician_id, 'clinician', 'fba_report', p_fba_id, 'strategy_shared',
      jsonb_build_object(
        'title', v_item ->> 'title',
        'description', array_to_string(
          array(select jsonb_array_elements_text(coalesce(v_item -> 'details', '[]'::jsonb))), E'\n'
        ),
        'source_entry_id', v_item ->> 'id',
        'strategy_type_id', v_item ->> 'strategyType'
      )
    );
    v_inserted := v_inserted + 1;
  end loop;

  insert into public.activity_log (passport_id, actor_id, event_type, event_description)
  values (
    v_passport_id, auth.uid(), 'clinical_content_added',
    format('Clinician strategies added to %s''s passport', v_child_name)
  );

  return v_inserted;
end;
$$;


-- ============================================================
-- 6. One-time backfill for content extracted BEFORE this migration
--    (Judgment call 1's stated risk)
-- ============================================================

do $$
declare
  v_group_by_item_type jsonb := jsonb_build_object(
    'strategy_home', 'recommendationsHome',
    'strategy_school', 'recommendationsSchool',
    'strategy_shared', 'recommendationsShared'
  );
  v_row record;
  v_group_key text;
  v_matches jsonb;
begin
  for v_row in
    select pcc.id, pcc.item_type, pcc.content, fr.content_data
    from public.passport_clinical_content pcc
    join public.fba_reports fr
      on fr.id = pcc.source_document_id and pcc.source_document_type = 'fba_report'
    where pcc.item_type in ('strategy_home', 'strategy_school', 'strategy_shared')
      and not (pcc.content ? 'source_entry_id')
  loop
    v_group_key := v_group_by_item_type ->> v_row.item_type;

    select jsonb_agg(entry) into v_matches
    from jsonb_array_elements(coalesce(v_row.content_data -> v_group_key, '[]'::jsonb)) entry
    where entry ->> 'title' = v_row.content ->> 'title';

    -- Only ever link on an UNAMBIGUOUS title match within this FBA's
    -- own array. Zero or multiple matches are left null -- degrades to
    -- "no home-side match for this strategy" rather than risking a
    -- wrong linkage (see this migration's header comment).
    if jsonb_array_length(coalesce(v_matches, '[]'::jsonb)) = 1 then
      update public.passport_clinical_content
      set content = content || jsonb_build_object('source_entry_id', v_matches -> 0 ->> 'id')
      where id = v_row.id;
    end if;
  end loop;
end $$;


-- ============================================================
-- 7. update_locked_strategy_tag() -- companion-layer post-hoc tagging
--    (Judgment call 4)
-- ============================================================

create or replace function public.update_locked_strategy_tag(
  p_fba_id uuid,
  p_group text,
  p_entry_id text,
  p_strategy_type_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinician_id uuid;
  v_passport_id uuid;
  v_content jsonb;
  v_entries jsonb;
  v_updated_entries jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_found boolean := false;
begin
  if p_group not in ('recommendationsHome', 'recommendationsSchool', 'recommendationsShared') then
    raise exception 'Invalid strategy group';
  end if;

  select fr.clinician_id, fr.passport_id, fr.content_data
  into v_clinician_id, v_passport_id, v_content
  from public.fba_reports fr
  where fr.id = p_fba_id;

  if v_clinician_id is null then
    raise exception 'FBA not found';
  end if;

  -- Same authoring-clinician/verified/active-link predicate as
  -- fba_calm_cards' own RLS policies -- deliberately NO status check,
  -- since a tag edit is allowed on a locked FBA by design (it's
  -- metadata, not the FBA's clinical content).
  if v_clinician_id <> auth.uid()
    or not public.is_verified_clinician(auth.uid())
    or not exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = v_passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  then
    raise exception 'Not authorized to tag strategies on this FBA';
  end if;

  v_entries := coalesce(v_content -> p_group, '[]'::jsonb);

  -- Rebuild the array, touching ONLY the matching entry's strategyType
  -- key -- every other entry, and every other field on the matching
  -- entry itself (title/details/id), passes through unchanged.
  for v_entry in select * from jsonb_array_elements(v_entries)
  loop
    if v_entry ->> 'id' = p_entry_id then
      v_entry := v_entry || jsonb_build_object('strategyType', p_strategy_type_id);
      v_found := true;
    end if;
    v_updated_entries := v_updated_entries || jsonb_build_array(v_entry);
  end loop;

  if not v_found then
    raise exception 'Strategy entry not found';
  end if;

  update public.fba_reports
  set content_data = jsonb_set(content_data, array[p_group], v_updated_entries)
  where id = p_fba_id;
end;
$$;

grant execute on function public.update_locked_strategy_tag(uuid, text, text, uuid) to authenticated;


-- ============================================================
-- 8. get_strategy_effectiveness() -- Stage 3's per-child rollup
-- ============================================================

create or replace function public.get_strategy_effectiveness(p_passport_id uuid)
returns table (
  strategy_content_id uuid,
  item_type text,
  title text,
  strategy_type_id uuid,
  home_helped integer,
  home_partly integer,
  home_not integer,
  school_helped integer,
  school_partly integer,
  school_not integer,
  total_ratings integer,
  ratings_timeline jsonb
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not (
    public.owns_passport(p_passport_id)
    or (
      public.is_verified_clinician(auth.uid())
      and exists (
        select 1 from public.clinician_access ca
        where ca.passport_id = p_passport_id
          and ca.clinician_id = auth.uid()
          and ca.is_active = true
      )
    )
  ) then
    raise exception 'Not authorized to view strategy effectiveness for this passport';
  end if;

  return query
  with strategies as (
    select
      pcc.id,
      pcc.item_type,
      pcc.content ->> 'title' as title,
      nullif(pcc.content ->> 'strategy_type_id', '')::uuid as strategy_type_id,
      case pcc.item_type
        when 'strategy_home' then 'recommendationsHome'
        when 'strategy_school' then 'recommendationsSchool'
        when 'strategy_shared' then 'recommendationsShared'
      end as group_key,
      pcc.content ->> 'source_entry_id' as source_entry_id
    from public.passport_clinical_content pcc
    where pcc.passport_id = p_passport_id
      and pcc.item_type in ('strategy_home', 'strategy_school', 'strategy_shared')
  ),
  -- "Home" ratings: every strategy_feedback row on a Calm Card whose
  -- strategy_ref resolves to this strategy's source_entry_id (always
  -- parent-written, context='calm_episode' -- see judgment call 5).
  home_feedback as (
    select s.id as strategy_id, sf.rating, sf.created_at
    from strategies s
    join public.fba_reports fr on fr.passport_id = p_passport_id
    join public.fba_calm_cards fc
      on fc.fba_id = fr.id
      and s.source_entry_id is not null
      and fc.strategy_ref = s.group_key || ':' || s.source_entry_id
    join public.strategy_feedback sf on sf.calm_card_id = fc.id
  ),
  -- "School" ratings: every row targeting this strategy directly
  -- (always teacher-written, context='eod' -- see judgment call 5).
  school_feedback as (
    select s.id as strategy_id, sf.rating, sf.created_at
    from strategies s
    join public.strategy_feedback sf on sf.strategy_content_id = s.id
  ),
  all_feedback as (
    select * from home_feedback
    union all
    select * from school_feedback
  )
  select
    s.id,
    s.item_type,
    s.title,
    s.strategy_type_id,
    coalesce((select count(*) from home_feedback hf where hf.strategy_id = s.id and hf.rating = 'helped'), 0)::integer,
    coalesce((select count(*) from home_feedback hf where hf.strategy_id = s.id and hf.rating = 'partly'), 0)::integer,
    coalesce((select count(*) from home_feedback hf where hf.strategy_id = s.id and hf.rating = 'not'), 0)::integer,
    coalesce((select count(*) from school_feedback scf where scf.strategy_id = s.id and scf.rating = 'helped'), 0)::integer,
    coalesce((select count(*) from school_feedback scf where scf.strategy_id = s.id and scf.rating = 'partly'), 0)::integer,
    coalesce((select count(*) from school_feedback scf where scf.strategy_id = s.id and scf.rating = 'not'), 0)::integer,
    coalesce((select count(*) from all_feedback af where af.strategy_id = s.id), 0)::integer,
    coalesce(
      (select jsonb_agg(jsonb_build_object('rating', af.rating, 'created_at', af.created_at) order by af.created_at)
       from all_feedback af where af.strategy_id = s.id),
      '[]'::jsonb
    )
  from strategies s
  order by s.item_type, s.title;
end;
$$;

grant execute on function public.get_strategy_effectiveness(uuid) to authenticated;


-- ============================================================
-- 9. get_clinician_strategy_type_insights() -- Stage 4's caseload
--    rollup
-- ============================================================

create or replace function public.get_clinician_strategy_type_insights(
  p_setting text default null, -- 'home' | 'school' | null (both)
  p_period_days integer default null -- null = all time
)
returns table (
  strategy_type_id uuid,
  strategy_type_label text,
  child_count integer,
  rating_count integer,
  helped_count integer,
  partly_count integer,
  not_count integer,
  home_rating_count integer,
  home_helped_count integer,
  school_rating_count integer,
  school_helped_count integer
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_clinician_id uuid := auth.uid();
begin
  if not public.is_verified_clinician(v_clinician_id) then
    raise exception 'Not authorized';
  end if;

  if p_setting is not null and p_setting not in ('home', 'school') then
    raise exception 'Invalid setting filter';
  end if;

  return query
  with active_cases as (
    -- Query-enforced live scope: a case dropped by revocation (is_active
    -- = false) simply isn't in this set on the very next call -- no
    -- caching, nothing to invalidate.
    select ca.passport_id
    from public.clinician_access ca
    where ca.clinician_id = v_clinician_id and ca.is_active = true
  ),
  strategies as (
    select
      pcc.id,
      pcc.passport_id,
      nullif(pcc.content ->> 'strategy_type_id', '')::uuid as strategy_type_id,
      case pcc.item_type
        when 'strategy_home' then 'recommendationsHome'
        when 'strategy_school' then 'recommendationsSchool'
        when 'strategy_shared' then 'recommendationsShared'
      end as group_key,
      pcc.content ->> 'source_entry_id' as source_entry_id
    from public.passport_clinical_content pcc
    join active_cases ac on ac.passport_id = pcc.passport_id
    where pcc.item_type in ('strategy_home', 'strategy_school', 'strategy_shared')
  ),
  home_feedback as (
    select s.passport_id, s.strategy_type_id, sf.rating, 'home'::text as setting
    from strategies s
    join public.fba_reports fr on fr.passport_id = s.passport_id
    join public.fba_calm_cards fc
      on fc.fba_id = fr.id
      and s.source_entry_id is not null
      and fc.strategy_ref = s.group_key || ':' || s.source_entry_id
    join public.strategy_feedback sf on sf.calm_card_id = fc.id
    where p_period_days is null or sf.created_at >= now() - (p_period_days || ' days')::interval
  ),
  school_feedback as (
    select s.passport_id, s.strategy_type_id, sf.rating, 'school'::text as setting
    from strategies s
    join public.strategy_feedback sf on sf.strategy_content_id = s.id
    where p_period_days is null or sf.created_at >= now() - (p_period_days || ' days')::interval
  ),
  filtered as (
    select * from home_feedback where p_setting is null or p_setting = 'home'
    union all
    select * from school_feedback where p_setting is null or p_setting = 'school'
  )
  select
    f.strategy_type_id,
    coalesce(st.label, 'Untagged'),
    count(distinct f.passport_id)::integer,
    count(*)::integer,
    count(*) filter (where f.rating = 'helped')::integer,
    count(*) filter (where f.rating = 'partly')::integer,
    count(*) filter (where f.rating = 'not')::integer,
    count(*) filter (where f.setting = 'home')::integer,
    count(*) filter (where f.setting = 'home' and f.rating = 'helped')::integer,
    count(*) filter (where f.setting = 'school')::integer,
    count(*) filter (where f.setting = 'school' and f.rating = 'helped')::integer
  from filtered f
  left join public.strategy_types st on st.id = f.strategy_type_id
  group by f.strategy_type_id, st.label
  order by count(*) desc;
end;
$$;

grant execute on function public.get_clinician_strategy_type_insights(text, integer) to authenticated;
