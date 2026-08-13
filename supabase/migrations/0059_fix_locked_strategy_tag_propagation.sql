/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   Bug fix, found live during Stage 4 verification: update_locked_strategy_tag()
   (migration 0055) only ever wrote the tag into fba_reports.content_data
   -- the FBA's own JSON, keyed 'strategyType' (camelCase). It never
   touched the SEPARATE, already-extracted copy in
   passport_clinical_content (keyed 'strategy_type_id', snake_case,
   stamped once by approve_fba_strategies() at approval time).

   The whole point of "post-hoc tagging on a locked FBA" (brief's own
   words: "clinicians can add/edit the tag on existing strategies
   post-hoc") is tagging AFTER the fact -- which for any FBA approved
   before this feature existed, or simply tagged after its own
   approval, is also AFTER extraction already ran. Every one of
   get_strategy_effectiveness() and get_clinician_strategy_type_insights()
   reads strategy_type_id from passport_clinical_content, never from
   fba_reports -- so a post-hoc tag was silently invisible to every
   aggregate it exists to feed. Caught live: tagged "Test" as
   "Transition warning", confirmed it persisted and the FBA stayed
   locked, then found Strategy Insights still showed it under
   "Untagged".

   Fix: after the existing fba_reports write, also update the matching
   passport_clinical_content row if one exists (extraction already
   happened) -- matched via source_entry_id, which was stamped as this
   same entry's id at extraction time, so it's an exact match, not a
   title-based guess like the earlier source_entry_id backfill needed.
   If no matching row exists yet (not extracted, or extraction genuinely
   predates the source_entry_id fix and was never backfilled), this
   update simply touches zero rows -- a future approve_fba_strategies()
   re-run will pick up the FBA-side tag as it always has. Purely
   additive to the existing function: the fba_reports write is
   byte-identical to before, this is a second write alongside it. */

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
  v_item_type text;
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

  -- NEW: keep the already-extracted passport_clinical_content copy in
  -- sync, if one exists -- see this migration's own header comment.
  v_item_type := case p_group
    when 'recommendationsHome' then 'strategy_home'
    when 'recommendationsSchool' then 'strategy_school'
    when 'recommendationsShared' then 'strategy_shared'
  end;

  update public.passport_clinical_content
  set content = content || jsonb_build_object('strategy_type_id', p_strategy_type_id)
  where passport_id = v_passport_id
    and item_type = v_item_type
    and content ->> 'source_entry_id' = p_entry_id;
end;
$$;

grant execute on function public.update_locked_strategy_tag(uuid, text, text, uuid) to authenticated;
