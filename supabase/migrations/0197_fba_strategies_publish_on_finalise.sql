-- Stage 7, item 6: FBA strategies publish on finalisation, not on a
-- separate parent approval step. See CLAUDE.md's own entry for the
-- governance reasoning -- recorded there, not just here, so a future
-- reader understands WHY this changed, not only that it did.
--
-- THE MECHANICS, per Daniel's own two instructions:
--   1. Fold extraction into the finalise action as one atomic step,
--      rather than widening approve_fba_strategies()'s own authorization
--      check to also accept a clinician. Publishing happens because the
--      FBA was finalised, not because someone with different authority
--      called a separate function -- so this is a genuinely new
--      operation (finalize_fba_report()), not approve_fba_strategies()
--      with a second gate bolted on.
--   2. approve_fba_strategies() itself is DROPPED, not left dormant. Its
--      whole reason to exist was the parent's own approval action, which
--      no longer exists -- a parent-callable RPC that publishes clinical
--      content into a child's passport, sitting live and reachable after
--      the consent step it implemented has been retired, is exactly the
--      kind of stale entry point CLAUDE.md's own gotchas warn about
--      elsewhere in this file (dead RLS policies, unwired escape
--      hatches). ApprovalBanner.tsx and its one render site
--      (passport/fba/[fbaId]/page.tsx) are removed in the same commit as
--      this migration -- see that commit for the client-side half.
--
-- Extraction logic below is copied verbatim from approve_fba_strategies()
-- (live def: 0055) -- same six loops (triggers/settingEvents/
-- recommendationsHome/recommendationsSchool/recommendationsShared),
-- same delete-before-insert idempotency, same activity_log entry. Only
-- the AUTHORIZATION and the TRIGGER changed: the caller must now be the
-- FBA's own clinician (fr.clinician_id = auth.uid()), not
-- owns_passport(); and this now ALSO performs the status transition to
-- 'completed' in the same transaction, replacing the plain client-side
-- .update({status: 'completed'}) ReviewSection.tsx used to do directly
-- (completed_at is still stamped by the existing DB trigger on that
-- column, unchanged, not set here).
drop function if exists public.approve_fba_strategies(uuid);

create function public.finalize_fba_report(p_fba_id uuid)
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

  -- NEW authorization: the FBA's own clinician, not the child's parent.
  if v_clinician_id is distinct from auth.uid() then
    raise exception 'Only the clinician who owns this FBA can finalise it.';
  end if;

  if v_status = 'completed' then
    raise exception 'This FBA has already been finalised.';
  end if;

  -- Idempotent: clear any previous extraction for this FBA before
  -- writing fresh rows (defensive against a retried call -- normal
  -- operation only ever finalises once, since v_status = 'completed'
  -- above refuses a second call).
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

  -- NEW: the status transition itself, folded in -- the one thing that
  -- used to be a separate, plain client-side .update() in
  -- ReviewSection.tsx's own handleFinalize(). Same trigger stamps
  -- completed_at as before, unchanged.
  update public.fba_reports
  set status = 'completed'
  where id = p_fba_id;

  return v_inserted;
end;
$$;

grant execute on function public.finalize_fba_report(uuid) to authenticated;
