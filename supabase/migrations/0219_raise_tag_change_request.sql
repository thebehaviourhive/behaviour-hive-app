-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 5 Stage 5, Step 2 -- the scoping-touch check, and raising a
-- request. Both scoping helpers are internal only (no grant to
-- authenticated) -- called from the approval RPC (0220), never directly
-- by a client.
--
-- _dimension_is_scoping() -- a DIMENSION is scoping if ANY lead at this
-- clinic has a clinical_lead_scope row on it, clinic-wide, regardless of
-- which lead or which specific value. Daniel's own correction, recorded
-- deliberately: this is not a blunt fallback that happens to be safe --
-- it is the intended answer. In practice, the dimensions leads use to
-- define their own remits (funding, location) are exactly the ones
-- where a change reshuffles the organisation, and those are correctly a
-- director's call; dimensions no lead uses (service, team, until a
-- clinic scopes someone on them) are correctly lead-approvable. A
-- narrower check -- "does the APPROVING lead's own scope reference this
-- specific value" -- would leak: a lead could approve a change to a
-- value they don't personally track that still silently moves a client
-- out of a DIFFERENT lead's scope, or out of their own via a dimension
-- they weren't thinking about. Dimension-level and clinic-wide is what
-- closes that, provably (worked through in recon, not assumed) --
-- because scope-matching itself (_lead_episode_in_scope, 0215) only
-- ever looks at dimensions a lead has rows for, a genuinely non-scoping
-- dimension can never move any client into or out of any lead's own
-- scope by construction. Do not narrow this to "the approving lead's
-- own scope" later -- that is the leak this shape was built to close.
--
-- _tag_change_touches_scoping_dimension() -- "touching a scoping
-- dimension" means a dimension where the request's base_tags and
-- proposed_tags actually DIFFER (added, removed, or changed value) --
-- the symmetric difference between the two sets, not every dimension
-- either set happens to mention. A request that restates an unchanged
-- scoping-dimension value alongside a genuine change elsewhere (an
-- artefact of proposed_tags being a full replacement set, not a diff)
-- must not spuriously require director approval for a dimension nothing
-- actually touched.

create or replace function public._dimension_is_scoping(
  p_institution_id uuid,
  p_dimension text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.clinical_lead_scope cls
    join public.institution_staff s on s.id = cls.institution_staff_id
    where s.institution_id = p_institution_id
      and cls.dimension = p_dimension
  );
$$;

create or replace function public._tag_change_touches_scoping_dimension(
  p_institution_id uuid,
  p_base_tags jsonb,
  p_proposed_tags jsonb
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  with base_pairs as (
    select (t ->> 'dimension') as dimension, (t ->> 'value') as value
    from jsonb_array_elements(p_base_tags) t
  ),
  proposed_pairs as (
    select (t ->> 'dimension') as dimension, (t ->> 'value') as value
    from jsonb_array_elements(p_proposed_tags) t
  ),
  diff as (
    (select dimension, value from base_pairs except select dimension, value from proposed_pairs)
    union
    (select dimension, value from proposed_pairs except select dimension, value from base_pairs)
  )
  select exists (
    select 1 from diff d
    where public._dimension_is_scoping(p_institution_id, d.dimension)
  );
$$;

-- raise_tag_change_request() -- any active clinic staff member, per
-- Daniel's own instruction: raising changes nothing, so the boundary
-- belongs entirely on approval, not on who may ask. A director could
-- raise one too (unusual -- they can just write directly) but nothing
-- refuses it. Refused on an already-ended episode -- PRD section 8's
-- "the old one stays, tagged as it was" leaves nothing to request a
-- change to. Proposed tags validated against the catalog at raise time
-- (the same check _replace_episode_tags() will run again at approval --
-- catching an obvious typo early is worth the redundant check). The
-- snapshot (base_tags) is taken here, from episode_tags as they stand
-- at THIS moment -- see 0218's own header for why it exists.
create or replace function public.raise_tag_change_request(
  p_episode_id uuid,
  p_proposed_tags jsonb,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_episode public.episodes_of_care;
  v_caller_role text;
  v_base_tags jsonb;
  v_tag jsonb;
  v_request_id uuid;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required to request a tag change.';
  end if;

  select * into v_episode from public.episodes_of_care where id = p_episode_id;
  if not found then
    raise exception 'Episode of care not found.';
  end if;

  if v_episode.ended_at is not null then
    raise exception 'This episode of care has already ended.';
  end if;

  select s.role into v_caller_role
  from public.institution_staff s
  join public.institutions inst on inst.id = s.institution_id
  where s.institution_id = v_episode.institution_id
    and s.user_id = auth.uid()
    and inst.status = 'verified'
    and inst.type = 'clinic'
    and public.institution_staff_has_current_standing(s.user_id, s.institution_id);

  if v_caller_role is null then
    raise exception 'Only an active staff member at this clinic can request a tag change.';
  end if;

  if p_proposed_tags is null or jsonb_typeof(p_proposed_tags) <> 'array' then
    raise exception 'Proposed tags must be provided as an array.';
  end if;

  for v_tag in select * from jsonb_array_elements(p_proposed_tags)
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

  select coalesce(jsonb_agg(jsonb_build_object('dimension', dimension, 'value', value)), '[]'::jsonb)
  into v_base_tags
  from public.episode_tags
  where episode_id = p_episode_id;

  insert into public.tag_change_requests (episode_id, requested_by, base_tags, proposed_tags, reason)
  values (p_episode_id, auth.uid(), v_base_tags, p_proposed_tags, trim(p_reason))
  returning id into v_request_id;

  return v_request_id;
end;
$$;

grant execute on function public.raise_tag_change_request(uuid, jsonb, text) to authenticated;
