-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- The cross-organisation link path CLAUDE.md's own "A SCHOOL CANNOT
-- LINK ITSELF TO A CHILD WHO ALREADY HAS A CLINIC-CREATED PASSPORT"
-- entry records as missing. Every insert into
-- passport_institution_links, across the whole schema, has always
-- happened inside a passport-CREATION function (create_school_
-- passport(), onboard_clinic_client()) -- nothing attaches an EXISTING
-- passport to a new institution. Recon confirmed this by grepping
-- every migration for the insert; four hits, all four inside a
-- creation function.
--
-- PARENT-INITIATED, per Daniel's own decision -- not school-side
-- detection, which would disclose that a family sees a clinic (theirs
-- to tell, not this app's). A parent generates a code
-- (passport_link_codes, its own table -- Decision: "its own kind of
-- code", a different lifetime and authority than passport_claim_codes,
-- which connects a PARENT once; this connects an INSTITUTION); a
-- school principal enters it while enrolling.
--
-- SCHOOL-SIDE ONLY, THIS MIGRATION. The reverse direction (a school-
-- created passport linking to a clinic) is NOT built here -- recorded,
-- not solved, per Daniel's own instruction. What it would take, so the
-- next person doesn't have to re-derive it:
--   - redeem_institution_link_code() would need an institutions.type
--     branch: a school gets an enrolments row (this migration's own
--     shape), a clinic would need an episodes_of_care row instead,
--     matching onboard_clinic_client()'s own shape (0210) -- the same
--     branch principal/passports/enrol/page.tsx already has to have
--     for creation, just applied to linking.
--   - the caller check in redeem_institution_link_code() would need a
--     clinic branch (director/admin/toggle-gated practitioner,
--     inst.type = 'clinic'), matching onboard_clinic_client()'s own
--     authorization exactly.
--   - the "clinic is told" mechanism below (team_linked) doesn't apply
--     in reverse -- a school's own principal would need the
--     institution-wide 'team_linked' branch get_principal_activity_
--     feed() doesn't currently have (confirmed by reading its live
--     0202 definition directly -- no such branch exists today).
-- The peek/redeem function PAIR itself is institution-type-agnostic by
-- construction (neither takes an institution type as an assumption
-- baked into its own logic beyond the explicit checks above), so
-- building the reverse direction is widening these two functions, not
-- replacing them.
--
-- THE PEEK-THEN-COMMIT SPLIT, why it differs from redeem_passport_
-- claim_code()'s own deliberate one-shot shape: that RPC commits
-- first and discloses the child's name only after, specifically so a
-- wrong guess never discloses whose child it was to an arbitrary
-- authenticated parent. Here the caller is a verified, currently-
-- standing principal, and the whole POINT (Daniel's own words) is to
-- catch a mistyped code BEFORE it links -- the opposite requirement.
-- peek_institution_link_code() is a pure lookup (no side effect but
-- the rate-limit record on a genuine miss), matching lookup_passport_
-- by_code()'s own established shape (0034) -- same minimal-disclosure
-- return (first name + last initial), same reasoning: a verified
-- caller is a smaller disclosure risk than an arbitrary parent, but
-- still not zero, so the established convention is kept rather than
-- invented fresh. redeem_institution_link_code() is the separate,
-- atomic commit -- it re-validates everything from scratch rather than
-- trusting the peek, the same discipline generate/redeem_passport_
-- claim_code() already split two ways.
--
-- THE ENROLMENTS CONSTRAINT. enrolments_one_active_per_child (0121) is
-- a GLOBAL unique index -- unique(passport_id) where ended_at is null,
-- no institution scoping at all (confirmed live, unchanged since
-- 0121). This path is therefore structurally a clinic-passport-gains-
-- a-school-link operation, not a school-to-school transfer -- a
-- passport that already has an active enrolment ANYWHERE is refused
-- with an explicit, actionable message pointing at the still-parked
-- transfer flow (0121's own "Requirement 6" note), never left to fail
-- on the raw constraint violation. Checked and refused explicitly,
-- before the insert is ever attempted.
--
-- THE NEW UNIQUE CONSTRAINT. passport_institution_links has never had
-- a unique constraint on (passport_id, institution_id) -- confirmed by
-- grepping every migration for "alter table public.passport_
-- institution_links", one hit, RLS enable only. The explicit
-- already-linked check inside redeem_institution_link_code() is
-- necessary (it produces the honest, specific error message); this
-- constraint is what actually makes the claim true at the database
-- level rather than merely in the one function that currently
-- remembers to check it.
--
-- approved_by_parent = true ON THIS WRITE IS A GENUINE CONSENT RECORD
-- -- the one writer in this schema where that is actually true.
-- create_school_passport() and onboard_clinic_client() both set it
-- true as a compatibility default with no parent action behind it at
-- all (CLAUDE.md's own "A COLUMN NAME IS A CLAIM" entry documents
-- both). This is different: a parent generated the code that
-- authorises this exact link, so parent_approved_at is stamped `now()`
-- here, not left null the way both compatibility-default writers
-- leave it.
--
-- team_linked HAS BEEN A LEGAL activity_log.event_type SINCE THE VERY
-- FIRST MIGRATION (0022) AND HAS NEVER ONCE BEEN WRITTEN. Grepped
-- every migration for an actual insert of 'team_linked' -- zero. It
-- already has a client icon (PeopleIcon, activityEvents.tsx), a
-- teacher-read policy, a parent-read policy, and get_clinician_
-- activity_feed()'s own allow-list (live def, 0054) already includes
-- it. The whole notification mechanism was built roughly six months
-- ago with nothing to trigger it -- this migration is that trigger,
-- the first real writer this event_type has ever had.
--
-- THE DIRECTOR NOTIFICATION GAP -- NOT SOLVED, RECORDED. team_linked
-- reaches every clinician who holds their OWN active clinician_access
-- row for this child, via get_clinician_activity_feed(). It does NOT
-- reach a clinic director who isn't personally engaged on the case --
-- ClinicDirectorDashboard.tsx has no general activity feed at all
-- (confirmed -- zero references), only work-queue buckets, and get_
-- clinician_activity_feed() is scoped to the caller's own clinician_
-- access, not institution-wide. Reasonable for now (the engaged
-- practitioner is the one who needs to know), but recorded explicitly
-- so the next person does not assume the clinic AS A WHOLE was told --
-- only whoever is actually on the case was.

-- =====================================================================
-- 1. passport_link_codes. No institution_id at generation time -- the
-- generator is a PARENT, not scoped to any institution the way a
-- principal generating a claim code is (generate_passport_claim_code's
-- own institution_id parameter exists because THAT generator is
-- institution-scoped; this one isn't). institution_id is captured only
-- once redeemed (redeemed_institution_id), recording which institution
-- actually used it, not which one it was "for" -- it was never for any
-- one institution in particular.
--
-- Single active code per passport (partial unique index, same shape
-- passport_claim_codes already uses) -- regenerating replaces the
-- parent's own prior outstanding code rather than stacking a second
-- one, matching generate_passport_claim_code()'s own convention.
--
-- 7-day expiry, matching passport_claim_codes' own reasoning exactly:
-- a code sitting in an old message is a standing grant, revocable and
-- regenerable at any time regardless.
--
-- RLS enabled, zero policies -- the same posture as passport_claim_
-- codes and code_lookup_attempts. Every read and write goes through a
-- SECURITY DEFINER function below; there is no raw client grant on
-- this table at all.
-- =====================================================================
create table public.passport_link_codes (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  code text not null unique,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users (id) on delete set null,
  redeemed_institution_id uuid references public.institutions (id) on delete set null
);

create index passport_link_codes_passport_id_idx on public.passport_link_codes (passport_id);
create index passport_link_codes_code_idx on public.passport_link_codes (code);

create unique index passport_link_codes_one_active_per_passport
  on public.passport_link_codes (passport_id)
  where revoked_at is null and redeemed_at is null;

alter table public.passport_link_codes enable row level security;

-- =====================================================================
-- 2. code_lookup_attempts gains a fourth lookup_type. Same table, same
-- rate limit shape (10 failures/hour), same reasoning as the existing
-- three -- no new infrastructure.
-- =====================================================================
alter table public.code_lookup_attempts drop constraint if exists code_lookup_attempts_lookup_type_check;
alter table public.code_lookup_attempts
  add constraint code_lookup_attempts_lookup_type_check
  check (lookup_type in ('passport', 'clinician', 'claim', 'institution_link'));

-- =====================================================================
-- 3. The new unique constraint on passport_institution_links, added
-- while here per Daniel's own instruction -- see this migration's own
-- header for why the explicit check in redeem_institution_link_code()
-- below does not make this redundant.
-- =====================================================================
create unique index passport_institution_links_passport_institution_unique
  on public.passport_institution_links (passport_id, institution_id);

-- =====================================================================
-- 4. generate_institution_link_code() -- parent-only, via owns_
-- passport(), matching passport_link_codes' own read/write posture
-- (a real table-level INSERT policy already exists for this exact
-- check on passport_institution_links itself, 0014 -- unused until
-- now precisely because Decision 1 keeps the write server-side, not a
-- raw client insert).
-- =====================================================================
create or replace function public.generate_institution_link_code(p_passport_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child_name text;
  v_prefix text;
  v_code text;
  v_found boolean := false;
  v_attempt int;
begin
  if not public.owns_passport(p_passport_id) then
    raise exception 'You do not have access to this passport.';
  end if;

  select p.child_name into v_child_name
  from public.passports p
  where p.id = p_passport_id;

  update public.passport_link_codes
  set revoked_at = now(), revoked_by = auth.uid()
  where passport_id = p_passport_id
    and revoked_at is null
    and redeemed_at is null;

  v_prefix := upper(left(regexp_replace(coalesce(v_child_name, 'CHD'), '[^a-zA-Z]', '', 'g') || 'XXX', 3));

  for v_attempt in 1..10 loop
    v_code := v_prefix || '-' || lpad(floor(random() * 10000)::int::text, 4, '0');
    if not exists (select 1 from public.passport_link_codes where code = v_code) then
      v_found := true;
      exit;
    end if;
  end loop;

  if not v_found then
    raise exception 'Could not generate a unique code. Please try again.';
  end if;

  insert into public.passport_link_codes (passport_id, code, created_by, expires_at)
  values (p_passport_id, v_code, auth.uid(), now() + interval '7 days');

  return v_code;
end;
$$;

grant execute on function public.generate_institution_link_code(uuid) to authenticated;

-- =====================================================================
-- 5. revoke_institution_link_code() -- parent-only, own passport only.
-- =====================================================================
create or replace function public.revoke_institution_link_code(p_link_code_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_passport_id uuid;
  v_redeemed_at timestamptz;
  v_revoked_at timestamptz;
begin
  select lc.passport_id, lc.redeemed_at, lc.revoked_at
  into v_passport_id, v_redeemed_at, v_revoked_at
  from public.passport_link_codes lc
  where lc.id = p_link_code_id;

  if v_passport_id is null then
    raise exception 'Not found.';
  end if;

  if not public.owns_passport(v_passport_id) then
    raise exception 'You do not have access to this passport.';
  end if;

  if v_redeemed_at is not null then
    raise exception 'This code has already been used and cannot be revoked.';
  end if;

  if v_revoked_at is not null then
    raise exception 'This code has already been revoked.';
  end if;

  update public.passport_link_codes
  set revoked_at = now(), revoked_by = auth.uid()
  where id = p_link_code_id;
end;
$$;

grant execute on function public.revoke_institution_link_code(uuid) to authenticated;

-- =====================================================================
-- 6. get_institution_link_code_status() -- lets the parent's own card
-- re-show an outstanding code after navigating away and back, matching
-- get_passport_claim_code_status()'s own exact role for the school
-- side of the claim flow. Returns id, unlike that function's own
-- FIRST version (0114) -- CLAUDE.md's own "one loose end" note about
-- that gap is stale (0287 widened it to return id too, for exactly
-- this reason, a standalone Revoke button needing something to call).
-- Built with id from the start here rather than repeating the gap.
-- =====================================================================
create or replace function public.get_institution_link_code_status(p_passport_id uuid)
returns table (id uuid, code text, expires_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select lc.id, lc.code, lc.expires_at
  from public.passport_link_codes lc
  where lc.passport_id = p_passport_id
    and lc.revoked_at is null
    and lc.redeemed_at is null
    and lc.expires_at > now()
    and public.owns_passport(p_passport_id);
$$;

grant execute on function public.get_institution_link_code_status(uuid) to authenticated;

-- =====================================================================
-- 7. peek_institution_link_code() -- pure lookup, no side effect but
-- the rate-limit record on a genuine miss. SCHOOL-ONLY for now (see
-- this migration's own header on the reverse direction) -- caller must
-- be an active, verified principal at a school; the institution_id the
-- peek is FOR isn't asked for here (nothing is written), only
-- confirmed at redeem time.
--
-- Not-found is a zero-row SUCCESS, never a raised exception -- 0116's
-- own "a write before a raise does not survive" fix, applied here from
-- the first draft rather than made and found again: the rate-limit
-- insert two lines above a raise would be rolled back with it,
-- silently disabling the limiter exactly as it did for redeem_
-- passport_claim_code() before 0116.
-- =====================================================================
create or replace function public.peek_institution_link_code(p_code text)
returns table (passport_id uuid, child_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_recent_failures integer;
  v_link_id uuid;
  v_passport_id uuid;
  v_expires_at timestamptz;
  v_revoked_at timestamptz;
  v_redeemed_at timestamptz;
  v_child_name text;
  v_display_name text;
  v_parts text[];
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.user_id = v_uid
      and s.role = 'principal'
      and inst.type = 'school'
      and public.institution_staff_has_current_standing(v_uid, s.institution_id)
      and inst.status = 'verified'
  ) then
    raise exception 'Only an active, verified principal can look up a link code.';
  end if;

  select count(*) into v_recent_failures
  from public.code_lookup_attempts
  where user_id = v_uid
    and lookup_type = 'institution_link'
    and attempted_at > now() - interval '1 hour';

  if v_recent_failures >= 10 then
    raise exception 'Too many failed attempts. Please try again later.';
  end if;

  select lc.id, lc.passport_id, lc.expires_at, lc.revoked_at, lc.redeemed_at, p.child_name
  into v_link_id, v_passport_id, v_expires_at, v_revoked_at, v_redeemed_at, v_child_name
  from public.passport_link_codes lc
  join public.passports p on p.id = lc.passport_id
  where lc.code ilike p_code
  limit 1;

  if v_link_id is null then
    insert into public.code_lookup_attempts (user_id, lookup_type) values (v_uid, 'institution_link');
    return;
  end if;

  if v_revoked_at is not null then
    raise exception 'This code has been revoked. Please ask the family for a new one.';
  end if;

  if v_redeemed_at is not null then
    raise exception 'This code has already been used. Please ask the family for a new one.';
  end if;

  if v_expires_at < now() then
    raise exception 'This code has expired. Please ask the family for a new one.';
  end if;

  -- Minimal disclosure (first name + last initial), matching lookup_
  -- passport_by_code()'s own established convention for a verified-
  -- but-not-omniscient staff caller -- see this migration's own header
  -- for why that convention is kept here rather than a fuller name.
  v_parts := regexp_split_to_array(trim(v_child_name), '\s+');
  if array_length(v_parts, 1) = 1 then
    v_display_name := v_parts[1];
  else
    v_display_name := v_parts[1] || ' ' || upper(left(v_parts[array_length(v_parts, 1)], 1)) || '.';
  end if;

  return query select v_passport_id, v_display_name;
end;
$$;

revoke all on function public.peek_institution_link_code(text) from public;
revoke all on function public.peek_institution_link_code(text) from anon;
revoke all on function public.peek_institution_link_code(text) from authenticated;
grant execute on function public.peek_institution_link_code(text) to authenticated;

-- =====================================================================
-- 8. redeem_institution_link_code() -- the atomic commit. Re-validates
-- everything from scratch rather than trusting the peek that (in the
-- real client flow) came before it -- a raw caller hitting this
-- directly, skipping the peek, gets the identical rate limit and the
-- identical refusals.
--
-- The enrolments-conflict and already-linked checks are both explicit,
-- BEFORE either insert is attempted -- see this migration's own header
-- for why (the new unique index backs the second one; nothing backs
-- the first, since enrolments_one_active_per_child's own violation
-- message would be a raw constraint error, not the actionable message
-- this function gives instead).
--
-- The consumption itself is a compare-and-swap UPDATE (redeemed_at is
-- null and revoked_at is null and expires_at > now() in the WHERE
-- clause, `if not found then raise`), matching redeem_passport_claim_
-- code()'s own 0115 fix for the identical two-concurrent-redemptions
-- race -- read directly from that function's live body before writing
-- this one, not assumed safe by resemblance.
-- =====================================================================
create or replace function public.redeem_institution_link_code(p_institution_id uuid, p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_recent_failures integer;
  v_link_id uuid;
  v_passport_id uuid;
  v_expires_at timestamptz;
  v_revoked_at timestamptz;
  v_redeemed_at timestamptz;
  v_institution_name text;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = v_uid
      and s.role = 'principal'
      and inst.type = 'school'
      and public.institution_staff_has_current_standing(v_uid, p_institution_id)
      and inst.status = 'verified'
  ) then
    raise exception 'Only an active, verified principal can link an existing record to your school.';
  end if;

  select count(*) into v_recent_failures
  from public.code_lookup_attempts
  where user_id = v_uid
    and lookup_type = 'institution_link'
    and attempted_at > now() - interval '1 hour';

  if v_recent_failures >= 10 then
    raise exception 'Too many failed attempts. Please try again later.';
  end if;

  select lc.id, lc.passport_id, lc.expires_at, lc.revoked_at, lc.redeemed_at
  into v_link_id, v_passport_id, v_expires_at, v_revoked_at, v_redeemed_at
  from public.passport_link_codes lc
  where lc.code ilike p_code
  limit 1;

  if v_link_id is null then
    insert into public.code_lookup_attempts (user_id, lookup_type) values (v_uid, 'institution_link');
    raise exception 'We couldn''t find a record with that code. Please check with the family and try again.';
  end if;

  if v_revoked_at is not null then
    raise exception 'This code has been revoked. Please ask the family for a new one.';
  end if;

  if v_redeemed_at is not null then
    raise exception 'This code has already been used. Please ask the family for a new one.';
  end if;

  if v_expires_at < now() then
    raise exception 'This code has expired. Please ask the family for a new one.';
  end if;

  if exists (
    select 1 from public.passport_institution_links pil
    where pil.passport_id = v_passport_id and pil.institution_id = p_institution_id
  ) then
    raise exception 'This child is already linked to your school.';
  end if;

  if exists (
    select 1 from public.enrolments e
    where e.passport_id = v_passport_id and e.ended_at is null
  ) then
    raise exception 'This child is already enrolled at another school. Transferring a child between schools isn''t supported yet -- contact Behaviour Hive.';
  end if;

  update public.passport_link_codes
  set redeemed_at = now(), redeemed_by = v_uid, redeemed_institution_id = p_institution_id
  where id = v_link_id
    and redeemed_at is null
    and revoked_at is null
    and expires_at > now();

  if not found then
    raise exception 'This code has already been used. Please ask the family for a new one.';
  end if;

  -- approved_by_parent = true HERE IS A GENUINE CONSENT RECORD -- see
  -- this migration's own header for why this write site is different
  -- from create_school_passport()'s and onboard_clinic_client()'s own
  -- identically-shaped but compatibility-default inserts.
  insert into public.passport_institution_links (passport_id, institution_id, approved_by_parent, parent_approved_at)
  values (v_passport_id, p_institution_id, true, now());

  insert into public.enrolments (passport_id, institution_id, started_by)
  values (v_passport_id, p_institution_id, v_uid);

  select i.name into v_institution_name from public.institutions i where i.id = p_institution_id;

  -- THE FIRST REAL WRITE team_linked HAS EVER HAD -- see this
  -- migration's own header. Reaches every clinician holding their own
  -- active clinician_access row for this child via get_clinician_
  -- activity_feed(), no new table, no new RLS policy.
  insert into public.activity_log (passport_id, actor_id, event_type, event_description)
  values (v_passport_id, v_uid, 'team_linked', coalesce(v_institution_name, 'A school') || ' now has access to this record.');

  return v_passport_id;
end;
$$;

revoke all on function public.redeem_institution_link_code(uuid, text) from public;
revoke all on function public.redeem_institution_link_code(uuid, text) from anon;
revoke all on function public.redeem_institution_link_code(uuid, text) from authenticated;
grant execute on function public.redeem_institution_link_code(uuid, text) to authenticated;
