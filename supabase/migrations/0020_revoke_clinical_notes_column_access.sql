/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   Closes a real gap found via live testing, not just review: the base
   table's row-level SELECT policies on abc_logs (migration 0019, needed
   regardless) let a teacher with a valid session read clinical_notes
   directly via a plain `select=*` REST call, completely bypassing
   get_abc_logs(). RLS only filters which ROWS a role can see, never
   which COLUMNS -- the "structural omission" protection in that function
   only holds for callers going through it, not for anyone querying the
   table directly with their own JWT. Confirmed by doing exactly that
   with a real teacher token: clinical_notes came back in full.

   Column-level privileges are the actual Postgres mechanism for this,
   and they're independent of RLS: revoking SELECT on this one column
   from the authenticated role blocks it for every ordinary
   PostgREST-issued query (parent or teacher -- both currently map to
   the same authenticated role), while leaving get_abc_logs() completely
   unaffected. SECURITY DEFINER functions run with the function owner's
   privileges, not the caller's, so this revoke doesn't touch what the
   function can read internally -- moot anyway, since its RETURNS TABLE
   never included this column to begin with.

   When the clinician role is built and needs real read access here, the
   fix is the same SECURITY DEFINER pattern used throughout this project
   (get_teacher_name, lookup_passport_by_code) -- a narrow
   get_abc_logs_for_clinician()-style function -- not a grant back to
   authenticated, since that would re-open this exact gap for parents
   and teachers too. */

revoke select (clinical_notes) on public.abc_logs from authenticated;
