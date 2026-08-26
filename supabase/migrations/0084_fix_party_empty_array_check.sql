/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SCHOOL INCIDENT LOG -- fixes a real, currently-shipped bug in
   migration 0080's own party check constraint, caught live while
   building the persistent adversarial coverage for Parts 2/6/7.

   THE BUG: 0080's constraint was
     party <@ array['self','peer','staff','other']::text[]
       and array_length(party, 1) >= 1
   intended to reject an empty array ({}), since party is a required
   field and an empty selection must not silently pass as "answered".
   It doesn't work: Postgres's array_length() returns NULL, not 0, for
   an empty array -- so `array_length(party, 1) >= 1` evaluates to
   NULL, and a CHECK constraint only blocks on a definite FALSE; NULL
   passes, same as if the clause weren't there. Confirmed live against
   a real incidents row before writing this: `update incidents set
   party = '{}'` succeeded, no error, party read back as [] -- then
   restored to its original value.

   THE FIX: cardinality(party) instead of array_length(party, 1) --
   cardinality() returns 0 for an empty array, not NULL, so `>= 1`
   correctly rejects it. Same constraint shape otherwise. */

alter table public.incidents drop constraint if exists incidents_party_check;

alter table public.incidents
  add constraint incidents_party_check
  check (
    party is null
    or (party <@ array['self', 'peer', 'staff', 'other']::text[] and cardinality(party) >= 1)
  );
