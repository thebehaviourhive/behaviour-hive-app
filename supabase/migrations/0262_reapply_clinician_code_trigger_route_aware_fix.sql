-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- TIER 1, ITEM 6 OF THE CLINIC UI LAYER BUILD. 0237 already wrote this
-- exact fix and its migration file is sitting in supabase/migrations/
-- today -- but it never actually ran against the live database.
-- Confirmed live, empirically, immediately before writing this file: a
-- disposable clinicians row inserted with verification_status =
-- 'verified' and verification_route = 'organisation' still got a real,
-- non-null clinician_code generated (CL-53AB) -- the exact bug 0237
-- describes, reproduced on production today, 21 Sept 2026. Whatever
-- happened between 0237 being written and now, the function currently
-- live is still the pre-fix version with no verification_route
-- awareness at all.
--
-- This migration does nothing new -- it is byte-for-byte the same
-- `create or replace function public.ensure_clinician_code()` body
-- 0237 already specifies, run again under a fresh migration number so
-- it actually reaches the database this time. CREATE OR REPLACE is
-- idempotent, so running this is safe regardless of which version is
-- currently live.
--
-- CHECKED BEFORE WRITING, NOT ASSUMED: queried production directly for
-- clinicians.verification_route = 'organisation' and clinician_code is
-- not null -- zero real rows (only the disposable test fixture from
-- this same verification pass, created and torn down as part of
-- confirming the bug, never a real account). No backfill needed here
-- either -- a pure forward fix, same as 0237 intended.
-- ===========================================================================

create or replace function public.ensure_clinician_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verification_status = 'verified'
     and new.clinician_code is null
     and new.verification_route is distinct from 'organisation'
  then
    loop
      new.clinician_code := 'CL-' || upper(substr(md5(random()::text), 1, 4));
      exit when not exists (
        select 1 from public.clinicians
        where clinician_code = new.clinician_code
          and id is distinct from new.id
      );
    end loop;
  end if;
  return new;
end;
$$;
