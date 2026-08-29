-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 1, Stage 5, Step 2 -- the claim flow. A school creates a
-- guardian-less passport (Step 1, create_school_passport()); this step
-- adds how a real guardian ends up connected to it: a principal
-- generates a short-lived code, a parent redeems it, one atomic RPC
-- does the lookup-validate-consume-insert, exactly as discussed. Plus
-- get_my_passports() -- the single resolver Step 3 migrates ten of the
-- fourteen affected client screens onto, replacing fourteen independent
-- copies of the same now-wrong assumption with one.
--
-- REUSED, NOT REINVENTED, per instruction: the rate limiter
-- (code_lookup_attempts, migration 0034) gets a third lookup_type
-- ('claim') rather than a new table; the minimal-disclosure return
-- shape (first name + last initial) is lookup_passport_by_code()'s own
-- convention, reimplemented here the same way it already was there.
--
-- NOT REUSED, deliberately: passports.passport_code and its own
-- passport_code_active column. That code is parent-generated,
-- permanent, no expiry, and grants a teacher dashboard-visibility
-- access at most (passport_access). This one grants OWNERSHIP, which
-- is a different security tier entirely -- its own table
-- (passport_claim_codes), its own expiry, its own revoke path that
-- actually exists (passport_code_active has never had a client write
-- path at all).
--
-- 7-DAY EXPIRY, not 14: a code sitting in an old email is a standing
-- grant of ownership to whoever has the message. Revocable and
-- regenerable at any time by the principal regardless -- the cost of a
-- lapsed code is one tap, the cost of a stale one is not.

