-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 1, Stage 3, Step 1: Temporary day-scoped access. A fourth source
-- of child access alongside passport_access, class membership, and
-- individual assignment -- active only for one calendar day, computed
-- live against the clock rather than scheduled by any job, exactly the
-- same "no job, no cron" discipline this whole build has held to.
--
-- SCOPE, DECIDED NOT INHERITED, per Step 0: every temporary grant in
-- this migration is SNA-tier access, full stop -- both granting
-- authorities (a class teacher covering their own class, a principal
-- bringing in a supply teacher) produce the same tier. Nothing in the
-- brief names a class_teacher-tier temporary grant, so none is built --
-- the access_tier column exists for future extensibility (a widened
-- CHECK constraint, later, if that's ever needed) but is constrained to
-- 'sna' only here. has_class_teacher_access() is completely untouched
-- by this migration -- only has_sna_access() gains a branch.
--
-- ROLE vs TIER vs STANDING -- corrected mid-review, not assumed right
-- the first time. The auto-created institution_staff row is role =
-- 'sna' (NOT 'class_teacher' -- an earlier draft of this migration got
-- this wrong and was caught before running: a supply teacher whose row
-- persists at role='class_teacher' forever holds a PERMANENT teacher's
-- institutional capacity -- claim_incident() eligibility, appearing as
-- a "class teacher" candidate everywhere, indefinitely -- once granted
-- once, regardless of whether a single temporary_access grant is ever
-- live again. That is authority they were never granted, not
-- membership; role gates institutional capacity everywhere in this
-- schema, tier does not. Fixed: role stays honestly 'sna', matching the
-- tier ceiling, and PERMANENTLY.
--
-- Which reopens the problem role='class_teacher' was there to solve:
-- create_incident_stamp() has always auto-assigned incident ownership
-- to class_teacher-role creators only, so an sna-role supply teacher
-- could never become owning_teacher_id, breaking "any incident a supply
-- teacher has started transfers to the principal" outright. Fixed
-- properly this time, in the one function whose behaviour actually
-- needs the exception (see section 6) -- not by inflating a permanent
-- role.
--
-- Which in turn surfaced a THIRD, wider problem, found by auditing
-- every place that reads institution_staff active/approved as a proxy
-- for "this person currently has standing here" (staff pickers, roster
-- visibility, get_institution_staff_roster(), assign_sna_to_child()):
-- an expired supply teacher's row stays deactivated_at is null and
-- approved_at is not null FOREVER (that's the whole point of Decision
-- 4 -- membership persists). Every one of those call sites was built
-- assuming "active row" means "genuinely, currently, ongoing staff" --
-- true for every row this schema has ever produced until this
-- migration. For a temporary_grant-sourced row it is no longer true on
-- any day without a live grant. Found and fixed at the one call site
-- that actually GRANTS something lasting from that signal
-- (assign_sna_to_child() -- see section 7) and at the roster-listing
-- RPC that feeds every staff picker's "who's available" view
-- (get_institution_staff_roster() -- see section 7). NOT re-audited
-- system-wide -- see section 7's own closing note for exactly what
-- was and wasn't touched, named rather than silently assumed complete.
--
-- ACCOUNT PRE-EXISTENCE, decided explicitly: grant_temporary_access()
-- takes a p_user_id, not an email. There is no invite-by-email path in
-- this migration -- a supply teacher must already have signed in before
-- a grant can name them. That need is real but belongs with Stage 5's
-- claim mechanism, built once, properly, for both cases, not bolted on
-- here as a second, narrower version.
--
-- MEMBERSHIP OUTLIVES THE GRANT, decided explicitly: the auto-created
-- institution_staff row is permanent from the moment it exists -- a
-- person the school has engaged, not a day-scoped fact. Only the
-- temporary_access row itself is date-bound, and (per the correction
-- above) only STANDING derived from that row for granting/listing
-- purposes is date-bound with it -- the row's own existence never is.
-- A returning supply teacher the following week reuses their existing
-- row; nothing about this migration ever deletes or expires
-- institution_staff membership, matching this project's standing
-- discipline against deleting rows production has any reason to keep.

-- =====================================================================
-- 1. app_local_timezone() -- one constant, not a literal repeated at
-- every call site. Migration 0037 already established 'Europe/Dublin'
-- as this schema's "local day" basis; this wraps it once so a future
-- school outside that jurisdiction is a one-line change here, not a
-- grep across every function that touches a date or a time-of-day.
-- Deliberately still a hardcoded literal, not a real per-institution
-- timezone column -- accepted as a scoped-down assumption for now, not
-- a structural decision; flagged plainly rather than silently widened.
-- =====================================================================

create or replace function public.app_local_timezone()
returns text
language sql
immutable
as $$
  select 'Europe/Dublin'::text;
$$;

grant execute on function public.app_local_timezone() to authenticated;

-- =====================================================================
-- 2. institutions.temporary_access_cutoff_time -- principal-
-- configurable, per institution. Activation (07:30) is a fixed system-
-- wide constant, not a setting -- only the cut-off varies by school.
-- =====================================================================

alter table public.institutions
  add column if not exists temporary_access_cutoff_time time not null default '15:00';

create or replace function public.set_temporary_access_cutoff(
  p_institution_id uuid,
  p_cutoff_time time
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_cutoff_time is null or p_cutoff_time <= '07:30'::time then
    raise exception 'The cut-off must be later than the 07:30 activation time.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) then
    raise exception 'Only an active principal at this institution can set the cut-off time.';
  end if;

  update public.institutions
  set temporary_access_cutoff_time = p_cutoff_time
  where id = p_institution_id;
end;
$$;

grant execute on function public.set_temporary_access_cutoff(uuid, time) to authenticated;

-- =====================================================================
-- 3. temporary_access -- the grant itself. Whole-class scope (every
-- child currently in class_id, on granted_for_date), matching class
-- membership's own shape, not child_assignments' per-child one -- both
-- granting authorities cover "a class for a day", never one child.
-- Revocation is its own append-only fact, separate from natural expiry
-- (which needs no write at all) -- "ending is ending, never deleting"
-- applied the same way as everywhere else in this build.
-- =====================================================================

create table public.temporary_access (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  class_id uuid not null references public.classes (id) on delete cascade,
  granted_to uuid not null references auth.users (id),
  -- Constrained to 'sna' only, deliberately -- see the header note.
  access_tier text not null default 'sna' check (access_tier = 'sna'),
  granted_for_date date not null,
  granted_by uuid not null references auth.users (id),
  granted_by_role text not null check (granted_by_role in ('class_teacher', 'principal')),
  reason text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id),
  revocation_reason text,
  constraint temporary_access_revoke_paired check (
    (revoked_at is null and revoked_by is null and revocation_reason is null)
    or (revoked_at is not null and revoked_by is not null and revocation_reason is not null)
  )
);

create index temporary_access_institution_id_idx on public.temporary_access (institution_id);
create index temporary_access_class_id_idx on public.temporary_access (class_id);
create index temporary_access_granted_to_idx on public.temporary_access (granted_to);

-- Not a hard "one grant per person per day" rule -- a re-grant after an
-- earlier one was revoked is legitimate and must be possible -- just no
-- two simultaneously-active grants for the same person/class/date.
create unique index temporary_access_one_active_per_person_class_date
  on public.temporary_access (class_id, granted_to, granted_for_date)
  where revoked_at is null;

alter table public.temporary_access enable row level security;

create policy "Active staff can view their institution's temporary access grants"
  on public.temporary_access for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = temporary_access.institution_id
        and s.user_id = auth.uid()
        and s.deactivated_at is null
        and s.approved_at is not null
    )
  );

