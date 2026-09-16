-- Stage 8, security fix: the FBA completed-lock was silently lost for
-- AFLS during the 0060 rebuild, and never fully existed for instrument
-- requests. See CLAUDE.md's own new entry for the general lesson
-- ("a rebuild can silently drop a gate and claim it did not"); this
-- migration is the concrete repair.
--
-- CONFIRMED, NOT THEORETICAL: exactly one completed FBA exists in
-- production. Its afls_assessments row was genuinely updated roughly 18
-- hours after the FBA's own completed_at -- a real post-lock write, on
-- the only real (if test-content) clinical document currently in the
-- system. That row is left alone by this migration -- fixing the gate,
-- not rewriting history. See the deployment report for the full
-- timeline and what it does/doesn't mean for the published strategies.
--
-- ============================================================
-- 1. afls_assessments -- restore the completed-lock on INSERT/UPDATE/
--    DELETE, matching what fba_afls_data (the table this replaced) had
--    from the start, and what fba_reports' own UPDATE policy still has
--    today. The 0060 rebuild's own comment claimed "DELIBERATELY
--    WITHOUT fba_reports' status <> 'completed' guard... same posture
--    as fba_calm_cards" -- that analogy was wrong. AFLS is scored
--    clinical assessment data feeding the functional analysis; Calm
--    Cards are a companion layer that only references already-locked
--    conclusions, never constitutes them. The two tables are not
--    alike, and only one of them should ever have been exempt.
-- ============================================================

alter policy "Clinicians can create AFLS assessments on their own FBAs"
  on public.afls_assessments
  with check (
    exists (
      select 1 from public.fba_reports fr
      where fr.id = afls_assessments.fba_id
        and fr.status <> 'completed'
        and fr.clinician_id = auth.uid()
        and public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = fr.passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
    )
  );

alter policy "Clinicians can update their own AFLS assessments"
  on public.afls_assessments
  using (
    exists (
      select 1 from public.fba_reports fr
      where fr.id = afls_assessments.fba_id
        and fr.status <> 'completed'
        and fr.clinician_id = auth.uid()
        and public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = fr.passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
    )
  )
  with check (
    exists (
      select 1 from public.fba_reports fr
      where fr.id = afls_assessments.fba_id
        and fr.status <> 'completed'
        and fr.clinician_id = auth.uid()
        and public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = fr.passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
    )
  );

alter policy "Clinicians can delete their own AFLS assessments"
  on public.afls_assessments
  using (
    exists (
      select 1 from public.fba_reports fr
      where fr.id = afls_assessments.fba_id
        and fr.status <> 'completed'
        and fr.clinician_id = auth.uid()
        and public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = fr.passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
    )
  );

