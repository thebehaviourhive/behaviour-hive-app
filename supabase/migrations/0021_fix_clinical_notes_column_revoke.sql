/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   Migration 0020 didn't actually work -- confirmed live, twice, including
   after a schema reload (NOTIFY pgrst, 'reload schema'), so this isn't a
   PostgREST caching issue as first suspected. The real cause: Supabase's
   standard setup already grants authenticated a TABLE-level SELECT on
   every table in public (the normal pattern -- broad grant, RLS handles
   row filtering). A column-level REVOKE only removes a column-specific
   grant; it does nothing when a broader table-level grant already covers
   that same column, since Postgres unions every applicable grant rather
   than letting a narrower REVOKE override a wider one. The table-level
   grant kept authorizing clinical_notes regardless of 0020's revoke.

   The actual fix has to remove the table-level SELECT entirely and
   replace it with an explicit column grant that excludes clinical_notes.
   RLS is untouched by this and keeps working exactly as before -- this
   only changes which COLUMNS are visible once a row already passes the
   existing row-level policies, not which rows are visible. */

revoke select on public.abc_logs from authenticated;

grant select (
  id,
  passport_id,
  logged_by,
  logged_by_role,
  incident_date,
  incident_time,
  duration_minutes,
  intensity,
  antecedents,
  antecedent_other,
  behaviours,
  behaviour_other,
  consequences,
  consequence_other,
  perceived_function,
  general_notes,
  is_draft,
  sync_status,
  created_at,
  updated_at
) on public.abc_logs to authenticated;

notify pgrst, 'reload schema';
