-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 5 Stage 5, Step 3 -- approving or declining a request, and a
-- minimal list to reach a request_id at all. No queue screen here --
-- PRD section 10 names "the change request queue -- reviewing and
-- approving tag changes" as one of three things that don't exist yet
-- and get designed AFTER this foundation is used, alongside the
-- director's dashboard and tag configuration's own UI. Every prior
-- stage in this build has been backend-only; this one matches.
--
-- THE WRITE, AND WHO IS AUTHORISED FOR IT: approve_tag_change_request()
-- does not call set_episode_tags() as the approver's own session --
-- a lead approving a request has no authority to call that function at
-- all (director-always/admin-once-at-onboarding, unrelated to request
-- approval). It calls _replace_episode_tags() (0218) directly, under
-- its OWN authorization: director always; a clinical_lead only when the
-- request does NOT touch a scoping dimension (0219), the toggle
-- (lead_can_approve_non_scoping_tag_changes, 0207) is on, AND the
-- specific episode is within that lead's own current scope
-- (_lead_episode_in_scope, 0215) -- both halves required, not "any
-- non-scoping request anywhere."
--
-- THE STALENESS CHECK, BEFORE ANYTHING ELSE: base_tags (the snapshot
-- taken when the request was raised, 0219) is compared against the
-- CURRENT real episode_tags, fresh, at the moment of approval -- not
-- assumed unchanged from whenever the request was opened. If they
-- differ, the approval refuses outright and the request stays pending;
-- nothing is merged, nothing is silently overwritten. The only way
-- through is a fresh request raised against current reality, which
-- gets a fresh, correct snapshot of its own. This is deliberately not
-- an override an approver can force through with "I've seen the drift,
-- apply it anyway" -- that would be a second authority path worth its
-- own scrutiny, not a shortcut to add here.
--
-- Same "compare-and-swap on the pending status" atomicity as end_
-- enrolment()/end_clinic_episode() -- an early friendly check, then the
-- actual UPDATE's own `where status = 'pending'` as the real guard
-- against two concurrent decisions on the same request.
--
-- decline_tag_change_request() shares the identical authorization gate
-- with approve -- whoever could approve can also decline, matching
-- approve_staff_join()/reject_staff_join()'s own symmetric shape. No
-- staleness check needed for decline -- nothing writes to episode_tags
-- either way.

