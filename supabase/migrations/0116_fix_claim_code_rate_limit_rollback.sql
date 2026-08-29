-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Bug fix, found by a targeted diagnostic while building the rate-limit
-- checks the redemption-race fix (0115) was itself supposed to be
-- followed by: redeem_passport_claim_code()'s "not found" branch did
--   insert into code_lookup_attempts (...) values (...);
--   raise exception 'We couldn''t find a passport with that code...';
-- An uncaught exception in a PL/pgSQL function aborts the ENTIRE
-- transaction the call is running in -- PostgREST wraps each RPC call
-- in exactly one transaction, so raising here rolled back everything
-- done earlier in the SAME call, including the insert two lines above
-- it. Proved directly: 12 consecutive wrong-code attempts against a
-- fresh account, code_lookup_attempts stayed at 0 rows every single
-- time. The rate limiter has recorded zero failures since 0114
-- shipped -- unlimited brute-forcing of claim codes was live the whole
-- time, silently.
--
-- The ORIGINAL lookup_passport_by_code() (0034) never had this problem
-- -- its own "not found" branch does `insert ...; return;`, a normal
-- zero-row return, not an exception, specifically so the insert
-- survives. This fix does the same thing here: only the "not found"
-- branch changes shape (empty result instead of a thrown error) --
-- revoked/claimed/expired/already-a-guardian all still raise cleanly,
-- since none of them insert anything beforehand and have nothing to
-- lose from the rollback. The client-facing contract becomes: a thrown
-- error means revoked/claimed/expired/already-have-access/locked-out/
-- unauthenticated; a successful call with zero rows means "not found",
-- the same shape AddChildSheet.tsx already handles for
-- lookup_passport_by_code() today.

create or replace function public.redeem_passport_claim_code(p_code text)
returns table (passport_id uuid, child_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_recent_failures integer;
  v_claim_id uuid;
  v_passport_id uuid;
  v_expires_at timestamptz;
  v_revoked_at timestamptz;
  v_claimed_at timestamptz;
  v_child_name text;
  v_display_name text;
  v_parts text[];
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  select count(*) into v_recent_failures
  from public.code_lookup_attempts
  where user_id = v_uid
    and lookup_type = 'claim'
    and attempted_at > now() - interval '1 hour';

  if v_recent_failures >= 10 then
    raise exception 'Too many failed attempts. Please try again later.';
  end if;

  select cc.id, cc.passport_id, cc.expires_at, cc.revoked_at, cc.claimed_at, p.child_name
  into v_claim_id, v_passport_id, v_expires_at, v_revoked_at, v_claimed_at, v_child_name
  from public.passport_claim_codes cc
  join public.passports p on p.id = cc.passport_id
  where cc.code ilike p_code
  limit 1;

  if v_claim_id is null then
    insert into public.code_lookup_attempts (user_id, lookup_type) values (v_uid, 'claim');
    -- THE FIX: a normal zero-row return, not an exception -- an
    -- exception here would roll back the insert immediately above it,
    -- silently disabling the rate limiter, which is exactly what
    -- shipped in 0114/0115 and went undetected until a direct
    -- diagnostic proved code_lookup_attempts never actually grew.
    return;
  end if;

  if v_revoked_at is not null then
    raise exception 'This code has been revoked. Please ask the school for a new one.';
  end if;

  if v_claimed_at is not null then
    raise exception 'This code has already been used. Please ask the school for a new one.';
  end if;

  if v_expires_at < now() then
    raise exception 'This code has expired. Please ask the school for a new one.';
  end if;

  if exists (select 1 from public.passport_guardians g where g.passport_id = v_passport_id and g.user_id = v_uid) then
    raise exception 'You already have access to this passport.';
  end if;

  update public.passport_claim_codes
  set claimed_at = now(), claimed_by = v_uid
  where id = v_claim_id
    and claimed_at is null
    and revoked_at is null
    and expires_at > now();

  if not found then
    raise exception 'This code has already been used. Please ask the school for a new one.';
  end if;

  insert into public.passport_guardians (passport_id, user_id) values (v_passport_id, v_uid);

  v_parts := regexp_split_to_array(trim(v_child_name), '\s+');
  if array_length(v_parts, 1) = 1 then
    v_display_name := v_parts[1];
  else
    v_display_name := v_parts[1] || ' ' || upper(left(v_parts[array_length(v_parts, 1)], 1)) || '.';
  end if;

  return query select v_passport_id, v_display_name;
end;
$$;

revoke all on function public.redeem_passport_claim_code(text) from public;
revoke all on function public.redeem_passport_claim_code(text) from anon;
revoke all on function public.redeem_passport_claim_code(text) from authenticated;
grant execute on function public.redeem_passport_claim_code(text) to authenticated;
