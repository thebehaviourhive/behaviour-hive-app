-- FBA MODULE -- STAGE 3 schema additions: completion, parent visibility,
-- and passport extraction.
--
-- Judgment calls, spelled out:
--
--   1. Daily Patterns (Part A) needs the clinician to read
--      morning_checkins and teacher_updates. Migration 0026 deliberately
--      withheld this ("that's parent/teacher daily communication, not a
--      clinical record"). The Stage 3 brief explicitly asks for it as
--      evidence for the clinician's narrative, so this migration adds
--      exactly the same active-link + verified SELECT pattern already
--      used everywhere else a clinician reads passport-linked data
--      (abc_logs, passports, passport_section_b/c/d) -- nothing wider.
--      Both tables already carry every column the panel needs
--      (regulation_state/settled_state, flags, heads_up, submitted_at);
--      no column changes.
--
--   2. Parents can already read a completed fba_reports/fba_afls_data
--      row (Stage 1), but NOT fba_instrument_requests -- that table only
--      ever had clinician and recipient-self policies. The Part C reader
--      view needs every completed QABF/MAS/Open-Ended result on the
--      child's FBA, regardless of who the recipient was (e.g. a
--      teacher-completed MAS). New parent SELECT policy, gated the same
--      way fba_reports' own parent policy is: status = 'completed' +
--      owns_passport.
--
--   3. Parent visibility on fba_completed: migration 0040 excluded BOTH
--      fba_started and fba_completed from the parent's direct
--      activity_log read. This narrows that exclusion to fba_started
--      only, via the same ALTER POLICY minimal-diff mechanism already
--      used twice on this exact policy. fba_started stays hidden (a
--      parent doesn't need to know an assessment is merely underway);
--      fba_completed becomes visible, which is the whole point of Part
--      B/C. No get_teacher_activity_feed() change needed here --
--      fba_completed was never in its allow-list, so it's already
--      excluded from teachers by omission; the brief's "update the feed
--      filters accordingly" is satisfied by leaving that one alone.
--
--   4. One new activity_log event type: clinical_content_added, for
--      Part D's "Clinician strategies added to [child]'s passport". Its
--      actor is the PARENT (they're the one invoking the approval RPC),
--      not the clinician -- so it needs no special-case carved into
--      get_teacher_activity_feed()'s existing "not authored by a
--      clinician" exclusion, and reaches the parent automatically via
--      the same deny-list policy narrowed in judgment call #3. Added to
--      all three places an event type is allow-listed: the CHECK
--      constraint, get_clinician_activity_feed() (so the clinician sees
--      their strategies were published), and get_teacher_activity_feed()
--      (explicitly asked for, "if consistent with team_linked-style
--      visibility" -- team_linked is already in that allow-list, so this
--      follows the same rule literally).
--
--   5. approve_fba_strategies() -- Part D's extraction RPC -- is
--      SECURITY DEFINER and re-implements its own authorization check
--      (owns_passport + status = 'completed'), exactly like every other
--      privileged function in this schema. Idempotency is delete-then-
--      reinsert scoped to (source_document_type, source_document_id):
--      passport_clinical_content has no natural per-item unique key
--      (two triggers could legitimately share identical title text), so
--      re-running the same approval always clears exactly what it
--      previously wrote before writing it again -- never accumulates
--      duplicates, and is safe to call again after, say, a network
--      retry. Every extracted item is normalized to the same {title,
--      description} content shape regardless of item_type (including
--      strategies, whose source StrategyEntry.details is an array --
--      joined with newlines into one description) so the passport
--      section renderer built in Part E stays generic across item_type,
--      per the brief's "no FBA-specific hardcoding" requirement.
--
--   6. No RPC for Finalize (Part B) itself -- the client already has
--      everything it needs via fba_reports' existing clinician UPDATE
--      policy (Stage 1: allowed while status <> 'completed') and the
--      existing completed_at trigger. "Required sections" for enabling
--      the Finalize button is a client-side UX gate, not a new security
--      boundary -- an incomplete FBA getting finalized is a workflow
--      concern the confirmation dialog covers, not a data-integrity
--      risk, so it doesn't need database enforcement.

-- ============================================================
-- 1. Daily Patterns (Part A) -- clinician read access
-- ============================================================

create policy "Verified linked clinicians can view morning check-ins"
  on public.morning_checkins
  for select
  to authenticated
  using (
    exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = morning_checkins.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
    and public.is_verified_clinician(auth.uid())
  );

create policy "Verified linked clinicians can view teacher updates"
  on public.teacher_updates
  for select
  to authenticated
  using (
    exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = teacher_updates.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
    and public.is_verified_clinician(auth.uid())
  );

-- ============================================================
-- 2. Parent reader view (Part C) -- fba_instrument_requests access
-- ============================================================

create policy "Parents can view instrument requests for their own completed FBA"
  on public.fba_instrument_requests
  for select
  to authenticated
  using (
    exists (
      select 1 from public.fba_reports fr
      where fr.id = fba_instrument_requests.fba_id
        and fr.status = 'completed'
        and public.owns_passport(fr.passport_id)
    )
  );

-- ============================================================
-- 3. activity_log -- new event type + feed/policy updates
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
    'clinical_content_added'
  ));

-- Judgment call #3: narrows the exclusion to fba_started only, so
-- fba_completed (and the new clinical_content_added) reach the parent.
alter policy "Parents can view activity for their own passport"
  on public.activity_log
  using (
    public.owns_passport(passport_id)
    and event_type <> 'fba_started'
  );

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
      'access_revoked', 'fba_started', 'fba_completed', 'clinical_content_added'
    )
  order by al.created_at desc
  limit p_limit offset p_offset;
$$;

create or replace function public.get_teacher_activity_feed(
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
  join public.passport_access pa
    on pa.passport_id = al.passport_id
    and pa.teacher_id = auth.uid()
    and pa.is_active = true
  join public.passport_institution_links pil
    on pil.passport_id = pa.passport_id
    and pil.institution_id = pa.institution_id
    and pil.approved_by_parent = true
  where al.event_type in (
      'passport_updated', 'abc_logged', 'team_linked', 'strategy_logged',
      'access_revoked', 'afternoon_update', 'clinical_content_added'
    )
    and not exists (
      select 1 from public.clinicians c where c.user_id = al.actor_id
    )
  order by al.created_at desc
  limit p_limit offset p_offset;
$$;

-- ============================================================
-- 4. approve_fba_strategies() -- Part D's extraction RPC
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
        )
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
        )
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
        )
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

grant execute on function public.approve_fba_strategies(uuid) to authenticated;
