-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 5 Stage 5, Step 1 -- the request table, and _replace_episode_tags()
-- extracted from set_episode_tags() (0214) so the direct-write path and
-- the request-approval path (next migrations) share one implementation
-- of "validate against the catalog, then replace the set" under two
-- genuinely different authorization checks. Applying this codebase's own
-- "six hand-rolled copies" lesson before the copies exist, not after.
--
-- tag_change_requests -- closest existing shape in this schema is
-- passport_completion_requests/fba_instrument_requests (a standalone
-- "someone is asking something of someone else" table with its own
-- lifecycle), not institution_staff's own join-approval columns (that's
-- about the REQUESTER's own membership, a different kind of thing).
-- proposed_tags is a FULL replacement set, matching set_episode_tags()'s
-- own replace-not-merge semantics exactly -- a request models the same
-- operation a director's direct write already does, not a second
-- mutation model.
--
-- base_tags -- the episode's own tags AS THEY WERE at raise time,
-- snapshotted alongside the proposal. THE RACE THIS EXISTS FOR: the
-- request holds a full replacement set computed against a moment in
-- time; if the episode's real tags change before the request is decided
-- (a director's own direct retag, or a second request approved first),
-- approving this one would silently overwrite that change with a set
-- computed before it existed. Not hypothetical -- a director retagging a
-- client and an admin's pending request are both ordinary. Fixed at
-- approval time (0220) by comparing base_tags to the CURRENT real tags:
-- if they still match, nothing has moved underneath the request and it
-- applies; if they don't, the approval is refused and surfaced, not
-- merged and not silently overwritten -- the same compare-and-swap
-- idiom this schema already uses everywhere else a write can race
-- another write (end_enrolment()'s own `where ended_at is null` guard,
-- redeem_passport_claim_code()'s rate-limit race, and more).
--
-- No client-facing write policy at all -- raise/approve/decline
-- (0219/0220) are the only write paths, matching episodes_of_care's own
-- established convention. Read policy is broad (any active institution
-- staff, matching episode_tags' own posture) -- the request queue isn't
-- sensitive in a new way; the data it names is already visible through
-- episode_tags and the catalog.

create table public.tag_change_requests (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes_of_care (id) on delete cascade,
  requested_by uuid not null references auth.users (id),
  requested_at timestamptz not null default now(),
  base_tags jsonb not null,
  proposed_tags jsonb not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  decline_reason text,
  constraint tag_change_requests_decision_paired check (
    (status = 'pending' and decided_by is null and decided_at is null and decline_reason is null)
    or (status = 'approved' and decided_by is not null and decided_at is not null and decline_reason is null)
    or (status = 'declined' and decided_by is not null and decided_at is not null and decline_reason is not null)
  )
);

create index tag_change_requests_episode_id_idx on public.tag_change_requests (episode_id);
create index tag_change_requests_status_idx on public.tag_change_requests (status);

alter table public.tag_change_requests enable row level security;

create policy "Active institution staff can view tag change requests"
  on public.tag_change_requests for select to authenticated
  using (
    exists (
      select 1 from public.episodes_of_care e
      where e.id = tag_change_requests.episode_id
        and public.institution_staff_has_current_standing(auth.uid(), e.institution_id)
    )
  );

-- Internal only -- no grant to authenticated, matching this schema's own
-- underscore-prefixed-helper convention. Validates every pair against
-- the institution's own catalog before touching anything (a typo
-- refuses cleanly, not partially -- unchanged from set_episode_tags()'s
-- own original behaviour), then replaces the set.
create or replace function public._replace_episode_tags(
  p_episode_id uuid,
  p_institution_id uuid,
  p_tags jsonb,
  p_actor_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tag jsonb;
  v_count integer := 0;
begin
  if p_tags is null or jsonb_typeof(p_tags) <> 'array' then
    raise exception 'Tags must be provided as an array.';
  end if;

  for v_tag in select * from jsonb_array_elements(p_tags)
  loop
    if not exists (
      select 1 from public.institution_tags it
      where it.institution_id = p_institution_id
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
    values (p_episode_id, v_tag ->> 'dimension', v_tag ->> 'value', p_actor_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- set_episode_tags() itself: same signature, same authorization
-- (director always, admin once at onboarding), unchanged by this stage
-- -- Stage 5 is additive, a parallel path for everyone who isn't the
-- director, not a replacement for the direct-write path. Only the
-- validate-and-write body changes, to call the shared helper.
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
begin
  select * into v_episode from public.episodes_of_care where id = p_episode_id;
  if not found then
    raise exception 'Episode of care not found.';
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

  return public._replace_episode_tags(p_episode_id, v_episode.institution_id, p_tags, auth.uid());
end;
$$;

grant execute on function public.set_episode_tags(uuid, jsonb) to authenticated;