-- ============================================================
-- 2. fba_calm_cards -- LEFT ALONE, no policy change, DELIBERATELY.
--    Restating 0053's own reasoning here so the next person who reads
--    THIS migration, sees afls_assessments' lock restored, and notices
--    fba_calm_cards still has none, understands why before "fixing" it
--    the other way: Calm Cards are a companion layer, not FBA content.
--    Retro-adding a Calm Card to an FBA finalised before the Calm
--    Button feature existed is a real, named, wanted capability
--    (0053's own "constraint 1B"). A Calm Card only REFERENCES an
--    already-locked strategy via strategy_ref; it never constitutes or
--    changes the clinical conclusion itself. This is the one place in
--    the FBA module where "companion layer, exempt from the lock" is
--    actually true -- do not extend it to any other table without the
--    same reasoning genuinely applying.
-- ============================================================

-- ============================================================
-- 3. fba_instrument_requests -- two gaps, neither previously
--    documented as deliberate.
-- ============================================================

-- 3a. Clinician INSERT -- add the completed-lock. Sending a fresh
-- questionnaire on an already-finalised FBA should not be possible.
alter policy "Clinicians can create instrument requests for their own linked FBAs"
  on public.fba_instrument_requests
  with check (
    exists (
      select 1 from public.fba_reports fr
      join public.clinician_access ca on ca.passport_id = fr.passport_id
      where fr.id = fba_instrument_requests.fba_id
        and fr.status <> 'completed'
        and fr.clinician_id = auth.uid()
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
        and public.is_verified_clinician(auth.uid())
    )
  );

-- 3b. status gains 'cancelled' -- a request the clinician's own
-- finalise action withdraws (3c below), not a state a recipient or
-- clinician sets directly. Dynamic lookup for the constraint name,
-- matching 0029's own pattern -- never assume a generated name.
do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'public.fba_instrument_requests'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%in%';

  if v_constraint_name is not null then
    execute format('alter table public.fba_instrument_requests drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table public.fba_instrument_requests add constraint fba_instrument_requests_status_check
  check (status in ('sent', 'in_progress', 'completed', 'cancelled'));

-- 3c. Recipient UPDATE -- gated on the FBA's own status now, not just
-- the request's. "A parent or teacher submitting into an FBA that was
-- finalised last week is the same problem by a different route."
-- status not in ('completed', 'cancelled') replaces the old bare
-- status <> 'completed' -- a cancelled request (3d below) must not
-- become writable again just because its own status isn't literally
-- 'completed'.
alter policy "Recipients can update their own responses"
  on public.fba_instrument_requests
  using (
    recipient_id = auth.uid()
    and status not in ('completed', 'cancelled')
    and exists (
      select 1 from public.fba_reports fr
      where fr.id = fba_instrument_requests.fba_id
        and fr.status <> 'completed'
    )
  );

-- 3d. finalize_fba_report() (0197) -- one more step folded into the
-- same atomic transaction: any outstanding (sent/in_progress) request
-- on this FBA is cancelled the moment it's finalised, rather than
-- silently becoming unwritable with no explanation. "Whoever holds it
-- needs to see why" -- QuestionnaireFlow.tsx (client-side fix,
-- companion commit) renders an explicit "this request was cancelled
-- because the assessment has been finalised" state for status =
-- 'cancelled', instead of either the form or a bare RLS refusal.
create or replace function public.finalize_fba_report(p_fba_id uuid)
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
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select fr.passport_id, fr.clinician_id, fr.status, fr.content_data, p.child_name
  into v_passport_id, v_clinician_id, v_status, v_content, v_child_name
  from public.fba_reports fr
  join public.passports p on p.id = fr.passport_id
  where fr.id = p_fba_id;

  if v_passport_id is null then
    raise exception 'FBA not found';
  end if;

  if v_clinician_id is distinct from auth.uid() then
    raise exception 'Only the clinician who owns this FBA can finalise it.';
  end if;

  if v_status = 'completed' then
    raise exception 'This FBA has already been finalised.';
  end if;

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

  -- NEW: cancel any outstanding instrument request on this FBA in the
  -- same transaction -- see the header comment on this migration's own
  -- section 3d.
  update public.fba_instrument_requests
  set status = 'cancelled'
  where fba_id = p_fba_id
    and status in ('sent', 'in_progress');

  update public.fba_reports
  set status = 'completed'
  where id = p_fba_id;

  return v_inserted;
end;
$$;

grant execute on function public.finalize_fba_report(uuid) to authenticated;

-- ============================================================
-- 4. get_my_instrument_requests() -- widened to also return a
--    recipient's own 'cancelled' requests, not just sent/in_progress.
--    Without this, a request 3d cancels simply vanishes from
--    QuestionnairePromptCard's own list on the next load -- correct
--    that it's no longer actionable, wrong that it disappears with no
--    trace. "Whoever holds it needs to see why."
--
--    CORRECTED AFTER A FAILED FIRST RUN: the live signature (0048, not
--    0041 -- 0048 added `instruction` between clinician_name and
--    created_at, and nothing since has touched it) carries an
--    `instruction` column the first version of this migration dropped.
--    Postgres refused the CREATE OR REPLACE outright (42P13, "cannot
--    change return type of existing function... Row type defined by
--    OUT parameters is different") rather than silently applying it --
--    which is the only reason this was caught before it shipped and
--    silently blanked every request's own instruction line client-side
--    (QuestionnairePromptCard.tsx / MyInstrumentRequest.instruction,
--    both live, both reading this column today). Exactly this file's
--    own "READ THE LIVE DEFINITION, NOT THE FIRST ONE YOU FOUND"
--    gotcha -- re-grepped every migration touching this function
--    (0041, 0048, 0141) before writing the corrected version below.
-- ============================================================

create or replace function public.get_my_instrument_requests()
returns table (
  id uuid,
  fba_id uuid,
  instrument_type text,
  status text,
  child_name text,
  clinician_name text,
  instruction text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.id,
    r.fba_id,
    r.instrument_type,
    r.status,
    p.child_name,
    coalesce(cu.raw_user_meta_data ->> 'full_name', cu.raw_app_meta_data ->> 'full_name') as clinician_name,
    r.instruction,
    r.created_at
  from public.fba_instrument_requests r
  join public.fba_reports fr on fr.id = r.fba_id
  join public.passports p on p.id = r.passport_id
  join auth.users cu on cu.id = fr.clinician_id
  where r.recipient_id = auth.uid()
    and r.status in ('sent', 'in_progress', 'cancelled')
  order by r.created_at asc;
$$;

grant execute on function public.get_my_instrument_requests() to authenticated;
