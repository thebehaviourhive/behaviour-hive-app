-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 5 Stage 4, Step 2 -- set_episode_tags(), the only write path onto
-- episode_tags. One RPC captures both of section 7's rules without two
-- functions: "an admin sets tags at onboarding" and "a director
-- changing a tag themselves raises no request."
--
-- AUTHORIZATION: director (role='principal') always. Admin (role=
-- 'clinic_admin') ONLY when the episode currently has zero episode_tags
-- rows -- "at onboarding," read literally, not "admin may edit tags
-- generally." After an admin's own first successful call, the episode
-- is no longer untagged, so a second admin attempt refuses on the same
-- check with no separate state to track -- the "at onboarding" window
-- closes itself. Any LATER change (by anyone other than the director)
-- is change-request territory, Stage 5, not built here. clinical_lead
-- and clinician are not callers at all -- neither role is named as a
-- tagger anywhere in PRD section 5.
--
-- REPLACE, NOT MERGE: every call deletes the episode's existing tags
-- and inserts the new set. Simpler than a partial-update API, and
-- correct for both real callers -- admin's own call always starts from
-- zero rows (replace vs. insert-only are identical there), and a
-- director redefining an episode's tags is a deliberate, complete
-- restatement, not a diff. An empty array is a valid call -- clears
-- every tag.
--
-- VALIDATION: every (dimension, value) pair must exist as an active row
-- in the CALLING institution's own institution_tags catalog, checked in
-- full BEFORE any write -- a typo refuses cleanly, not partially. This
-- is 0207's own left-open seam (clinical_lead_scope's dimension/value
-- were deliberately unvalidated text, "Stage 4 either starts validating
-- these values... or migrates the column into a proper FK") applied to
-- the episode side of the same shape; clinical_lead_scope's own
-- validation is the next migration.

create or replace function public.set_episode_tags(
  p_episode_id uuid,
  p_tags jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_episode public.episodes_of_care;
  v_caller_role text;
  v_is_first_tagging boolean;
  v_tag jsonb;
  v_count integer := 0;
begin
  select * into v_episode from public.episodes_of_care where id = p_episode_id;
  if not found then
    raise exception 'Episode of care not found.';
  end if;

  if p_tags is null or jsonb_typeof(p_tags) <> 'array' then
    raise exception 'Tags must be provided as an array.';
  end if;

  select s.role into v_caller_role
  from public.institution_staff s
  join public.institutions inst on inst.id = s.institution_id
  where s.institution_id = v_episode.institution_id
    and s.user_id = auth.uid()
    and inst.status = 'verified'
    and inst.type = 'clinic'
    and public.institution_staff_has_current_standing(s.user_id, s.institution_id);

  select not exists (
    select 1 from public.episode_tags where episode_id = p_episode_id
  ) into v_is_first_tagging;

  if v_caller_role is null or not (
    v_caller_role = 'principal'
    or (v_caller_role = 'clinic_admin' and v_is_first_tagging)
  ) then
    raise exception 'Only a clinical director can change an episode''s tags. An admin may only set them once, at onboarding.';
  end if;

  -- Validate the whole set before touching anything.
  for v_tag in select * from jsonb_array_elements(p_tags)
  loop
    if not exists (
      select 1 from public.institution_tags it
      where it.institution_id = v_episode.institution_id
        and it.dimension = v_tag ->> 'dimension'
        and it.value = v_tag ->> 'value'
        and it.is_active
    ) then
      raise exception 'Unknown tag: % = %. Add it to the tag catalog first.', v_tag ->> 'dimension', v_tag ->> 'value';
    end if;
  end loop;

  delete from public.episode_tags where episode_id = p_episode_id;

  for v_tag in select * from jsonb_array_elements(p_tags)
  loop
    insert into public.episode_tags (episode_id, dimension, value, created_by)
    values (p_episode_id, v_tag ->> 'dimension', v_tag ->> 'value', auth.uid());
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.set_episode_tags(uuid, jsonb) to authenticated;