-- No client-facing write policy -- grant_temporary_access()/
-- revoke_temporary_access() below are the only write paths.

-- =====================================================================
-- 4. incident_ownership_transfers -- append-only record of every
-- automatic ownership transfer resolve_lapsed_incident_ownership()
-- performs. "Recorded, never silent": original creator (incidents.
-- created_by, untouched by any of this), who it transferred from, who
-- it transferred to, when, and why -- this table IS that record, not a
-- side effect inferred later from incidents.owning_teacher_id having
-- silently changed.
-- =====================================================================

create table public.incident_ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  from_teacher_id uuid not null references auth.users (id),
  to_principal_id uuid not null references auth.users (id),
  reason text not null,
  transferred_at timestamptz not null default now()
);

create index incident_ownership_transfers_incident_id_idx on public.incident_ownership_transfers (incident_id);

alter table public.incident_ownership_transfers enable row level security;

-- Visibility mirrors the incident's own -- whoever could see the
-- incident before a transfer can see that it happened, same chokepoint
-- (can_view_incident()) the 9 incident-family tables already share.
create policy "Whoever can view the incident can view its ownership transfers"
  on public.incident_ownership_transfers for select to authenticated
  using (public.can_view_incident(incident_id));

-- No client-facing write policy -- resolve_lapsed_incident_ownership()
-- below is the only write path.

