-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Reverses a mistake in 0191. Daniel has asked, several times, for the
-- diagnosis option to read "Autism Spectrum Disorder" -- not "Autism",
-- not "ASD", not "ASD (Autism Spectrum Disorder)" (the label 0191
-- actually removed). 0191 resolved a real duplicate (two stored values,
-- "Autism" and "ASD (Autism Spectrum Disorder)", for what families mean
-- as one thing) by following a code comment in diagnosisOptions.ts that
-- had marked "Autism" as the value to keep -- the opposite of what
-- Daniel had asked for. A code comment is someone's earlier opinion;
-- his instruction is the decision, and where they conflict the
-- instruction wins -- see CLAUDE.md's own new entry on this.
--
-- This migration does NOT restore the old "ASD (Autism Spectrum
-- Disorder)" string -- that label is retired too, per point 1 of
-- Daniel's instruction (the option must read "Autism Spectrum
-- Disorder" exactly, nothing else). It remaps every passport currently
-- carrying "Autism" straight to the new, final label. Checked live
-- before writing this: exactly 1 passport carries "Autism" today, zero
-- carry "Autism Spectrum Disorder" or the old "ASD (...)" string
-- already, so there is no existing collision to deduplicate against --
-- but the dedup guard (distinct, matching 0191's own shape) is kept
-- regardless, since a passport carrying both "Autism" and "Autism
-- Spectrum Disorder" independently is possible in principle even if it
-- doesn't exist today, and the fix must not produce a passport with the
-- new label listed twice.

update public.passports
set diagnoses = (
  select array_agg(distinct val)
  from unnest(array_replace(diagnoses, 'Autism', 'Autism Spectrum Disorder')) as val
)
where diagnoses @> array['Autism']::text[];