create or replace function public.approve_tag_change_request(
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.tag_change_requests;
  v_episode public.episodes_of_care;
  v_caller_staff_id uuid;
  v_caller_role text;
  v_tags_unchanged boolean;
  v_touches_scoping boolean;
begin
  select * into v_request from public.tag_change_requests where id = p_request_id;
  if not found then
    raise exception 'Tag change request not found.';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request has already been decided.';
  end if;

  select * into v_episode from public.episodes_of_care where id = v_request.episode_id;

  with current_pairs as (
    select dimension, value from public.episode_tags where episode_id = v_request.episode_id
  ),
  snapshot_pairs as (
    select (t ->> 'dimension') as dimension, (t ->> 'value') as value
    from jsonb_array_elements(v_request.base_tags) t
  ),
  diff as (
    (select dimension, value from current_pairs except select dimension, value from snapshot_pairs)
    union
    (select dimension, value from snapshot_pairs except select dimension, value from current_pairs)
  )
  select not exists (select 1 from diff) into v_tags_unchanged;

  if not v_tags_unchanged then
    raise exception 'This client''s tags have changed since this request was raised. Review the current tags before deciding.';
  end if;

  select s.id, s.role into v_caller_staff_id, v_caller_role
  from public.institution_staff s
  join public.institutions inst on inst.id = s.institution_id
  where s.institution_id = v_episode.institution_id
    and s.user_id = auth.uid()
    and inst.status = 'verified'
    and inst.type = 'clinic'
    and public.institution_staff_has_current_standing(s.user_id, s.institution_id);

  v_touches_scoping := public._tag_change_touches_scoping_dimension(
    v_episode.institution_id, v_request.base_tags, v_request.proposed_tags
  );

  if v_caller_role is null or not (
    v_caller_role = 'principal'
    or (
      v_caller_role = 'clinical_lead'
      and not v_touches_scoping
      and exists (
        select 1 from public.institutions inst
        where inst.id = v_episode.institution_id
          and inst.lead_can_approve_non_scoping_tag_changes
      )
      and public._lead_episode_in_scope(v_caller_staff_id, v_episode.id)
    )
  ) then
    raise exception 'Only a clinical director, or (where enabled) a lead approving within their own scope for a non-scoping change, can approve this request.';
  end if;

  perform public._replace_episode_tags(v_episode.id, v_episode.institution_id, v_request.proposed_tags, auth.uid());

  update public.tag_change_requests
  set status = 'approved', decided_by = auth.uid(), decided_at = now()
  where id = p_request_id
    and status = 'pending';

  if not found then
    raise exception 'This request has already been decided.';
  end if;
end;
$$;

grant execute on function public.approve_tag_change_request(uuid) to authenticated;

create or replace function public.decline_tag_change_request(
  p_request_id uuid,
  p_decline_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.tag_change_requests;
  v_episode public.episodes_of_care;
  v_caller_staff_id uuid;
  v_caller_role text;
  v_touches_scoping boolean;
begin
  if p_decline_reason is null or trim(p_decline_reason) = '' then
    raise exception 'A reason is required to decline a tag change request.';
  end if;

  select * into v_request from public.tag_change_requests where id = p_request_id;
  if not found then
    raise exception 'Tag change request not found.';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request has already been decided.';
  end if;

  select * into v_episode from public.episodes_of_care where id = v_request.episode_id;

  select s.id, s.role into v_caller_staff_id, v_caller_role
  from public.institution_staff s
  join public.institutions inst on inst.id = s.institution_id
  where s.institution_id = v_episode.institution_id
    and s.user_id = auth.uid()
    and inst.status = 'verified'
    and inst.type = 'clinic'
    and public.institution_staff_has_current_standing(s.user_id, s.institution_id);

  v_touches_scoping := public._tag_change_touches_scoping_dimension(
    v_episode.institution_id, v_request.base_tags, v_request.proposed_tags
  );

  if v_caller_role is null or not (
    v_caller_role = 'principal'
    or (
      v_caller_role = 'clinical_lead'
      and not v_touches_scoping
      and exists (
        select 1 from public.institutions inst
        where inst.id = v_episode.institution_id
          and inst.lead_can_approve_non_scoping_tag_changes
      )
      and public._lead_episode_in_scope(v_caller_staff_id, v_episode.id)
    )
  ) then
    raise exception 'Only a clinical director, or (where enabled) a lead approving within their own scope for a non-scoping change, can decide this request.';
  end if;

  update public.tag_change_requests
  set status = 'declined', decided_by = auth.uid(), decided_at = now(), decline_reason = trim(p_decline_reason)
  where id = p_request_id
    and status = 'pending';

  if not found then
    raise exception 'This request has already been decided.';
  end if;
end;
$$;

grant execute on function public.decline_tag_change_request(uuid, text) to authenticated;

-- Minimal, role-agnostic list -- infrastructure to reach a request_id
-- at all, mirroring get_institution_episode_roster()'s own shape (0211)
-- exactly. Not the queue screen.
create or replace function public.get_pending_tag_change_requests(p_institution_id uuid)
returns table (
  request_id uuid,
  episode_id uuid,
  passport_id uuid,
  child_name text,
  requested_by uuid,
  requested_at timestamptz,
  base_tags jsonb,
  proposed_tags jsonb,
  reason text
)
language sql
security definer
set search_path = public
stable
as $$
  select r.id as request_id, r.episode_id, e.passport_id, p.child_name,
    r.requested_by, r.requested_at, r.base_tags, r.proposed_tags, r.reason
  from public.tag_change_requests r
  join public.episodes_of_care e on e.id = r.episode_id
  join public.passports p on p.id = e.passport_id
  where e.institution_id = p_institution_id
    and r.status = 'pending'
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and s.approved_at is not null
        and s.deactivated_at is null
    )
  order by r.requested_at asc;
$$;

grant execute on function public.get_pending_tag_change_requests(uuid) to authenticated;
