-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- FOLLOW-UP TO THE ITEM-2 SWEEP (25 Sept 2026, recorded against this
-- schema's own "A WRITE BEFORE A RAISE DOES NOT SURVIVE" entry). Two
-- live functions found doing the exact bug 0116 already fixed once for
-- redeem_passport_claim_code(): insert a row into code_lookup_attempts
-- (the rate-limiter's own audit table) immediately before raising an
-- exception -- since PostgREST wraps each RPC call in exactly one
-- transaction, the raise rolls back the insert two lines above it,
-- every time, so the table this rate limiter counts from never
-- actually accumulates a row for either lookup_type. The limit has
-- been permanently inert for both functions since the day each shipped.
--
-- THE FIX, matching 0116's own proven pattern exactly: the "not found"
-- branch changes shape from throw-an-exception to return-a-negative-
-- result, so the insert survives. Every OTHER raise in both functions
-- (revoked/redeemed/expired/already-linked/wrong-role/etc.) is left
-- completely untouched -- none of them have a preceding write to
-- protect, and rolling those back on failure is correct, not a loss.
--
-- 1. lookup_clinician_by_code() -- no return-type change needed. It
--    already returns table (id, user_id, full_name, specialty); a
--    plain `return;` on the not-found branch yields zero rows, the
--    exact shape its own two real client callers (GrantClinicianAccess
--    Sheet.tsx, ClinicianCoverageDetail.tsx) ALREADY handle correctly
--    today -- both already check `data?.[0] ?? null` and show the
--    identical friendly "We couldn't find a clinician with that code"
--    message on an empty result, confirmed by reading both files
--    directly before writing this migration. Neither caller needs a
--    single line changed.
--
-- 2. redeem_institution_link_code() -- a genuine return-contract
--    change, DROP FUNCTION IF EXISTS then CREATE FUNCTION fresh, per
--    this schema's own standing rule for a return-shape change (a bare
--    CREATE OR REPLACE FUNCTION cannot change a function's return
--    type; Postgres refuses it outright). `returns uuid` (scalar)
--    becomes `returns table (passport_id uuid)` -- matching its own
--    sibling peek_institution_link_code()'s already-correct shape
--    exactly, rather than inventing a new "return null on failure"
--    idiom this schema doesn't otherwise use for this class of
--    function. Confirmed via grep: exactly one real client caller
--    anywhere in src/, principal/passports/enrol/page.tsx's own
--    handleConfirm() -- updated in the same commit as this migration
--    to read the new table shape, mirroring handlePeek()'s own already-
--    correct zero-rows-means-not-found handling three lines above it
--    in the same file.

create or replace function public.lookup_clinician_by_code(code text)
returns table (
  id uuid,
  user_id uuid,
  full_name text,
  specialty text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_recent_failures integer;
  v_id uuid;
  v_clinician_user_id uuid;
  v_full_name text;
  v_specialty text;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  select count(*) into v_recent_failures
  from public.code_lookup_attempts
  where public.code_lookup_attempts.user_id = v_uid
    and lookup_type = 'clinician'
    and attempted_at > now() - interval '1 hour';

  if v_recent_failures >= 10 then
    raise exception 'Too many failed lookups. Please try again later.';
  end if;

  select c.id, c.user_id, c.full_name, c.specialty
  into v_id, v_clinician_user_id, v_full_name, v_specialty
  from public.clinicians c
  where c.clinician_code = code
    and public.is_verified_clinician(c.user_id);

  if v_id is null then
    insert into public.code_lookup_attempts (user_id, lookup_type) values (v_uid, 'clinician');
    -- THE FIX: a normal zero-row return, not an exception -- an
    -- exception here would roll back the insert immediately above it,
    -- silently disabling the rate limiter. Matches 0116's own fix for
    -- redeem_passport_claim_code() and this file's own original
    -- lookup_passport_by_code() (0034) precedent exactly.
    return;
  end if;

  return query select v_id, v_clinician_user_id, v_full_name, v_specialty;
end;
$$;

grant execute on function public.lookup_clinician_by_code(text) to authenticated;

-- ============================================================

drop function if exists public.redeem_institution_link_code(uuid, text);

create function public.redeem_institution_link_code(p_institution_id uuid, p_code text)
returns table (passport_id uuid)
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
  v_institution_type text;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  select inst.type into v_institution_type from public.institutions inst where inst.id = p_institution_id;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = v_uid
      and public.institution_staff_has_current_standing(v_uid, p_institution_id)
      and inst.status = 'verified'
      and (
        (inst.type = 'school' and s.role = 'principal')
        or (inst.type = 'respite_centre' and s.role = 'centre_manager')
      )
  ) then
    raise exception 'Only an active, verified principal or centre manager can link an existing record to your organisation.';
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
    -- THE FIX: a normal zero-row return, not an exception -- matching
    -- peek_institution_link_code()'s own already-correct shape two
    -- functions above this one in the same migration file (0297),
    -- and 0116's own established pattern for this exact class of bug.
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

  if exists (
    select 1 from public.passport_institution_links pil
    where pil.passport_id = v_passport_id and pil.institution_id = p_institution_id
  ) then
    raise exception 'This child is already linked to your organisation.';
  end if;

  -- School-specific: enrolments_one_active_per_child is a GLOBAL
  -- uniqueness constraint, so a school redemption must refuse an
  -- already-enrolled-elsewhere child explicitly (0294's own reasoning,
  -- unchanged). Respite has no equivalent global constraint -- decision
  -- 2 leaves episodes_of_care's own per-institution scoping exactly as
  -- it is -- so the respite check below is narrower: only refuse an
  -- ALREADY-ACTIVE placement at THIS SAME centre, matching reopen_
  -- clinic_episode()'s own identical check.
  if v_institution_type = 'school' then
    if exists (
      select 1 from public.enrolments e
      where e.passport_id = v_passport_id and e.ended_at is null
    ) then
      raise exception 'This child is already enrolled at another school. Transferring a child between schools isn''t supported yet -- contact Behaviour Hive.';
    end if;
  elsif v_institution_type = 'respite_centre' then
    if exists (
      select 1 from public.episodes_of_care e
      where e.passport_id = v_passport_id and e.institution_id = p_institution_id and e.ended_at is null
    ) then
      raise exception 'This client already has an active placement at your centre.';
    end if;
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

  -- approved_by_parent = true HERE IS A GENUINE CONSENT RECORD -- 0294's
  -- own reasoning, unchanged: a parent generated (or, per decision 4,
  -- a clinic generated on a family it already has standing with) the
  -- code that authorises this exact link.
  insert into public.passport_institution_links (passport_id, institution_id, approved_by_parent, parent_approved_at)
  values (v_passport_id, p_institution_id, true, now());

  select i.name into v_institution_name from public.institutions i where i.id = p_institution_id;

  if v_institution_type = 'school' then
    insert into public.enrolments (passport_id, institution_id, started_by)
    values (v_passport_id, p_institution_id, v_uid);

    -- team_linked, byte-identical to 0294's own write -- reaches every
    -- clinician holding active clinician_access for this child, via
    -- get_clinician_activity_feed(), and (an already-live, unremarked
    -- side effect of the denylist shape decision 5's own header
    -- explains) the parent's own feed too, since get_parent_activity_
    -- feed() never excluded this type either.
    insert into public.activity_log (passport_id, actor_id, event_type, event_description)
    values (v_passport_id, v_uid, 'team_linked', coalesce(v_institution_name, 'A school') || ' now has access to this record.');
  elsif v_institution_type = 'respite_centre' then
    insert into public.episodes_of_care (passport_id, institution_id, started_by)
    values (v_passport_id, p_institution_id, v_uid);

    -- respite_centre_linked -- decision 5's own new event type,
    -- PARENT-facing (there is no "engaged clinician" audience for a
    -- respite link the way team_linked has one). Reaches the parent's
    -- own activity feed via the same denylist mechanism, zero RPC
    -- change needed -- confirmed by reading get_parent_activity_feed()
    -- directly. Reaches NOBODY if the passport has never been claimed
    -- (no passport_guardians row, owns_passport() false for everyone)
    -- -- see this migration's own header for why that is a real,
    -- disclosed precondition, not a silent gap.
    insert into public.activity_log (passport_id, actor_id, event_type, event_description)
    values (v_passport_id, v_uid, 'respite_centre_linked', coalesce(v_institution_name, 'A respite centre') || ' now has access to this record.');
  end if;

  return query select v_passport_id;
end;
$$;

revoke all on function public.redeem_institution_link_code(uuid, text) from public;
revoke all on function public.redeem_institution_link_code(uuid, text) from anon;
revoke all on function public.redeem_institution_link_code(uuid, text) from authenticated;
grant execute on function public.redeem_institution_link_code(uuid, text) to authenticated;
