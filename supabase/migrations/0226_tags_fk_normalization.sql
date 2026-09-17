-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 5 Stage 7, Step 0 -- fixing a real Stage 4 gap BEFORE building the
-- dashboard on top of it, per Daniel's own instruction: do it now, while
-- there is no drift to migrate, not after a catalog UI ships and this
-- becomes a live migration of real clinical data and real authority
-- grants. institution_tags already carries a stable id (its own PK,
-- 0213) -- it was never missing one. The actual defect is that
-- episode_tags and clinical_lead_scope both COPY (dimension, value) as
-- plain text instead of referencing that id, so a rename (or a
-- retire-and-recreate, since no rename UI exists either) orphans every
-- existing tag and every lead's scope pointing at the old string, with
-- nothing anywhere to notice. 0207's own header, written at Stage 2,
-- already named this as the eventual fix: "Stage 4 either starts
-- validating these values against real configured dimensions, or
-- migrates the column into a proper FK -- no reshaping of what this
-- stage built either way." This is that migration, done at Stage 7
-- instead, for the same reason -- cheapest now, with an empty-ish table
-- and no production clinic.
--
-- Scope, checked directly before writing anything: zero client code
-- anywhere touches institution_tags, episode_tags, or clinical_lead_
-- scope (grep -rln across src/ returns nothing for all three) -- PRD 5
-- has been backend-only through Stage 6, so this migration changes the
-- shape freely with no UI contract to preserve. tag_change_requests'
-- own base_tags/proposed_tags stay exactly as they are -- jsonb
-- (dimension, value) TEXT snapshots, deliberately: a request is a
-- historical record of what was asked in human terms, and it should
-- keep reading the same even if the catalog is renamed later. Only the
-- LIVE tables (episode_tags, clinical_lead_scope) move to the FK; the
-- snapshot table does not.
--
-- WHAT THE FK REMOVES FROM 0213's OWN VALIDATION, AND WHAT IT DOES NOT --
-- Daniel's own question, answered precisely rather than by feel. Every
-- write path that touches these two tables currently runs an explicit
-- `exists (select 1 from institution_tags where dimension = ... and
-- value = ... and is_active)` before inserting raw text. Once episode_
-- tags.institution_tag_id and clinical_lead_scope.institution_tag_id are
-- real foreign keys, the EXISTENCE half of that check becomes
-- structurally impossible to violate -- there is no longer any way to
-- store a (dimension, value) pair that isn't a real institution_tags
-- row, because there is no (dimension, value) pair stored at all
-- anymore, only an id the database itself guarantees resolves to one.
-- That half is REMOVED, not duplicated -- nothing below re-checks
-- existence after this migration, because there is nothing left for a
-- function-level check to catch that the FK wouldn't already have
-- refused. What the FK CANNOT express, and what stays as an explicit
-- check in every function below: `is_active` (a deactivated catalog row
-- still satisfies a foreign key -- FKs can't target a conditional
-- subset of rows), and same-institution (a foreign key only proves the
-- target row exists SOMEWHERE, not that it belongs to the institution
-- doing the tagging or scoping). Both of those were always genuinely
-- business logic, not existence-checking, and remain exactly that.
--
-- _lead_episode_in_scope() -- THE SEMANTICS THAT MUST NOT MOVE. Stage
-- 4's own two decided rules: AND across a lead's own DISTINCT
-- DIMENSIONS, OR within any one dimension's multiple values. The naive
-- version of this migration -- group by institution_tag_id instead of
-- dimension -- would silently break rule 2: a lead scoped to
-- (funding=Tusla) AND (funding=HSE) has count(distinct institution_tag_
-- id) = 2, not 1, which would turn the OR-within-a-dimension case into
-- a second AND requirement nobody decided. The fix keeps grouping by
-- DIMENSION NAME throughout (recovered via a join to institution_tags,
-- since it's no longer a column on clinical_lead_scope itself) while
-- letting the actual per-row MATCH TEST become a plain institution_tag_
-- id equality -- simpler than the old compound (dimension = dimension
-- and value = value) equi-join, and incidentally exact in a way text
-- comparison never fully was (no case/whitespace drift possible).
-- Worked through with concrete cases before writing it, not assumed:
-- a lead scoped to (funding=Tusla OR HSE) AND (location=Dublin), tested
-- against an episode tagged (funding=HSE, location=Dublin) -- matched_
-- dims picks up BOTH dimensions via the OR on funding, count equals
-- lead_dims' count of 2, in scope. Tested again with the SAME episode
-- missing its location tag -- matched_dims only has funding, count 1
-- vs lead_dims' 2, correctly out of scope. Identical outcomes to the
-- pre-FK function, confirmed by hand before touching the SQL.

-- ===========================================================================
-- 1. episode_tags: add, backfill, verify, tighten, drop the old columns.
-- ===========================================================================

alter table public.episode_tags
  add column if not exists institution_tag_id uuid references public.institution_tags (id) on delete restrict;

update public.episode_tags et
set institution_tag_id = it.id
from public.episodes_of_care e, public.institution_tags it
where et.episode_id = e.id
  and it.institution_id = e.institution_id
  and it.dimension = et.dimension
  and it.value = et.value
  and et.institution_tag_id is null;

do $$
declare
  v_orphans integer;
begin
  select count(*) into v_orphans from public.episode_tags where institution_tag_id is null;
  if v_orphans > 0 then
    raise exception 'episode_tags: % row(s) could not be backfilled -- their (dimension, value) does not match any active institution_tags row. Resolve manually before re-running this migration.', v_orphans;
  end if;
end $$;

alter table public.episode_tags
  alter column institution_tag_id set not null;

alter table public.episode_tags
  drop constraint if exists episode_tags_episode_id_dimension_value_key;

alter table public.episode_tags
  add constraint episode_tags_episode_id_institution_tag_id_key unique (episode_id, institution_tag_id);

drop index if exists public.episode_tags_dimension_value_idx;
create index episode_tags_institution_tag_id_idx on public.episode_tags (institution_tag_id);

-- dimension/value are NOT dropped here -- episode_tags has no RLS
-- policy referencing them (its own SELECT policy only checks episode
-- ownership), but clinical_lead_scope's WRITE policy (below) DOES
-- reference its own dimension/value directly in its WITH CHECK clause,
-- and Postgres refuses to drop a column a live policy expression still
-- depends on. Both tables' old columns are dropped together, in one
-- place, at the very end of this migration -- after every function and
-- policy that could reference them has already been repointed at
-- institution_tag_id. Getting this ordering wrong was the first draft
-- of this migration's own mistake, caught before running it.

-- ===========================================================================
-- 2. clinical_lead_scope: same shape.
-- ===========================================================================

alter table public.clinical_lead_scope
  add column if not exists institution_tag_id uuid references public.institution_tags (id) on delete restrict;

update public.clinical_lead_scope cls
set institution_tag_id = it.id
from public.institution_staff s, public.institution_tags it
where cls.institution_staff_id = s.id
  and it.institution_id = s.institution_id
  and it.dimension = cls.dimension
  and it.value = cls.value
  and cls.institution_tag_id is null;

do $$
declare
  v_orphans integer;
begin
  select count(*) into v_orphans from public.clinical_lead_scope where institution_tag_id is null;
  if v_orphans > 0 then
    raise exception 'clinical_lead_scope: % row(s) could not be backfilled -- their (dimension, value) does not match any active institution_tags row. Resolve manually before re-running this migration.', v_orphans;
  end if;
end $$;

alter table public.clinical_lead_scope
  alter column institution_tag_id set not null;

alter table public.clinical_lead_scope
  drop constraint if exists clinical_lead_scope_institution_staff_id_dimension_value_key;

alter table public.clinical_lead_scope
  add constraint clinical_lead_scope_institution_staff_id_institution_tag_id_key unique (institution_staff_id, institution_tag_id);

-- dimension/value stay on both tables until the very end of this
-- migration -- see the comment on episode_tags' own equivalent step
-- above for why.

-- ===========================================================================
-- 3. _replace_episode_tags() -- resolve (dimension, value) -> id, THEN
--    write. Same validate-the-whole-set-first-then-write shape as
--    before (one lookup per tag, not two) -- an unresolvable pair now
--    means "no id to store", which is the validation, not a separate
--    check bolted in front of it.
-- ===========================================================================

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
  v_tag_id uuid;
  v_tag_ids uuid[] := '{}';
  v_count integer := 0;
begin
  if p_tags is null or jsonb_typeof(p_tags) <> 'array' then
    raise exception 'Tags must be provided as an array.';
  end if;

  for v_tag in select * from jsonb_array_elements(p_tags)
  loop
    select id into v_tag_id
    from public.institution_tags
    where institution_id = p_institution_id
      and dimension = v_tag ->> 'dimension'
      and value = v_tag ->> 'value'
      and is_active;

    if v_tag_id is null then
      raise exception 'Unknown tag: % = %. Add it to the tag catalog first.', v_tag ->> 'dimension', v_tag ->> 'value';
    end if;

    v_tag_ids := v_tag_ids || v_tag_id;
  end loop;

  delete from public.episode_tags where episode_id = p_episode_id;

  foreach v_tag_id in array v_tag_ids
  loop
    insert into public.episode_tags (episode_id, institution_tag_id, created_by)
    values (p_episode_id, v_tag_id, p_actor_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- set_episode_tags() itself is untouched -- same signature, same body,
-- it only ever calls _replace_episode_tags() and never references
-- dimension/value directly (confirmed by reading its live 0218 body).

-- ===========================================================================
-- 4. raise_tag_change_request()'s own base_tags snapshot query -- was a
--    direct read of episode_tags.dimension/value, now a join through
--    institution_tags to recover the same text shape. The snapshot's
--    OWN stored shape (jsonb [{dimension, value}]) is unchanged --
--    only how it's built changes. Everything else in this function
--    (the proposed_tags validation loop, the reason/episode checks) is
--    untouched, since it never referenced episode_tags' own columns.
-- ===========================================================================

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

  select coalesce(jsonb_agg(jsonb_build_object('dimension', it.dimension, 'value', it.value)), '[]'::jsonb)
  into v_base_tags
  from public.episode_tags et
  join public.institution_tags it on it.id = et.institution_tag_id
  where et.episode_id = p_episode_id;

  insert into public.tag_change_requests (episode_id, requested_by, base_tags, proposed_tags, reason)
  values (p_episode_id, auth.uid(), v_base_tags, p_proposed_tags, trim(p_reason))
  returning id into v_request_id;

  return v_request_id;
end;
$$;

grant execute on function public.raise_tag_change_request(uuid, jsonb, text) to authenticated;

-- ===========================================================================
-- 5. approve_tag_change_request()'s own staleness check -- was a direct
--    read of episode_tags.dimension/value as current_pairs, now the
--    same join-through-institution_tags shape as above. The compare-
--    and-swap logic itself (diff against the snapshot, refuse on any
--    difference) is byte-for-byte unchanged; only where current_pairs
--    comes from changes. Everything else in this function (authorization,
--    the actual write via _replace_episode_tags(), the status update)
--    is untouched.
-- ===========================================================================

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
    select it.dimension, it.value
    from public.episode_tags et
    join public.institution_tags it on it.id = et.institution_tag_id
    where et.episode_id = v_request.episode_id
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

-- decline_tag_change_request() is untouched -- it never reads
-- episode_tags at all (no staleness check needed, per its own 0220
-- header: "nothing writes to episode_tags either way").

-- ===========================================================================
-- 6. _dimension_is_scoping() -- was a direct read of clinical_lead_
--    scope.dimension, now resolved via a join to institution_tags.
--    Same signature, same SQL shape otherwise.
-- ===========================================================================

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
    join public.institution_tags it on it.id = cls.institution_tag_id
    where s.institution_id = p_institution_id
      and it.dimension = p_dimension
  );
$$;

-- _tag_change_touches_scoping_dimension() is untouched -- it operates
-- purely on the jsonb (dimension, value) TEXT pairs already snapshotted
-- in tag_change_requests, and only calls _dimension_is_scoping() as a
-- black box (unchanged signature). Confirmed by reading its live 0219
-- body -- it never references clinical_lead_scope or episode_tags
-- directly.

-- ===========================================================================
-- 7. clinical_lead_scope's own RLS: _can_manage_clinical_lead_scope()'s
--    SIGNATURE changes (p_dimension text, p_value text -> a single
--    p_institution_tag_id uuid). THIS SECTION WAS WRONG TWICE BEFORE IT
--    WAS RIGHT, both times caught before running the migration a third
--    time, and both mistakes are worth keeping on the record rather
--    than silently smoothed over:
--
--    MISTAKE 1 (caught live, by Supabase itself): DROP FUNCTION IF
--    EXISTS on the old 3-arg overload BEFORE repointing the policy
--    that still called it. Refused outright -- 2BP01, "cannot drop
--    function... because other objects depend on it". A function
--    referenced by a live RLS policy is a real, tracked dependency,
--    the same as a view depending on a table.
--
--    MISTAKE 2 (caught reviewing the fix for mistake 1, before running
--    it): the obvious-looking correction -- create the new (uuid, uuid
--    default null) overload FIRST, repoint the policy to it, THEN drop
--    the old (uuid, text default null, text default null) overload --
--    would have let BOTH overloads exist simultaneously for the
--    duration of the ALTER POLICY statement. Both old and new
--    signatures accept a call with exactly ONE uuid argument (every
--    parameter after the first has a default in both), and both have
--    an IDENTICAL first parameter type. The policy's own USING clause
--    makes exactly that one-argument call
--    (_can_manage_clinical_lead_scope(institution_staff_id)) -- which
--    Postgres cannot resolve between two equally-valid candidates,
--    and would refuse as "not unique", the exact failure mode this
--    file's own send_message() gotcha already documents for a
--    differently-shaped version of the same trap (a shorter call
--    matching more than one overload once defaults are applied).
--
--    THE ACTUAL FIX: never let both overloads exist while the policy
--    is live. Drop the POLICY itself first (removing the dependency
--    entirely, not just repointing it), then drop the old function,
--    then create the new one, then create the policy fresh. At no
--    point during this migration do two overloads of this function
--    coexist. _staff_can_view_lead_scope() is untouched throughout --
--    it never referenced dimension/value at all, only institution_
--    staff_id, so its own read policy needs none of this.
-- ===========================================================================

drop policy "Institution admins can manage clinical lead scope at their own institution"
  on public.clinical_lead_scope;

drop function if exists public._can_manage_clinical_lead_scope(uuid, text, text);

create function public._can_manage_clinical_lead_scope(
  p_institution_staff_id uuid,
  p_institution_tag_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_institution_id uuid;
begin
  select institution_id into v_institution_id
  from public.institution_staff
  where id = p_institution_staff_id;

  if v_institution_id is null then
    return false;
  end if;

  if not exists (
    select 1 from public.institution_staff director
    where director.institution_id = v_institution_id
      and director.user_id = auth.uid()
      and director.role = 'principal'
      and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
  ) then
    return false;
  end if;

  -- The FK on clinical_lead_scope.institution_tag_id already guarantees
  -- p_institution_tag_id (when provided) resolves to SOME real
  -- institution_tags row -- existence is no longer this function's job.
  -- is_active and same-institution are NOT expressible by a foreign key
  -- (a deactivated catalog row still satisfies referential integrity,
  -- and a FK proves the target exists, not that it belongs to THIS
  -- institution), so both stay explicit checks here.
  if p_institution_tag_id is not null and not exists (
    select 1 from public.institution_tags it
    where it.id = p_institution_tag_id
      and it.institution_id = v_institution_id
      and it.is_active
  ) then
    return false;
  end if;

  return true;
end;
$$;

-- Recreated fresh, not "alter policy" -- the policy was dropped above,
-- so there is nothing left to alter. Same name, same table, same "for
-- all to authenticated" shape as the original (0207), confirmed by
-- reading that migration's own create policy statement directly rather
-- than assumed -- only the USING/WITH CHECK bodies change here.
create policy "Institution admins can manage clinical lead scope at their own institution"
  on public.clinical_lead_scope
  for all
  to authenticated
  using (
    public._can_manage_clinical_lead_scope(clinical_lead_scope.institution_staff_id)
  )
  with check (
    public._can_manage_clinical_lead_scope(
      clinical_lead_scope.institution_staff_id,
      clinical_lead_scope.institution_tag_id
    )
  );

-- ===========================================================================
-- 8. _lead_episode_in_scope() -- THE SEMANTICS-PRESERVING REWRITE. See
--    this migration's own header for the worked examples proving the
--    AND-across-dimensions / OR-within-a-dimension rules survive
--    unchanged. Grouping stays on DIMENSION NAME (recovered via a join
--    to institution_tags on each side), never on institution_tag_id
--    itself -- that distinction is the entire point.
-- ===========================================================================

create or replace function public._lead_episode_in_scope(
  p_institution_staff_id uuid,
  p_episode_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  with lead_dims as (
    select distinct it.dimension
    from public.clinical_lead_scope cls
    join public.institution_tags it on it.id = cls.institution_tag_id
    where cls.institution_staff_id = p_institution_staff_id
  ),
  matched_dims as (
    select distinct it.dimension
    from public.clinical_lead_scope cls
    join public.institution_tags it on it.id = cls.institution_tag_id
    join public.episode_tags et
      on et.institution_tag_id = cls.institution_tag_id
    where cls.institution_staff_id = p_institution_staff_id
      and et.episode_id = p_episode_id
  )
  select
    (select count(*) from lead_dims) > 0
    and (select count(*) from lead_dims) = (select count(*) from matched_dims);
$$;

-- ===========================================================================
-- 9. NOW drop the old text columns from both tables -- every function
--    and the clinical_lead_scope policy above have already been
--    repointed at institution_tag_id, so nothing depends on dimension/
--    value any more. This has to be last: clinical_lead_scope's own
--    write policy (step 7, above) referenced .dimension/.value directly
--    in its WITH CHECK clause until just now, and Postgres refuses to
--    drop a column a live policy expression still depends on.
-- ===========================================================================

alter table public.episode_tags
  drop column dimension,
  drop column value;

alter table public.clinical_lead_scope
  drop column dimension,
  drop column value;