-- =====================================================================
-- 5. Three small helpers, layered, one implementation each -- built
-- BEFORE has_sna_access() and everything downstream so every later
-- section can call them rather than re-deriving the same live-grant
-- logic inline three separate times.
--
-- has_active_temporary_grant() -- the lowest-level primitive: does ANY
-- currently-active temporary_access row exist for this person at this
-- institution, right now, in the 07:30-to-cut-off window, regardless of
-- which specific class. Used wherever "are they genuinely covering
-- something here today" matters more than "do they have access to THIS
-- specific child" (has_sna_access() below needs the latter, narrower
-- question, so it does NOT call this -- it has its own class_children-
-- joined branch).
--
-- institution_staff_has_current_standing() -- for GENERAL staff-
-- listing/eligibility purposes: an ordinarily-joined row (approval_
-- source is not 'temporary_grant') keeps exactly its original active/
-- approved meaning, untouched. A temporary_grant-sourced row ALSO needs
-- a currently-active grant -- its mere existence is no longer
-- sufficient, because Decision 4 made that existence permanent while
-- the standing it was created for was always meant to be one day at a
-- time.
--
-- can_own_incident() -- create_incident_stamp()'s own ownership-
-- assignment rule and the pre-signoff edit policy's own authority check
-- must ask the identical question, or the two drift: a class_teacher-
-- role creator (unchanged, matches every incident this schema has ever
-- produced), OR anyone currently holding an active temporary grant,
-- regardless of role -- this is deliberately role-blind on the second
-- branch, because a supply teacher's role is 'sna' by the correction
-- above, and role is exactly the wrong signal to gate this on for them.
-- =====================================================================

create or replace function public.has_active_temporary_grant(
  p_user_id uuid,
  p_institution_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.temporary_access ta
    join public.institutions inst on inst.id = ta.institution_id
    where ta.granted_to = p_user_id
      and ta.institution_id = p_institution_id
      and ta.revoked_at is null
      and ta.granted_for_date = (now() at time zone public.app_local_timezone())::date
      and (now() at time zone public.app_local_timezone())::time >= '07:30'::time
      and (now() at time zone public.app_local_timezone())::time < inst.temporary_access_cutoff_time
  );
$$;

grant execute on function public.has_active_temporary_grant(uuid, uuid) to authenticated;

create or replace function public.institution_staff_has_current_standing(
  p_user_id uuid,
  p_institution_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.institution_staff s
    where s.user_id = p_user_id
      and s.institution_id = p_institution_id
      and s.deactivated_at is null
      and s.approved_at is not null
      and (
        s.approval_source is distinct from 'temporary_grant'
        or public.has_active_temporary_grant(p_user_id, p_institution_id)
      )
  );
$$;

grant execute on function public.institution_staff_has_current_standing(uuid, uuid) to authenticated;

create or replace function public.can_own_incident(
  p_user_id uuid,
  p_institution_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = p_institution_id
        and s.user_id = p_user_id
        and s.role = 'class_teacher'
        and s.deactivated_at is null
        and s.approved_at is not null
    )
    or public.has_active_temporary_grant(p_user_id, p_institution_id);
$$;

grant execute on function public.can_own_incident(uuid, uuid) to authenticated;

-- =====================================================================
-- 6. has_sna_access() -- the fourth OR-branch. has_class_teacher_access()
-- is NOT touched by this migration at all -- see the header note on
-- scope. Defense-in-depth here checks the grantee's own institution_
-- staff row is active and approved WITHOUT filtering on role -- role and
-- tier are deliberately decoupled (see header note), so this branch
-- must not assume role = 'sna' the way the class-derived/assignment-
-- derived branches assume their own table membership implies a role.
-- This branch re-derives the live-grant condition inline (institution +
-- class_children join, not a call to has_active_temporary_grant()) --
-- deliberately narrower than that helper, because THIS check must be
-- specific to the child's own current class, not merely "some grant is
-- live somewhere at this institution".
-- =====================================================================

