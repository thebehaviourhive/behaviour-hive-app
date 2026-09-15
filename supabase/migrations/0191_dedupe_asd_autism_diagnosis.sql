-- Stage 2, parent track: resolves the pre-existing "Autism" / "ASD
-- (Autism Spectrum Disorder)" duplicate diagnosisOptions.ts already
-- named and deliberately left alone (out of scope for that earlier
-- presentation-only restructure). Daniel's own instruction now: dedupe
-- to "Autism" (the value already promoted to Tier 1 as the shorter,
-- plainer of the two), and if any passport has BOTH values stored,
-- collapse to one rather than leaving a duplicate.
--
-- Checked before writing this: exactly ONE real passport currently
-- carries "ASD (Autism Spectrum Disorder)" (queried live, 15 Sept
-- 2026, post-wipe) -- diagnoses = ["ASD (Autism Spectrum Disorder)"],
-- not both values. Nothing else in the schema reads this string
-- conditionally -- grepped every migration and every client file that
-- touches passports.diagnoses; every reader (pill-display helpers
-- across every track, get_institution_child_roster, get_my_
-- accessible_children, etc.) treats it as an opaque array to display,
-- never branches on a specific diagnosis value. Safe to remap.
--
-- array_replace() swaps the old string for "Autism" in place; if a
-- passport already also had "Autism" separately, this produces a
-- duplicate entry, which the unnest/array_agg(distinct ...) immediately
-- collapses back to one. Only touches rows that actually contain the
-- old value -- every other passport's diagnoses array is untouched.
update public.passports
set diagnoses = (
  select array_agg(distinct val order by val)
  from unnest(array_replace(diagnoses, 'ASD (Autism Spectrum Disorder)', 'Autism')) as val
)
where diagnoses @> array['ASD (Autism Spectrum Disorder)']::text[];
