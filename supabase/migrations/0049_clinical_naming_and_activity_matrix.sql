-- CLINICIAN NAMING STANDARDISATION + CLINICAL ACTIVITY-FEED MATRIX
--
-- Part 1: get_passport_clinical_content() gains author_specialty, so the
-- "From your Clinical Team" attribution line (parent/clinician AND
-- teacher tracks) can render "[Full name], [Specialty]" instead of name
-- alone. Every row's author_role is currently always 'clinician' (the
-- table's only writer, approve_fba_strategies(), hard-codes it) -- a
-- plain LEFT JOIN to clinicians is enough, no author_role branching
-- needed. LEFT (not inner) so a row somehow missing a clinicians
-- profile still returns author_name with a null specialty, matching
-- the existing coalesce-to-degrade posture everywhere else in this
-- function.
--
-- Return shape changes (new column) -- Postgres won't let CREATE OR
-- REPLACE change that, so this is an explicit DROP + CREATE (same
-- lesson as migration 0048).
--
-- Part 2: the activity-feed visibility matrix.
--   - questionnaire_sent / questionnaire_completed are two new event
--     types (clinicians tracking their own sends/completions is useful,
--     per the brief) -- added to the CHECK constraint and to
--     get_clinician_activity_feed()'s allow-list only. They are
--     deliberately NEVER added to get_teacher_activity_feed()'s
--     allow-list or to the parent policy's visible set: the prompt
--     card is the parent/teacher-facing surface for these, a feed
--     entry would be noise, and for a teacher-recipient it would be a
--     near-leak of clinical process.
--   - fba_started becomes visible to the parent (narrows the existing
--     exclusion), matching the brief's rationale: the FBA card's State
--     C already discloses an in-progress assessment openly, so hiding
--     this specific event from the parent's feed protects nothing.
--   - get_teacher_activity_feed() needs NO change: fba_started,
--     fba_completed, questionnaire_sent, questionnaire_completed are
--     all already absent from its allow-list, which is itself an
--     allow-list (not a deny-list) -- so the "teacher: NEVER" cells are
--     already correct by construction. Included below only as an
--     explicit audit comment, not a functional change.
--   - clinical_content_added needs no change anywhere -- already ✓/✓/✓.

-- ============================================================
-- 1. get_passport_clinical_content() -- add author_specialty
-- ============================================================

drop function if exists public.get_passport_clinical_content(uuid);

create function public.get_passport_clinical_content(p_passport_id uuid)
returns table (
  id uuid,
  item_type text,
  content jsonb,
  author_role text,
  author_name text,
  author_specialty text,
  source_document_type text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    pcc.id,
    pcc.item_type,
    pcc.content,
    pcc.author_role,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as author_name,
    c.specialty as author_specialty,
    pcc.source_document_type,
    pcc.created_at
  from public.passport_clinical_content pcc
  join auth.users u on u.id = pcc.author_id
  left join public.clinicians c on c.user_id = pcc.author_id
  where pcc.passport_id = p_passport_id
    and (
      public.owns_passport(p_passport_id)
      or (
        exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = p_passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
        and public.is_verified_clinician(auth.uid())
      )
      or (
        pcc.item_type in ('strategy_school', 'strategy_shared', 'trigger', 'setting_event')
        and exists (
          select 1 from public.passport_access pa
          where pa.passport_id = p_passport_id
            and pa.teacher_id = auth.uid()
            and pa.is_active = true
        )
      )
    )
  order by pcc.created_at asc;
$$;

grant execute on function public.get_passport_clinical_content(uuid) to authenticated;

-- ============================================================
-- 2. activity_log -- two new event types
-- ============================================================

alter table public.activity_log drop constraint if exists activity_log_event_type_check;
alter table public.activity_log add constraint activity_log_event_type_check
  check (event_type in (
    'passport_updated',
    'morning_checkin',
    'afternoon_update',
    'abc_logged',
    'passport_shared',
    'team_linked',
    'clinician_logged',
    'strategy_logged',
    'access_revoked',
    'fba_started',
    'fba_completed',
    'clinical_content_added',
    'questionnaire_sent',
    'questionnaire_completed'
  ));

-- ============================================================
-- 3. Parent visibility: fba_started now shown; questionnaire events
--    never shown (both via the same minimal-diff ALTER POLICY already
--    used twice on this exact policy in migrations 0040/0042)
-- ============================================================

alter policy "Parents can view activity for their own passport"
  on public.activity_log
  using (
    public.owns_passport(passport_id)
    and event_type not in ('questionnaire_sent', 'questionnaire_completed')
  );

-- ============================================================
-- 4. Clinician feed: add questionnaire_sent/questionnaire_completed
--    (return shape unchanged, CREATE OR REPLACE is safe here)
-- ============================================================

create or replace function public.get_clinician_activity_feed(
  p_limit integer default 20, p_offset integer default 0
)
returns table (
  id uuid, passport_id uuid, child_name text, event_type text,
  event_description text, created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select al.id, al.passport_id, p.child_name, al.event_type, al.event_description, al.created_at
  from public.activity_log al
  join public.passports p on p.id = al.passport_id
  join public.clinician_access ca on ca.passport_id = al.passport_id
  where ca.clinician_id = auth.uid()
    and ca.is_active = true
    and public.is_verified_clinician(auth.uid())
    and al.event_type in (
      'abc_logged', 'passport_updated', 'clinician_logged', 'team_linked',
      'access_revoked', 'fba_started', 'fba_completed', 'clinical_content_added',
      'questionnaire_sent', 'questionnaire_completed'
    )
  order by al.created_at desc
  limit p_limit offset p_offset;
$$;

-- ============================================================
-- 5. get_teacher_activity_feed() -- audited, NOT changed.
--    fba_started/fba_completed/questionnaire_sent/questionnaire_completed
--    are all absent from this allow-list already:
--
--      and al.event_type in (
--          'passport_updated', 'abc_logged', 'team_linked', 'strategy_logged',
--          'access_revoked', 'afternoon_update', 'clinical_content_added'
--        )
--
--    An allow-list excludes by omission, so the "teacher: NEVER" cells
--    for all four event types are already correct and adversarially
--    safe at the query level -- no CREATE OR REPLACE needed.
-- ============================================================