create or replace function public.has_sna_access(
  p_user_id uuid,
  p_passport_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (
      select 1 from public.passport_access pa
      where pa.passport_id = p_passport_id
        and pa.teacher_id = p_user_id
        and pa.is_active = true
        and pa.actor_role = 'sna'
    )
    or exists (
      select 1
      from public.child_assignments ca
      join public.institution_staff s on s.user_id = ca.user_id and s.institution_id = ca.institution_id
      where ca.passport_id = p_passport_id
        and ca.user_id = p_user_id
        and ca.ended_at is null
        and s.deactivated_at is null
        and s.approved_at is not null
    )
    or exists (
      select 1
      from public.temporary_access ta
      join public.class_children cc on cc.class_id = ta.class_id
      join public.institutions inst on inst.id = ta.institution_id
      join public.institution_staff s on s.user_id = ta.granted_to and s.institution_id = ta.institution_id
      where cc.passport_id = p_passport_id
        and cc.ended_at is null
        and ta.granted_to = p_user_id
        and ta.access_tier = 'sna'
        and ta.revoked_at is null
        and ta.granted_for_date = (now() at time zone public.app_local_timezone())::date
        and (now() at time zone public.app_local_timezone())::time >= '07:30'::time
        and (now() at time zone public.app_local_timezone())::time < inst.temporary_access_cutoff_time
        and s.deactivated_at is null
        and s.approved_at is not null
    );
$$;

grant execute on function public.has_sna_access(uuid, uuid) to authenticated;

-- =====================================================================
-- 7. THE FOUR PRESERVED-STRICTER SITES -- checked against this
-- migration explicitly, not assumed unaffected. All four are class_
-- teacher-tier-only gates (activity_log SELECT and get_teacher_activity_
-- feed() via has_class_teacher_access()-equivalent inline logic;
-- get_message_recipient_candidates()/send_message() because Messages
-- stays class_teacher-only by Stage 2's own design). Every temporary
-- grant in THIS migration is sna-tier only (see the header note), so
-- none of the four are reachable by a temporary-access holder today --
-- not because of anything specific to Messages, but because has_class_
-- teacher_access() itself was left completely untouched above. NO
-- FUNCTIONAL CHANGE to any of the four. This comment is the guard
-- against a silent hole: if a future migration ever widens temporary_
-- access.access_tier to permit 'class_teacher', each of these four
-- sites' inline class-derived branch (src: activity_log SELECT and
-- get_teacher_activity_feed() in 0104) will need its own temporary-
-- access branch added explicitly, matching the class-derived branch
-- already there -- exactly the same institution-matched-approved_by_
-- parent shape, not a role-blind has_class_teacher_access() call,
-- since preserving that stricter gate is the entire reason those two
-- sites don't call the shared helper in the first place. Named here so
-- that widening is a deliberate, grepped-for change, not a rediscovery.
--   1. activity_log SELECT policy ("Teachers can view activity for
--      passports they access") -- 0104_classes_and_assignment.sql
--   2. get_teacher_activity_feed() -- 0104_classes_and_assignment.sql
--   3. get_message_recipient_candidates() -- unreachable at sna-tier by
--      Stage 2's own design (Messages excludes SNA entirely); no branch
--      needed even if this migration's own tier scope later widens,
--      unless Stage 2's Messages exclusion is itself revisited first.
--   4. send_message() -- same as 3.
-- =====================================================================

-- =====================================================================
-- 8. grant_temporary_access() -- one RPC, caller-role-branched
-- authorization, matching assign_sna_to_child()'s own shape from Stage
-- 2 exactly: a class teacher can grant cover for their OWN current
-- class only, to an SNA colleague already active at the institution; a
-- principal can grant cover for ANY class at their institution, to
-- anyone who already holds a Behaviour Hive account (no invite-by-email
-- -- see header note). If the grantee has no active institution_staff
-- row at this institution yet, one is created here -- role = 'sna'
-- (corrected -- see header note), approved immediately in the same
-- transaction (the grant IS the approval, same pattern as every other
-- principal-driven immediate-effect action in this schema), approval_
-- source = 'temporary_grant'. That row's EXISTENCE is never touched
-- again by this migration once created -- Decision 4's own call: it
-- outlives the grant. Its STANDING, for the purposes anything else in
-- this schema reads it for, does not -- see section 5/7.
-- =====================================================================

alter table public.institution_staff
  drop constraint if exists institution_staff_approval_source_check;
alter table public.institution_staff
  add constraint institution_staff_approval_source_check
  check (approval_source is null or approval_source in ('grandfathered', 'bootstrap', 'principal', 'handover', 'temporary_grant'));

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

    -- institution_staff_one_active_per_institution (0097) permits at
    -- most one row with deactivated_at is null per (institution_id,
    -- user_id) -- an unapproved (pending) row already satisfies that
    -- index just as an approved one does, so a plain "is there an
    -- approved row" check would try to INSERT a second row and hit that
    -- constraint head-on if a stale pending join happens to exist.
    -- Checked for both cases explicitly rather than assumed away.
    select id, approved_at into v_existing_staff_id, v_existing_approved_at
    from public.institution_staff
    where user_id = p_user_id
      and institution_id = v_class.institution_id
      and deactivated_at is null;

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

create or replace function public.revoke_temporary_access(
  p_temporary_access_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant public.temporary_access;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reason is required.';
  end if;

  select * into v_grant from public.temporary_access where id = p_temporary_access_id;
  if not found then
    raise exception 'Grant not found.';
  end if;

  if v_grant.revoked_at is not null then
    raise exception 'This grant has already been revoked.';
  end if;

  if v_grant.granted_by <> auth.uid() and not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.user_id = auth.uid()
      and s.institution_id = v_grant.institution_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) then
    raise exception 'Only the person who granted this, or the institution''s principal, can revoke it.';
  end if;

  update public.temporary_access
  set revoked_at = now(), revoked_by = auth.uid(), revocation_reason = trim(p_reason)
  where id = p_temporary_access_id;
end;
$$;

grant execute on function public.revoke_temporary_access(uuid, text) to authenticated;

-- =====================================================================
-- 9. Incident ownership -- widened to include temporary-access holders,
-- and decoupled from staleness.
--
-- create_incident_stamp() -- the ONE line that changes: owning_teacher_
-- id now uses can_own_incident() instead of a bare role = 'class_
-- teacher' check. class_teacher creators are unaffected (can_own_
-- incident()'s first branch is byte-identical to the old inline
-- condition); an sna-role creator currently covering via an active
-- temporary grant now auto-owns their own incident too, which is the
-- only way "any incident a supply teacher has started transfers to the
-- principal" can be true at all. Every other line of this function is
-- unchanged, verbatim from its live (0100) body.
-- =====================================================================

create or replace function public.create_incident_stamp(
  p_institution_id uuid,
  p_occurred_at timestamptz,
  p_location_id uuid,
  p_child_passport_ids uuid[],
  p_staff jsonb
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
    and deactivated_at is null
    and approved_at is not null;

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
    case when public.can_own_incident(auth.uid(), p_institution_id) then auth.uid() else null end,
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

grant execute on function public.create_incident_stamp(uuid, timestamptz, uuid, uuid[], jsonb) to authenticated;

-- resolve_lapsed_incident_ownership() -- lazy materialization, not a
-- scheduled job. "The stamp is the trigger": only incidents that were
-- actually started (owning_teacher_id is not null) are ever affected --
-- a supply teacher granted access who never created anything leaves
-- nothing for this function to find. Scoped to pre-signoff incidents
-- only (teacher_signed_at is null) -- once signed off, an incident is
-- immutable and owning_teacher_id becomes a purely historical fact,
-- same as created_by already is; there's nothing left to transfer FOR,
-- since nobody can edit it regardless of who owns it.
--
-- WHERE THIS RUNS: get_institution_incidents() is `language sql
-- stable` -- a SQL/STABLE function cannot perform a write at all, by
-- Postgres's own rules, so folding this in there is not a small change,
-- it's rewriting that function's declared volatility and shape. That
-- wasn't done in this migration -- the SAFER fix is the edit-policy
-- tightening below, which makes the transfer's TIMING irrelevant to
-- security (a lapsed holder is refused regardless of whether this
-- function has run yet). This RPC is provided standalone; Step 3's
-- client code should call it from every principal-facing incident read
-- path -- the dashboard queue load AND the individual incident detail
-- page load, not only one of them -- so the recorded transfer itself
-- doesn't go stale for a week even though nothing is ever at risk
-- while it does.
create or replace function public.resolve_lapsed_incident_ownership(p_institution_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_principal_id uuid;
  v_resolved integer := 0;
  v_incident record;
begin
  select user_id into v_principal_id
  from public.institution_staff
  where institution_id = p_institution_id
    and role = 'principal'
    and deactivated_at is null
    and approved_at is not null
  limit 1;

  if v_principal_id is null then
    return 0;
  end if;

  for v_incident in
    select distinct i.id, i.owning_teacher_id
    from public.incidents i
    join public.incident_children ic on ic.incident_id = i.id
    where i.institution_id = p_institution_id
      and i.teacher_signed_at is null
      and i.owning_teacher_id is not null
      and i.owning_teacher_id <> v_principal_id
      and not public.can_own_incident(i.owning_teacher_id, p_institution_id)
  loop
    update public.incidents set owning_teacher_id = v_principal_id where id = v_incident.id;

    insert into public.incident_ownership_transfers (incident_id, from_teacher_id, to_principal_id, reason)
    values (v_incident.id, v_incident.owning_teacher_id, v_principal_id, 'Temporary access ended before this incident was signed off.');

    v_resolved := v_resolved + 1;
  end loop;

  return v_resolved;
end;
$$;

grant execute on function public.resolve_lapsed_incident_ownership(uuid) to authenticated;

-- THE SECURITY FIX ITSELF: "ownership and authority must not be the
-- same check." Before this, "Owning teacher can edit before teacher
-- sign-off" (0069) checked only owning_teacher_id = auth.uid() plus a
-- bare role = 'class_teacher' lookup -- no deactivated_at/approved_at
-- filter at all (a genuine, pre-existing gap, found while fixing this
-- for Stage 3 and fixed in the same statement rather than left sitting
-- beside the new fix), and no live check that the owner can still
-- actually reach the child at all. Now: owning_teacher_id must match,
-- can_own_incident() must independently confirm the caller STILL
-- qualifies to own an incident here (the same rule create_incident_
-- stamp() used to assign it -- a permanent class_teacher's standing, OR
-- a currently-active temporary grant; a lapsed one no longer counts,
-- full stop), AND has_child_access() must independently confirm live
-- standing on at least one of the incident's own children. A stale
-- owning_teacher_id can now never mean live access -- whether that
-- staleness comes from a lapsed temporary grant (this stage) or from
-- Stage 2's own "removed from a class mid-day" (which this same
-- tightening now correctly extends to in-progress incidents too, not
-- just the new UI screens Stage 2 shipped).
alter policy "Owning teacher can edit before teacher sign-off"
  on public.incidents
  using (
    teacher_signed_at is null
    and owning_teacher_id = auth.uid()
    and public.can_own_incident(auth.uid(), incidents.institution_id)
    and exists (
      select 1 from public.incident_children ic
      where ic.incident_id = incidents.id
        and public.has_child_access(auth.uid(), ic.passport_id)
    )
  )
  with check (
    owning_teacher_id = auth.uid()
  );

-- =====================================================================
-- 10. THE STANDING AUDIT Daniel asked for -- what can an expired supply
-- teacher's permanent-but-day-scoped row still do, checked against the
-- REAL, current SQL of every surface named, not assumed. Two real fixes
-- below; the rest are named as checked-and-fine or checked-and-
-- pre-existing, not silently skipped.
--
-- assign_sna_to_child() (Stage 2, 0104) -- THE REAL LEAK. Its guard
-- checked only role = 'sna' and deactivated_at is null/approved_at is
-- not null -- exactly the signal Decision 4 makes permanently true for
-- a supply teacher. Unfixed, a principal (or the child's own class
-- teacher) could pick an expired supply teacher from the ordinary SNA
-- picker and assign them PERMANENT one-to-one access to a child via
-- Stage 2's own child_assignments mechanism -- a real grant, indefinite,
-- with no relationship at all to their single day of cover. Fixed:
-- institution_staff_has_current_standing() replaces the raw active/
-- approved check. Every other line of this function is unchanged,
-- verbatim from its live (0104) body.
--
-- get_institution_staff_roster() (0100) -- feeds every staff picker
-- and the /principal/staff roster listing, including the very picker
-- that fed the leak above. Its is_active column was a bare active/
-- approved computation. Fixed the same way, so an expired supply
-- teacher stops appearing as an ordinary, available "Active" SNA the
-- moment their grant lapses -- not just at the one RPC that would have
-- let something permanent be granted from that false signal, but at
-- the listing that shows them as a candidate in the first place. Every
-- other line of this function is unchanged, verbatim from its live
-- (0100) body.
--
-- CHECKED, NOT CHANGED -- named explicitly rather than left ambiguous:
--   - claim_incident() -- requires role = 'class_teacher'. A supply
--     teacher's row is role = 'sna' (this migration's own correction),
--     so this was never reachable by them regardless, before or after
--     any of the fixes above.
--   - can_countersign_incident() -- requires role = 'principal', or a
--     separate institution_permissions grant. A supply teacher is never
--     role = 'principal'. A principal COULD separately, deliberately
--     delegate countersign authority to them via institution_
--     permissions -- that mechanism's own grantee-is-staff trigger
--     (0078) only checks row existence, no active/approved check at
--     all, which is a pre-existing looseness that predates this
--     migration and applies to any deactivated staff member too, not
--     something Stage 3 introduces or worsens. Named, not fixed here.
--   - being named on an incident (incident_staff, via create_incident_
--     stamp()'s p_staff array) -- user_id there has always accepted any
--     auth.users id with no institution_staff/role/active check at all
--     (free_text_name exists specifically for people with no account),
--     for every caller, always. Not a Stage-3-specific gap.
--   - class_teachers/class_children "Active staff can view..." SELECT
--     policies (Stage 2) -- role-blind, any active/approved staff,
--     institution-wide. An expired supply teacher would still see the
--     institution's class LIST and ROSTER STRUCTURE (which classes
--     exist, who's in them) indefinitely -- the same root cause as the
--     roster-listing fix above, but read-only/informational rather than
--     a grant of anything. Flagged, not fixed in this pass -- worth a
--     deliberate decision on whether informational roster visibility
--     should carry the same current-standing check, separately from the
--     two fixes above that stop something from actually being GRANTED
--     off a stale signal.
-- =====================================================================

create or replace function public.assign_sna_to_child(
  p_passport_id uuid,
  p_user_id uuid,
  p_institution_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_authorized boolean;
  v_row_id uuid;
begin
  select exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.user_id = auth.uid()
      and s.institution_id = p_institution_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) or exists (
    select 1 from public.class_children cc
    join public.class_teachers ct on ct.class_id = cc.class_id
    where cc.passport_id = p_passport_id
      and cc.ended_at is null
      and ct.user_id = auth.uid()
      and ct.ended_at is null
  ) into v_caller_authorized;

  if not v_caller_authorized then
    raise exception 'Only the principal, or a teacher of this child''s current class, can assign an SNA.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    where s.user_id = p_user_id
      and s.institution_id = p_institution_id
      and s.role = 'sna'
  ) or not public.institution_staff_has_current_standing(p_user_id, p_institution_id) then
    raise exception 'This person must be an active SNA at this institution.';
  end if;

  if exists (
    select 1 from public.child_assignments
    where passport_id = p_passport_id and ended_at is null
  ) then
    raise exception 'This child already has an assigned SNA.';
  end if;

  insert into public.child_assignments (institution_id, passport_id, user_id, started_by)
  values (p_institution_id, p_passport_id, p_user_id, auth.uid())
  returning id into v_row_id;

  return v_row_id;
end;
$$;

grant execute on function public.assign_sna_to_child(uuid, uuid, uuid) to authenticated;

create or replace function public.get_institution_staff_roster(
  p_institution_id uuid,
  p_include_inactive boolean default false,
  p_include_pending boolean default false
)
returns table (
  id uuid,
  user_id uuid,
  full_name text,
  role text,
  is_active boolean,
  is_pending boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.id,
    s.user_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    s.role,
    (
      s.approved_at is not null and s.deactivated_at is null
      and (
        s.approval_source is distinct from 'temporary_grant'
        or public.has_active_temporary_grant(s.user_id, s.institution_id)
      )
    ) as is_active,
    (s.approved_at is null and s.deactivated_at is null) as is_pending
  from public.institution_staff s
  join auth.users u on u.id = s.user_id
  where s.institution_id = p_institution_id
    and s.rejected_at is null
    and (
      (s.approved_at is not null and (p_include_inactive or s.deactivated_at is null))
      or (p_include_pending and s.approved_at is null and s.deactivated_at is null)
    )
    and exists (
      select 1 from public.institution_staff s2
      where s2.institution_id = p_institution_id
        and s2.user_id = auth.uid()
        and s2.approved_at is not null
    )
  order by full_name;
$$;

grant execute on function public.get_institution_staff_roster(uuid, boolean, boolean) to authenticated;
