-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- STAFF LIFECYCLE, STAGE 1. institution_staff gains a real membership
-- state -- deactivated_at/by/reason, append-only, deactivation only,
-- never a delete (no DELETE policy exists and none is added here).
-- Reactivation is a new row: the partial unique index below is what
-- makes that safe, not an application convention.
--
-- SCOPE: institution_staff itself, and every call site that reads it.
-- Explicitly NOT touched: classes, assignment, enrolment, nullable
-- passports.user_id, the claim mechanism, clinician_access. One
-- exception, decided explicitly, not a scope creep: on deactivation,
-- this also closes the person's existing passport_access grants at
-- this institution -- narrow, no new concept, no reassignment -- see
-- the header note on deactivate_institution_staff() below for why.
--
-- CORRECTION FROM THE FIRST DRAFT: that draft included an ALTER POLICY
-- on "School staff can create an incident for their institution" --
-- this policy was dropped in migration 0069 ("all creation now goes
-- through create_incident_stamp()"), confirmed live by the SQL editor
-- itself refusing it (42704, policy does not exist). Removed here. No
-- gap results: the real gate for incident creation is, and always was
-- after 0069, the institution_staff check inside create_incident_stamp()
-- itself, which item 8 below already fixes.

-- =====================================================================
-- 1. institution_staff -- the lifecycle columns.
-- =====================================================================

alter table public.institution_staff
  add column deactivated_at timestamptz,
  add column deactivated_by uuid references auth.users (id),
  add column deactivation_reason text;

alter table public.institution_staff
  add constraint institution_staff_deactivation_paired_check
  check (
    (deactivated_at is null) = (deactivated_by is null)
    and (deactivated_at is null) = (deactivation_reason is null)
  );

-- Fix the day-one bug: a deactivated principal's row must stop
-- occupying the one-principal-per-institution slot, or no replacement
-- principal can ever self-link and the app's own friendly error
-- ("This school already has a principal registered") becomes false.
drop index if exists institution_staff_one_principal_per_institution;
create unique index institution_staff_one_principal_per_institution
  on public.institution_staff (institution_id)
  where role = 'principal' and deactivated_at is null;

-- New: at most one ACTIVE row per person per institution. This is what
-- makes reactivation-as-a-new-row safe (the old row is excluded from
-- this index, so the new INSERT doesn't collide with it) and what
-- makes create_incident_stamp()'s "select role into" deterministic by
-- construction -- at most one row can ever match institution_id + user_id
-- + deactivated_at is null, so no ORDER BY/LIMIT tie-break is needed.
-- Deliberately scoped to one institution, not globally one-row-per-user
-- -- whether a person can be active staff at two institutions at once
-- is a separate question this migration doesn't decide either way.
create unique index institution_staff_one_active_per_institution
  on public.institution_staff (institution_id, user_id)
  where deactivated_at is null;


-- =====================================================================
-- 2. deactivate_institution_staff() -- the only write path for the new
-- columns. Only an active principal at the SAME institution; never
-- self; never the last active principal.
--
-- THE CASCADE, AND WHY IT'S HERE: Step 0's recon found that closing
-- institution_staff access alone leaves every passport_access grant
-- this person holds fully live -- none of those read policies re-check
-- institution_staff, only passport_access.is_active. A deactivated
-- teacher would keep real access to every individually-assigned
-- child's passport, ABC logs, messages, indefinitely. Approved as
-- in-scope: narrow and assignment-agnostic -- flips is_active = false
-- on this person's existing grants at this institution, nothing else.
-- Fully reversible through the EXISTING reactivate-access policy
-- (0025/0065), which already re-proves active institution_staff
-- membership, so rejoining and re-linking needs no new mechanism.
--
-- Recorded via activity_log's existing 'access_revoked' event type --
-- the same one the parent's own revoke flow already writes to (0038,
-- src/app/passport/dashboard/page.tsx:548-553) -- one row per affected
-- child, naming the departed person explicitly (not just the
-- principal acting), so a parent or clinician reading that child's
-- history knows whose access ended, not just that the principal did
-- something. Confirmed via RecentUpdatesCard.tsx (per-passport_id,
-- limit 3, no cross-child aggregation): a 30-grant deactivation writes
-- one row each to 30 different children's own histories, never 30
-- rows on one child's feed.
-- =====================================================================

create or replace function public.deactivate_institution_staff(
  p_institution_staff_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.institution_staff;
  v_target_name text;
  v_caller_is_active_principal boolean;
  v_grants_revoked integer := 0;
  v_grant record;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required to deactivate a staff member.';
  end if;

  select * into v_target
  from public.institution_staff
  where id = p_institution_staff_id;

  if not found then
    raise exception 'Staff member not found.';
  end if;

  if v_target.deactivated_at is not null then
    raise exception 'This staff member is already deactivated.';
  end if;

  select exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.user_id = auth.uid()
      and s.institution_id = v_target.institution_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and inst.status = 'verified'
  ) into v_caller_is_active_principal;

  if not v_caller_is_active_principal then
    raise exception 'Only an active principal at this institution can deactivate staff here.';
  end if;

  if v_target.user_id = auth.uid() then
    raise exception 'You cannot deactivate your own staff membership.';
  end if;

  if v_target.role = 'principal' and not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = v_target.institution_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.id <> v_target.id
      and inst.status = 'verified'
  ) then
    raise exception 'Cannot deactivate the last active principal at this institution.';
  end if;

  update public.institution_staff
  set deactivated_at = now(),
      deactivated_by = auth.uid(),
      deactivation_reason = p_reason
  where id = p_institution_staff_id;

  select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name')
  into v_target_name
  from auth.users u
  where u.id = v_target.user_id;

  for v_grant in
    select id, passport_id
    from public.passport_access
    where teacher_id = v_target.user_id
      and institution_id = v_target.institution_id
      and is_active = true
  loop
    update public.passport_access set is_active = false where id = v_grant.id;

    insert into public.activity_log (passport_id, actor_id, event_type, event_description)
    values (
      v_grant.passport_id,
      auth.uid(),
      'access_revoked',
      'Access removed for ' || coalesce(v_target_name, 'a staff member') || ' (staff member deactivated)'
    );

    v_grants_revoked := v_grants_revoked + 1;
  end loop;

  return jsonb_build_object('deactivated', true, 'grants_revoked', v_grants_revoked);
