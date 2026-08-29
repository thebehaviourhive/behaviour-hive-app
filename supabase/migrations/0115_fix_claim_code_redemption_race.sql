-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Bug fix, found while designing the redemption-race check for
-- migration 0114 (the check itself, per instruction, before Step 3):
-- redeem_passport_claim_code() validated the code's state with a plain
-- SELECT, then separately INSERTed into passport_guardians and UPDATEd
-- claimed_at/claimed_by -- nothing re-checked, at write time, that the
-- code was STILL unclaimed. Two genuinely concurrent redemptions of the
-- same code would both pass the initial read (both see claimed_at IS
-- NULL), both succeed at inserting into passport_guardians (different
-- user_id each, no conflict there), and the second UPDATE would simply
-- overwrite the first's claimed_by -- two people end up guardians of
-- the same child, and the audit trail only shows one of them. This
-- shipped in 0114 and had no check exercising real concurrency, so
-- nothing caught it before now.
--
-- Fixed with the standard atomic pattern: the UPDATE itself is the
-- compare-and-swap, done BEFORE the guardian insert, gated on its own
-- row count -- not a prior SELECT's now-possibly-stale read. Postgres's
-- own row-level locking serializes this correctly under ordinary READ
-- COMMITTED (no isolation-level tuning needed): the second concurrent
-- UPDATE blocks on the row lock, then re-evaluates its WHERE clause
-- against the first transaction's now-committed result and finds
-- nothing to update. Whichever call's UPDATE actually matches is the
-- only one that proceeds to insert a guardian row; the other gets a
-- clean "already been used" refusal instead of silently losing the
-- attribution race.
--
-- revoke_passport_claim_code() gets the same WHERE-clause guard on its
-- own UPDATE for consistency, though the stakes there are much lower --
-- two concurrent revokes were never a double-grant risk, only a minor
-- revoked_by attribution race between two principals.

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

  -- Optimistic read: good, specific error messages for the ordinary
  -- single-caller case (not found / revoked / claimed / expired). This
  -- is NOT what guarantees correctness under concurrency -- the UPDATE
  -- below is.
  select cc.id, cc.passport_id, cc.expires_at, cc.revoked_at, cc.claimed_at, p.child_name
  into v_claim_id, v_passport_id, v_expires_at, v_revoked_at, v_claimed_at, v_child_name
  from public.passport_claim_codes cc
  join public.passports p on p.id = cc.passport_id
  where cc.code ilike p_code
  limit 1;

  if v_claim_id is null then
    insert into public.code_lookup_attempts (user_id, lookup_type) values (v_uid, 'claim');
    raise exception 'We couldn''t find a passport with that code. Please check with the school and try again.';
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

  -- THE ATOMIC CLAIM. Whichever concurrent caller's UPDATE actually
  -- matches (claimed_at still null, not revoked, not expired, all
  -- re-checked here against the current committed row, not the
  -- possibly-stale read above) is the only one that proceeds.
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

create or replace function public.revoke_passport_claim_code(p_claim_code_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_institution_id uuid;
  v_claimed_at timestamptz;
  v_revoked_at timestamptz;
begin
  select cc.institution_id, cc.claimed_at, cc.revoked_at
  into v_institution_id, v_claimed_at, v_revoked_at
  from public.passport_claim_codes cc
  where cc.id = p_claim_code_id;

  if v_institution_id is null then
    raise exception 'Not found.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = v_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) then
    raise exception 'Only an active, verified principal at the institution that issued this code can revoke it.';
  end if;

  if v_claimed_at is not null then
    raise exception 'This code has already been claimed and cannot be revoked.';
  end if;

  if v_revoked_at is not null then
    raise exception 'This code has already been revoked.';
  end if;

  update public.passport_claim_codes
  set revoked_at = now(), revoked_by = auth.uid()
  where id = p_claim_code_id
    and claimed_at is null
    and revoked_at is null;

  if not found then
    raise exception 'This code has already been claimed or revoked.';
  end if;
end;
$$;

grant execute on function public.revoke_passport_claim_code(uuid) to authenticated;