-- =====================================================================
-- 1. passport_claim_codes. institution_id is captured explicitly at
-- generation time (not derived from passport_institution_links when
-- needed later) -- the same shape as passport_access's own
-- institution_id column, and for the identical reason: a passport can
-- be linked to more than one institution at once (Stage 4's CHECK DD),
-- and generate/revoke/status below all need to scope to the CALLER'S
-- own institution, never "any institution this passport happens to be
-- linked to".
--
-- The partial unique index enforces "one active code per passport" at
-- the database level, not just procedurally in
-- generate_passport_claim_code() -- defense in depth against a race
-- between two concurrent generate calls, the same posture
-- passport_access_passport_teacher_unique already takes elsewhere in
-- this schema.
--
-- RLS enabled, zero policies -- the same posture as
-- code_lookup_attempts and passport_guardians. Every read and write
-- goes through a SECURITY DEFINER function below; there is no raw
-- client grant on this table at all.
-- =====================================================================
create table public.passport_claim_codes (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  institution_id uuid not null references public.institutions (id) on delete cascade,
  code text not null unique,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  claimed_at timestamptz,
  claimed_by uuid references auth.users (id) on delete set null
);

create index passport_claim_codes_passport_id_idx on public.passport_claim_codes (passport_id);
create index passport_claim_codes_code_idx on public.passport_claim_codes (code);

create unique index passport_claim_codes_one_active_per_passport
  on public.passport_claim_codes (passport_id)
  where revoked_at is null and claimed_at is null;

alter table public.passport_claim_codes enable row level security;

-- =====================================================================
-- 2. code_lookup_attempts gains a third lookup_type. Same table, same
-- rate limit shape (10 failures/hour), same reasoning as the existing
-- two -- no new infrastructure.
-- =====================================================================
alter table public.code_lookup_attempts drop constraint if exists code_lookup_attempts_lookup_type_check;
alter table public.code_lookup_attempts
  add constraint code_lookup_attempts_lookup_type_check
  check (lookup_type in ('passport', 'clinician', 'claim'));

-- =====================================================================
-- 3. generate_passport_claim_code() -- principal-only, only for a
-- passport with zero guardians (already-claimed passports aren't this
-- RPC's job), scoped to the caller's own institution's link to the
-- child (mirrors grant_passport_access()'s own authorization shape,
-- migration 0111).
--
-- Regenerating replaces the caller's OWN prior outstanding code rather
-- than stacking a second one. If a DIFFERENT institution already has an
-- active code outstanding for the same passport (both linked to the
-- same child, neither has claimed it yet -- rare, but CHECK DD proved
-- it's possible), this refuses rather than silently revoking a code it
-- didn't issue -- the exact caution Stage 4 Step 2 applied to
-- cross-institution reactivation (EE-5b), applied here before it could
-- ever ship wrong.
--
-- Code format matches generatePassportCode.ts's own convention (3-
-- letter name-derived prefix + 4 digits) for UI familiarity, but
-- generated server-side into passport_claim_codes' own, separate
-- namespace -- never checked against or written to passports.
-- passport_code.
-- =====================================================================
create or replace function public.generate_passport_claim_code(p_institution_id uuid, p_passport_id uuid)
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
    raise exception 'Only an active, verified principal can generate a claim code.';
  end if;

  select p.child_name into v_child_name
  from public.passports p
  where p.id = p_passport_id
    and exists (
      select 1 from public.passport_institution_links pil
      where pil.passport_id = p.id and pil.institution_id = p_institution_id
    );

  if v_child_name is null then
    raise exception 'This child has no link to your institution.';
  end if;

  if exists (select 1 from public.passport_guardians g where g.passport_id = p_passport_id) then
    raise exception 'This passport already has a guardian and cannot be claimed again.';
  end if;

  if exists (
    select 1 from public.passport_claim_codes cc
    where cc.passport_id = p_passport_id
      and cc.revoked_at is null
      and cc.claimed_at is null
      and cc.institution_id <> p_institution_id
  ) then
    raise exception 'A claim code for this child was already issued by a different school. Ask them to revoke it first.';
  end if;

  update public.passport_claim_codes
  set revoked_at = now(), revoked_by = auth.uid()
  where passport_id = p_passport_id
    and institution_id = p_institution_id
    and revoked_at is null
    and claimed_at is null;

  v_prefix := upper(left(regexp_replace(coalesce(v_child_name, 'CHD'), '[^a-zA-Z]', '', 'g') || 'XXX', 3));

  for v_attempt in 1..10 loop
    v_code := v_prefix || '-' || lpad(floor(random() * 10000)::int::text, 4, '0');
    if not exists (select 1 from public.passport_claim_codes where code = v_code) then
      v_found := true;
      exit;
    end if;
  end loop;

  if not v_found then
    raise exception 'Could not generate a unique code. Please try again.';
  end if;

  insert into public.passport_claim_codes (passport_id, institution_id, code, created_by, expires_at)
  values (p_passport_id, p_institution_id, v_code, auth.uid(), now() + interval '7 days');

  return v_code;
end;
$$;

grant execute on function public.generate_passport_claim_code(uuid, uuid) to authenticated;

-- =====================================================================
-- 4. revoke_passport_claim_code() -- scoped to the SAME institution
-- that generated it (re-checked from the row itself, not trusted from
-- the caller), same reasoning as EE-4c's cross-institution revoke
-- refusal for passport_access.
-- =====================================================================
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
  where id = p_claim_code_id;
end;
$$;

grant execute on function public.revoke_passport_claim_code(uuid) to authenticated;

-- =====================================================================
-- 5. redeem_passport_claim_code() -- the atomic lookup-validate-
-- consume-insert. Rate-limiting mirrors lookup_passport_by_code()'s own
-- distinction exactly: a genuinely WRONG code (no match at all)
-- increments the failure counter; a code that's found but revoked,
-- claimed, or expired does NOT -- that's an honest but stale value, not
-- a guessing attempt, the same distinction 0034 already drew for
-- passport_code_active = false.
--
-- Writes passport_guardians directly -- never passports.user_id. The
-- dual-write trigger (0113) is a bridge for OLD callers that still set
-- user_id; this is a genuinely new write path, and per that migration's
-- own CLAUDE.md entry, new write paths write passport_guardians
-- directly.
-- =====================================================================
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

  insert into public.passport_guardians (passport_id, user_id) values (v_passport_id, v_uid);

  update public.passport_claim_codes
  set claimed_at = now(), claimed_by = v_uid
  where id = v_claim_id;

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

-- =====================================================================
-- 6. get_my_passports() -- the single resolver. Every passport the
-- caller is a guardian of, via passport_guardians (which the 0113
-- dual-write trigger keeps populated for ordinary self-created
-- passports too, so this covers BOTH origins identically -- a parent
-- who signed up the ordinary way and a parent who claimed a
-- school-created passport are indistinguishable to this function,
-- exactly as they should be). Returns a LIST, not maybeSingle() -- Step
-- 3 migrates the ten call sites named in CLAUDE.md's own bug entry onto
-- this, which is what actually fixes the single-child assumption those
-- fourteen queries currently share, not just the guardian-visibility
-- gap.
-- =====================================================================
create or replace function public.get_my_passports()
returns table (passport_id uuid, child_name text)
language sql
security definer
set search_path = public
stable
as $$
  select g.passport_id, p.child_name
  from public.passport_guardians g
  join public.passports p on p.id = g.passport_id
  where g.user_id = auth.uid()
  order by p.child_name;
$$;

grant execute on function public.get_my_passports() to authenticated;

-- =====================================================================
-- 7. get_passport_claim_code_status() -- lets the principal's detail
-- page re-show an outstanding code after navigating away and back,
-- rather than only ever showing it once at generation time. Zero rows
-- means "no outstanding code" (never generated, or already
-- claimed/revoked/expired) -- the client shows "Generate Code" in that
-- state.
-- =====================================================================
create or replace function public.get_passport_claim_code_status(p_institution_id uuid, p_passport_id uuid)
returns table (code text, expires_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select cc.code, cc.expires_at
  from public.passport_claim_codes cc
  where cc.passport_id = p_passport_id
    and cc.institution_id = p_institution_id
    and cc.revoked_at is null
    and cc.claimed_at is null
    and cc.expires_at > now()
    and exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and s.deactivated_at is null
        and s.approved_at is not null
        and inst.status = 'verified'
    );
$$;

grant execute on function public.get_passport_claim_code_status(uuid, uuid) to authenticated;

-- =====================================================================
-- 8. get_passport_guardians_for_child() -- what replaces the Claim Code
-- section on the principal's detail page once a code is actually
-- redeemed (Step 0's own point 4: "the section vanishes" is not a
-- designed state). claimed_at falls back to the guardian row's own
-- created_at for a guardian who was never claim-code-derived at all
-- (an ordinary self-created passport, or the rare case of a passport
-- created the old way that a school also happens to have a roster link
-- to) -- both origins render sensibly, not just the claim-flow one.
-- =====================================================================
create or replace function public.get_passport_guardians_for_child(p_institution_id uuid, p_passport_id uuid)
returns table (user_id uuid, full_name text, claimed_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select
    g.user_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    coalesce(cc.claimed_at, g.created_at) as claimed_at
  from public.passport_guardians g
  join auth.users u on u.id = g.user_id
  left join public.passport_claim_codes cc on cc.passport_id = g.passport_id and cc.claimed_by = g.user_id
  where g.passport_id = p_passport_id
    and exists (
      select 1 from public.passport_institution_links pil
      where pil.passport_id = p_passport_id and pil.institution_id = p_institution_id
    )
    and exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and s.deactivated_at is null
        and s.approved_at is not null
        and inst.status = 'verified'
    )
  order by claimed_at asc nulls last;
$$;

grant execute on function public.get_passport_guardians_for_child(uuid, uuid) to authenticated;