end;
$$;

grant execute on function public.deactivate_institution_staff(uuid, text) to authenticated;


-- =====================================================================
-- 3. can_countersign_incident() -- both branches. The grant branch now
-- also requires the grantee's OWN institution_staff row to be active,
-- not just the grant's revoked_at -- per 0078's own forward-dependency
-- note: "the day it gains one, BOTH can_countersign_incident() and
-- guard_institution_permissions_grantee_is_staff() must be updated."
-- This is the single choke point for the countersign feature -- fixing
-- it here also fixes can_view_incident()'s principal branch,
-- get_institution_incidents(), both school_notices policies, and the
-- amendment insert policy, all of which route through this function.
-- =====================================================================

create or replace function public.can_countersign_incident(p_user_id uuid, p_institution_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = p_user_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and inst.status = 'verified'
  )
  or exists (
    select 1 from public.institution_permissions p
    join public.institutions inst on inst.id = p.institution_id
    join public.institution_staff s
      on s.institution_id = p.institution_id and s.user_id = p.user_id
    where p.institution_id = p_institution_id
      and p.user_id = p_user_id
      and p.permission = 'countersign_incident'
      and p.revoked_at is null
      and s.deactivated_at is null
      and inst.status = 'verified'
  );
$$;


-- =====================================================================
-- 4. guard_institution_permissions_grantee_is_staff() -- grantee must
-- be ACTIVE staff, not just have a row.
-- =====================================================================

create or replace function public.guard_institution_permissions_grantee_is_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.institution_staff s
    where s.institution_id = new.institution_id
      and s.user_id = new.user_id
      and s.deactivated_at is null
  ) then
    raise exception 'Cannot grant % -- user % is not an active member of institution_staff at institution %.',
      new.permission, new.user_id, new.institution_id;
  end if;
  return new;
end;
$$;


