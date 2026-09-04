-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- grant_temporary_access() (0105) real bug, found live while verifying
-- migration 0171: granting temporary access to someone whose PRIOR join
-- request at this same institution was rejected throws a raw
-- institution_staff_approval_source_paired_check violation instead of
-- succeeding.
--
-- ROOT CAUSE: the existing-row lookup filters `deactivated_at is null`
-- only. A rejected row also has deactivated_at null (rejection is its
-- own terminal state, distinct from deactivation), so the lookup finds
-- it, treats it as "an unresolved row to resolve" (the same branch
-- built for a genuinely PENDING row), and tries to UPDATE it to
-- approved_at = now() / approval_source = 'temporary_grant' -- which
-- the paired check refuses, correctly, because that row's rejected_at
-- is still set: `approval_source is not null` requires `rejected_at is
-- null` in the same row.
--
-- THE FIX IS NOT TO CLEAR rejected_at ON THAT ROW. That would satisfy
-- the constraint but erase the rejection from the one place it's read
-- back (get_rejected_staff_joins()) -- Daniel's own call: "someone
-- rejected and later granted cover" must stay two visible facts, not
-- one overwriting the other, same reasoning as every other ended-not-
-- deleted state in this schema.
--
-- The correct fix already exists as a live precedent in this exact
-- table: institution_staff_one_active_per_institution (0100) is a
-- PARTIAL unique index -- `where deactivated_at is null and rejected_at
-- is null` -- deliberately excluding rejected rows so a brand new row
-- can coexist with an old rejected one for the same (institution_id,
-- user_id) pair. teacher/join-institution/page.tsx's own checkExisting()
-- comment says this outright: "a rejoin after deactivation is a fresh
-- row here, same as a fresh request after rejection." Adding `and
-- rejected_at is null` to this function's own lookup -- matching that
-- index's scoping exactly -- makes a rejected person's lookup come back
-- empty, which sends them down the ALREADY-EXISTING "brand new person"
-- branch: a fresh row is inserted and approved via the grant, the old
-- rejected row is never touched. Both facts stay visible, on separate
-- rows -- the rejection in "Rejected requests" history, the new grant
-- in whatever surfaces temporary_grant rows -- exactly like a
-- post-deactivation rejoin already works today.
--
-- One line changed in an otherwise byte-identical function body (the
-- lookup's WHERE clause only) -- everything else, including the
-- pending-row-resolution branch and the deliberately-not-solved "keeps
-- their own previously-requested role, not forced to sna" limitation
-- named in 0105's own comment, is untouched.
--
-- Same signature as 0105 (p_class_id uuid, p_user_id uuid, p_date date,
-- p_reason text) -- plain CREATE OR REPLACE is safe, nothing about the
-- parameter list changes.

create or replace function public.grant_temporary_access(
  p_class_id uuid,
  p_user_id uuid,
  p_date date,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class public.classes;
  v_caller_role text;
  v_grant_id uuid;
  v_existing_staff_id uuid;
  v_existing_approved_at timestamptz;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required.';
  end if;

  if p_date < (now() at time zone public.app_local_timezone())::date then
    raise exception 'Cannot grant temporary access for a date that has already passed.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You cannot grant temporary access to yourself.';
  end if;

  select * into v_class from public.classes where id = p_class_id;
  if not found then
    raise exception 'Class not found.';
  end if;

  -- Authority 1: the class's own current teacher, cover for their own
  -- class only, always granting an existing SNA colleague.
  if exists (
    select 1 from public.class_teachers ct
    where ct.class_id = p_class_id
      and ct.user_id = auth.uid()
      and ct.ended_at is null
  ) then
    v_caller_role := 'class_teacher';

    if not exists (
      select 1 from public.institution_staff s
      where s.user_id = p_user_id
        and s.institution_id = v_class.institution_id
        and s.role = 'sna'
        and s.deactivated_at is null
        and s.approved_at is not null
    ) then
      raise exception 'A class teacher can only grant temporary cover to an active SNA at this school.';
    end if;

  -- Authority 2: the institution's own active principal, any class,
  -- always sna-tier regardless of who is being covered (Step 0, #2).
  elsif exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.user_id = auth.uid()
      and s.institution_id = v_class.institution_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) then
    v_caller_role := 'principal';

    if not exists (select 1 from auth.users where id = p_user_id) then
      raise exception 'That person does not have a Behaviour Hive account. They must sign up before they can be granted access.';
    end if;

    -- institution_staff_one_active_per_institution (0100) permits at
    -- most one row with deactivated_at is null AND rejected_at is null
    -- per (institution_id, user_id) -- an unapproved (pending) row
    -- already satisfies that index just as an approved one does, so a
    -- plain "is there an approved row" check would try to INSERT a
    -- second row and hit that constraint head-on if a stale pending
    -- join happens to exist. Checked for both cases explicitly rather
    -- than assumed away.
    --
    -- `and rejected_at is null` added here -- matching the index's own
    -- scoping exactly -- so a REJECTED prior row is treated the same as
    -- no row at all, not as "an unresolved row to resolve" the way a
    -- pending row is. See this migration's own header for why: mutating
    -- the rejected row instead would satisfy institution_staff_
    -- approval_source_paired_check only by erasing the rejection.
    select id, approved_at into v_existing_staff_id, v_existing_approved_at
    from public.institution_staff
    where user_id = p_user_id
      and institution_id = v_class.institution_id
      and deactivated_at is null
      and rejected_at is null;

    if v_existing_staff_id is null then
      insert into public.institution_staff (institution_id, user_id, role)
      values (v_class.institution_id, p_user_id, 'sna')
      returning id into v_existing_staff_id;

      update public.institution_staff
      set approved_at = now(), approved_by = auth.uid(), approval_source = 'temporary_grant'
      where id = v_existing_staff_id;
    elsif v_existing_approved_at is null then
      -- A pending join request already existed for this person at this
      -- institution -- the grant itself resolves it, rather than
      -- colliding with it. NAMED LIMITATION, not silently handled: this
      -- reuses that row's own self-requested role as-is, whatever it
      -- is, rather than forcing it to 'sna'. Correcting a role someone
      -- else already requested for themselves felt like a bigger call
      -- than this migration should make unilaterally. Narrow enough
      -- (requires a coincidental prior pending join) to flag rather
      -- than solve here.
      update public.institution_staff
      set approved_at = now(), approved_by = auth.uid(), approval_source = 'temporary_grant'
      where id = v_existing_staff_id;
    end if;

  else
    raise exception 'Only the class''s own current teacher, or this institution''s principal, can grant temporary access.';
  end if;

  insert into public.temporary_access (
    institution_id, class_id, granted_to, granted_for_date, granted_by, granted_by_role, reason
  )
  values (
    v_class.institution_id, p_class_id, p_user_id, p_date, auth.uid(), v_caller_role, trim(p_reason)
  )
  returning id into v_grant_id;

  return v_grant_id;
end;
$$;

grant execute on function public.grant_temporary_access(uuid, uuid, date, text) to authenticated;
