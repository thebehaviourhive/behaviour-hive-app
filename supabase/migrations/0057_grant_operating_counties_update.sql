/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   Fix: clinicians.operating_counties is a genuine clinician-writable
   setting (Operating Area, added in migration 0055) -- same category as
   review_cadence_days, which migration 0026 explicitly column-grants:
   "The one thing a clinician CAN update directly is review_cadence_days
   ... enforced via a column-level GRANT." clinicians uses column-level
   GRANTs throughout (deliberately, per 0026's judgment call 3 -- default-
   deny, only specific columns opened up), so a newly added column is
   NOT writable until it's explicitly granted; 0055 added the column but
   never added this grant, so every operating_counties write (at
   /clinician/verify and from /more) fails with 42501 "permission denied
   for table clinicians". Confirmed live: clinician SELECT already works
   (RLS + the table-level SELECT grant cover it), only UPDATE was
   missing. Purely additive -- no existing grant, policy, or column is
   touched. */

grant update (operating_counties) on public.clinicians to authenticated;