-- =====================================================================
-- 5. guard_institution_permissions_last_holder() -- a deactivated
-- principal no longer counts as a backstop.
-- =====================================================================

create or replace function public.guard_institution_permissions_last_holder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.revoked_at is not null and old.revoked_at is null and new.permission = 'countersign_incident' then
    if not exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = new.institution_id
        and s.role = 'principal'
        and s.deactivated_at is null
        and inst.status = 'verified'
    ) and not exists (
      select 1 from public.institution_permissions p2
      join public.institution_staff s2
        on s2.institution_id = p2.institution_id and s2.user_id = p2.user_id
      where p2.institution_id = new.institution_id
        and p2.permission = 'countersign_incident'
        and p2.revoked_at is null
        and p2.id <> new.id
        and s2.deactivated_at is null
    ) then
      raise exception 'Cannot revoke -- this is the last active countersign holder at institution %. This institution has no principal; revoking this grant would leave nobody able to countersign.',
        new.institution_id;
    end if;
  end if;
  return new;
end;
$$;


-- =====================================================================
-- 6. Vocabulary tables -- 8 identical policies, one per table, read
-- access requires active membership.
-- =====================================================================

alter policy "Vocabulary is readable by global default or own institution"
  on public.incident_action_types
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = incident_action_types.institution_id
      and s.user_id = auth.uid() and s.deactivated_at is null
  ));

alter policy "Vocabulary is readable by global default or own institution"
  on public.incident_recovery_types
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = incident_recovery_types.institution_id
      and s.user_id = auth.uid() and s.deactivated_at is null
  ));

alter policy "Vocabulary is readable by global default or own institution"
  on public.cpi_reason_types
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = cpi_reason_types.institution_id
      and s.user_id = auth.uid() and s.deactivated_at is null
  ));

alter policy "Vocabulary is readable by global default or own institution"
  on public.cpi_disengagement_types
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = cpi_disengagement_types.institution_id
      and s.user_id = auth.uid() and s.deactivated_at is null
  ));

alter policy "Vocabulary is readable by global default or own institution"
  on public.cpi_result_types
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = cpi_result_types.institution_id
      and s.user_id = auth.uid() and s.deactivated_at is null
  ));

alter policy "Vocabulary is readable by global default or own institution"
  on public.incident_injury_types
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = incident_injury_types.institution_id
      and s.user_id = auth.uid() and s.deactivated_at is null
  ));

alter policy "Vocabulary is readable by global default or own institution"
  on public.incident_locations
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = incident_locations.institution_id
      and s.user_id = auth.uid() and s.deactivated_at is null
  ));

alter policy "Vocabulary is readable by global default or own institution"
  on public.incident_body_regions
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = incident_body_regions.institution_id
      and s.user_id = auth.uid() and s.deactivated_at is null
  ));


-- =====================================================================
-- 7. Location editing -- principal, active.
-- =====================================================================

alter policy "Principals can add locations for their own institution"
  on public.incident_locations
  with check (
    institution_id is not null
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = incident_locations.institution_id
        and s.user_id = auth.uid() and s.role = 'principal'
        and s.deactivated_at is null
    )
  );

alter policy "Principals can edit locations for their own institution"
  on public.incident_locations
  using (
    institution_id is not null
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = incident_locations.institution_id
        and s.user_id = auth.uid() and s.role = 'principal'
        and s.deactivated_at is null
    )
  )
  with check (
    institution_id is not null
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = incident_locations.institution_id
        and s.user_id = auth.uid() and s.role = 'principal'
        and s.deactivated_at is null
    )
  );


-- =====================================================================
-- 8. create_incident_stamp() -- full body, verbatim from 0069, one
-- changed line. This is the actual gate on incident creation -- the
-- direct-INSERT policy on incidents was dropped in 0069, all creation
-- goes through this RPC (see the correction note at the top of this
-- file).
-- =====================================================================

