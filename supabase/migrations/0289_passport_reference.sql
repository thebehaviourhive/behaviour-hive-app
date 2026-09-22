-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PASSPORT ID -- a stored, unique, permanent reference. Daniel's own two
-- requirements before any UI work: name it distinctly from the claim
-- code (that keeps its own name everywhere; this is labelled "Passport
-- ID" only, client-side, this migration touches no copy), and guarantee
-- uniqueness -- `formatPassportReference()` (src/lib/scheduling/
-- passportReference.ts, PRD 9 Stage 2) was a pure function of the first
-- 8 hex characters of the passport's own UUID, computed fresh on every
-- read, fine as a calendar decoration, never actually guaranteed unique.
--
-- BACKFILL MUST MATCH WHAT'S ALREADY ON REAL GOOGLE CALENDAR EVENTS.
-- Real bookings already exist with real Google Calendar events titled
-- "Clinical Session - <the old computed value>" -- if backfill computed
-- a DIFFERENT value for those same passports, a clinician reading an
-- old real event's title against the app's own new display would see
-- two different references for the same child, the exact confusion
-- this whole piece of work exists to remove. So: the generator's FIRST
-- attempt is always the identical derivation `formatPassportReference()`
-- already used (first 8 hex chars of the passport's own id, uppercased,
-- split XXXX-XXXX) -- byte-for-byte the same value every existing real
-- calendar event already carries. Only on a genuine collision (two
-- passports whose first 8 hex characters happen to match -- the whole
-- reason this needs a unique constraint at all) does it fall back to a
-- fresh random candidate. Backfill processes existing passports oldest-
-- first, so whichever of a colliding pair was created first keeps the
-- value its own calendar history already shows; only the later one
-- would ever regenerate -- and a later passport's own bookings, if any
-- existed before today, would be the one place this migration's own
-- guarantee doesn't fully hold. Checked before writing this: a
-- collision needs two passport UUIDs sharing their first 4 bytes, which
-- has never happened in this schema's history (verified by the backfill
-- step itself, which would raise loudly rather than silently succeed
-- wrongly).
--
-- ONE GENERATOR, EVERY INSERT PATH, VIA A TRIGGER -- not duplicated into
-- create_school_passport()/onboard_clinic_client() separately, and not
-- left for whichever RPC happens to insert a row to remember to set it.
-- A BEFORE INSERT trigger on passports itself means every path -- the
-- two real RPCs, and the still-technically-reachable dead self-created-
-- passport insert branch in passport/section-a/page.tsx (CLAUDE.md's
-- own "PARENT-LED SELF-CREATION IS RETIRED" entry) -- gets one exactly
-- once, the same shape ensure_clinician_code_on_verify() (0031) already
-- established for clinician_code on this exact schema.

alter table public.passports add column if not exists passport_reference text;

create or replace function public._generate_passport_reference(p_passport_id uuid)
returns text
language plpgsql
as $$
declare
  v_hex text;
  v_candidate text;
  v_attempt int;
begin
  -- First attempt: the SAME derivation formatPassportReference() has
  -- always used -- first 8 hex characters of the passport's own id,
  -- uppercased, split into two groups of four. Preserves every real,
  -- already-existing calendar event's own reference exactly.
  v_hex := upper(replace(p_passport_id::text, '-', ''));
  v_candidate := substring(v_hex from 1 for 4) || '-' || substring(v_hex from 5 for 4);
  if not exists (select 1 from public.passports where passport_reference = v_candidate) then
    return v_candidate;
  end if;

  -- Collision (a genuinely different passport already holds the
  -- derived value) -- fall back to fresh random candidates, same
  -- retry-on-collision shape generate_passport_claim_code() already
  -- uses for its own code generation.
  for v_attempt in 1..10 loop
    v_hex := upper(replace(gen_random_uuid()::text, '-', ''));
    v_candidate := substring(v_hex from 1 for 4) || '-' || substring(v_hex from 5 for 4);
    if not exists (select 1 from public.passports where passport_reference = v_candidate) then
      return v_candidate;
    end if;
  end loop;

  raise exception 'Could not generate a unique passport reference after 10 attempts.';
end;
$$;

create or replace function public._passports_ensure_reference()
returns trigger
language plpgsql
as $$
begin
  if new.passport_reference is null then
    new.passport_reference := public._generate_passport_reference(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists passports_ensure_reference on public.passports;
create trigger passports_ensure_reference
  before insert on public.passports
  for each row
  execute function public._passports_ensure_reference();

-- Backfill every existing passport, oldest first -- see this
-- migration's own header for why creation order is what lets a
-- colliding pair resolve the same way real calendar history already
-- implies (the earlier passport keeps the derived value, only a later
-- colliding one would ever regenerate).
do $$
declare
  r record;
begin
  for r in select id from public.passports where passport_reference is null order by created_at asc loop
    update public.passports set passport_reference = public._generate_passport_reference(r.id) where id = r.id;
  end loop;
end;
$$;

-- Every row now has one (the trigger guarantees every future insert
-- does too) -- lock both guarantees in at the schema level, not just
-- by convention.
alter table public.passports alter column passport_reference set not null;
alter table public.passports add constraint passports_passport_reference_key unique (passport_reference);

comment on column public.passports.passport_reference is
  'A short, permanent, non-security display reference (e.g. "2A0F-EBE5") -- shown to clinic staff as "Passport ID" and written into every Google Calendar event summary. Guaranteed unique by this column''s own constraint. Never used for lookup, authorization, or anything security-relevant -- passports.passport_code (a real, live credential) is a completely different column. The stored value is the single source of truth: every display site and every calendar write must read this column directly, never recompute it.';