create or replace function public.create_incident_stamp(
  p_institution_id uuid,
  p_occurred_at timestamptz,
  p_location_id uuid,
  p_child_passport_ids uuid[],
  p_staff jsonb  -- array of {"user_id": uuid} or {"free_text_name": text}, optional "involvement" (defaults 'involved')
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_incident_id uuid;
  v_child_count integer;
  v_child_index text;
  v_passport_id uuid;
  v_i integer;
  v_staff_entry jsonb;
  v_user_id uuid;
  v_free_text_name text;
  v_involvement text;
begin
  select role into v_caller_role
  from public.institution_staff
  where institution_id = p_institution_id
    and user_id = auth.uid()
    and deactivated_at is null;

  if v_caller_role is null or v_caller_role not in ('class_teacher', 'sna', 'principal') then
    raise exception 'You are not registered as school staff at this institution.';
  end if;

  if p_child_passport_ids is null or array_length(p_child_passport_ids, 1) is null or array_length(p_child_passport_ids, 1) = 0 then
    raise exception 'At least one child is required.';
  end if;
  v_child_count := array_length(p_child_passport_ids, 1);
  if v_child_count > 2 then
    raise exception 'An incident can name at most two children.';
  end if;

  v_incident_id := gen_random_uuid();

  insert into public.incidents (id, institution_id, created_by, owning_teacher_id, occurred_at, location_id)
  values (
    v_incident_id, p_institution_id, auth.uid(),
    case when v_caller_role = 'class_teacher' then auth.uid() else null end,
    p_occurred_at, p_location_id
  );

  v_i := 0;
  foreach v_passport_id in array p_child_passport_ids
  loop
    if not exists (
      select 1 from public.passport_institution_links pil
      where pil.passport_id = v_passport_id and pil.institution_id = p_institution_id
    ) then
      raise exception 'Child % is not connected to this institution.', v_passport_id;
    end if;

    v_child_index := case when v_i = 0 then 'A' else 'B' end;
    insert into public.incident_children (incident_id, passport_id, child_index, added_by)
    values (v_incident_id, v_passport_id, v_child_index, auth.uid());
    v_i := v_i + 1;
  end loop;

  if p_staff is not null then
    for v_staff_entry in select * from jsonb_array_elements(p_staff)
    loop
      v_user_id := nullif(v_staff_entry ->> 'user_id', '')::uuid;
      v_free_text_name := nullif(v_staff_entry ->> 'free_text_name', '');
      v_involvement := coalesce(nullif(v_staff_entry ->> 'involvement', ''), 'involved');

      if v_user_id is null and v_free_text_name is null then
        raise exception 'Each staff entry needs either user_id or free_text_name.';
      end if;
      if v_involvement not in ('involved', 'witnessed') then
        raise exception 'Invalid involvement value: %', v_involvement;
      end if;

      insert into public.incident_staff (incident_id, user_id, free_text_name, involvement)
      values (v_incident_id, v_user_id, v_free_text_name, v_involvement);
    end loop;
  end if;

  return v_incident_id;
end;
$$;


-- =====================================================================
-- 9. claim_incident() -- full body, verbatim from 0069, one changed
-- line: active staff only.
-- =====================================================================

create or replace function public.claim_incident(p_incident_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_institution_id uuid;
begin
  select institution_id into v_institution_id
  from public.incidents
  where id = p_incident_id and owning_teacher_id is null and teacher_signed_at is null;

  if v_institution_id is null then
    raise exception 'This incident cannot be claimed -- it may already have an owning teacher, be signed off, or not exist.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    where s.institution_id = v_institution_id
      and s.user_id = auth.uid()
      and s.role = 'class_teacher'
      and s.deactivated_at is null
  ) then
    raise exception 'Only a class teacher at this institution can claim an incident.';
  end if;

  update public.incidents set owning_teacher_id = auth.uid() where id = p_incident_id;
end;
$$;


-- =====================================================================
-- 10. get_institution_staff_roster() -- p_include_inactive, default
-- false. The picker for a new incident passes false; historical name
-- resolution on an existing incident passes true, so a departed
-- person's name still resolves on everything they were named on. The
-- CALLER gate is deliberately left as row-existence-only, unchanged --
-- this function is also called from the existing-incident detail page
-- (teacher/incidents/[incidentId]/page.tsx:366), and can_view_incident()
-- lets a deactivated former teacher keep viewing incidents they created
-- or owned regardless of institution_staff status. Gating the CALLER
-- here on active membership would break name resolution on exactly the
-- records this stage is most obligated to keep readable. Same reasoning
-- applies to get_institution_child_roster() below -- its caller gate
-- is also left unchanged.
-- =====================================================================

drop function if exists public.get_institution_staff_roster(uuid);

create function public.get_institution_staff_roster(
  p_institution_id uuid,
  p_include_inactive boolean default false
)
returns table (
  user_id uuid,
  full_name text,
  role text,
  is_active boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.user_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    s.role,
    (s.deactivated_at is null) as is_active
  from public.institution_staff s
  join auth.users u on u.id = s.user_id
  where s.institution_id = p_institution_id
    and (p_include_inactive or s.deactivated_at is null)
    and exists (
      select 1 from public.institution_staff s2
      where s2.institution_id = p_institution_id
        and s2.user_id = auth.uid()
    )
  order by full_name;
$$;

grant execute on function public.get_institution_staff_roster(uuid, boolean) to authenticated;


-- =====================================================================
-- 11. get_institution_child_roster() -- NO functional change. Left
-- here, re-presented rather than silently dropped from this migration,
-- specifically so the correction from Step 0 is visible in what was
-- run: recon had flagged this as needing an active-membership caller
-- gate; writing the SQL surfaced the same historical-resolution
-- conflict as item 10, and it's left unchanged for the identical
-- reason.
-- =====================================================================

create or replace function public.get_institution_child_roster(p_institution_id uuid)
returns table (
  passport_id uuid,
  child_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select p.id as passport_id, p.child_name
  from public.passports p
  join public.passport_institution_links pil on pil.passport_id = p.id
  where pil.institution_id = p_institution_id
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
    )
  order by p.child_name;
$$;


-- =====================================================================
-- 12. mark_parent_called() -- full body, verbatim from 0093, one
-- changed line: active principal only.
-- =====================================================================

create or replace function public.mark_parent_called(p_incident_children_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident_id uuid;
begin
  select incident_id into v_incident_id from public.incident_children where id = p_incident_children_id;
  if v_incident_id is null then
    raise exception 'Not found, or you do not have permission.';
  end if;

  if not exists (
    select 1 from public.incidents i
    where i.id = v_incident_id
      and (
        i.created_by = auth.uid()
        or i.owning_teacher_id = auth.uid()
        or exists (
          select 1 from public.institution_staff s
          join public.institutions inst on inst.id = s.institution_id
          where s.institution_id = i.institution_id
            and s.user_id = auth.uid()
            and s.role = 'principal'
            and s.deactivated_at is null
            and inst.status = 'verified'
        )
      )
  ) then
    raise exception 'You do not have permission to mark this parent as called.';
  end if;

  update public.incident_children
  set parent_called_at = now(), parent_called_by = auth.uid()
  where id = p_incident_children_id;
end;
$$;


-- =====================================================================
-- 13. passport_access -- both grant-creation policies require active
-- institution_staff membership. Full policies, verbatim from 0065, one
-- changed line each.
-- =====================================================================

alter policy "Teachers can insert access for approved, matching institutions"
  on public.passport_access
  with check (
    auth.uid() = teacher_id
    and passport_access.actor_role = public.current_user_role()
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = passport_access.institution_id
        and s.user_id = auth.uid()
        and s.deactivated_at is null
    )
    and exists (
      select 1 from public.passport_institution_links pil
      where pil.passport_id = passport_access.passport_id
        and pil.institution_id = passport_access.institution_id
        and pil.approved_by_parent = true
    )
  );

alter policy "Teachers can reactivate their own revoked access"
  on public.passport_access
  using (
    teacher_id = auth.uid()
    and is_active = false
  )
  with check (
    teacher_id = auth.uid()
    and is_active = true
    and passport_access.actor_role = public.current_user_role()
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = passport_access.institution_id
        and s.user_id = auth.uid()
        and s.deactivated_at is null
    )
    and exists (
      select 1 from public.passport_institution_links pil
      where pil.passport_id = passport_access.passport_id
        and pil.institution_id = passport_access.institution_id
        and pil.approved_by_parent = true
    )
  );
