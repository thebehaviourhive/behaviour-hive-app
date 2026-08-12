/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   STAGE B of the Progress feature needs ABC incident data for the parent
   and teacher trend charts (frequency over time, antecedent/behaviour/
   consequence breakdowns) -- but get_abc_logs() (migration 0029) already
   returns perceived_function to every authorized caller, with no
   per-role column scoping. That's fine for its one existing caller
   (useAbcLogs, gated to verified active clinicians via Section 8) but
   would be wrong to reuse directly for the parent/teacher Progress
   surface, where a function-breakdown chart must never exist -- not "is
   hidden by the UI", but structurally unfetchable.

   Same reasoning get_abc_logs() itself already documents for
   clinical_notes: a SELECT policy can't hide one column of a row, so
   "enforce at query level" means a SECURITY DEFINER function whose
   RETURNS TABLE simply omits the sensitive column. This is that function
   for perceived_function -- get_abc_trend_data() returns everything the
   frequency/categorical charts need and nothing else, so no client bug
   or future edit to the Progress surface can ever put a function tag in
   front of a parent or teacher through this path.

   The clinician-only function-breakdown chart keeps reading through the
   existing get_abc_logs(), unchanged -- that RPC is already correctly
   gated to verified, actively-linked clinicians for that field, so nothing
   there needs to change.

   Authorization mirrors get_abc_logs()'s three existing branches exactly
   (owns_passport / active teacher passport_access / verified active
   clinician_access) -- this function is safe to expose to all three
   roles because it never returns perceived_function, general_notes, or
   clinical_notes to anyone, regardless of who calls it. */

create or replace function public.get_abc_trend_data(p_passport_id uuid)
returns table (
  id uuid,
  incident_date date,
  incident_time time,
  logged_by_role text,
  duration_minutes integer,
  intensity integer,
  antecedents text[],
  behaviours text[],
  consequences text[]
)
language sql
security definer
set search_path = public
stable
as $$
  select
    a.id, a.incident_date, a.incident_time, a.logged_by_role,
    a.duration_minutes, a.intensity, a.antecedents, a.behaviours, a.consequences
  from public.abc_logs a
  where a.passport_id = p_passport_id
    and (
      public.owns_passport(p_passport_id)
      or exists (
        select 1 from public.passport_access pa
        where pa.passport_id = p_passport_id
          and pa.teacher_id = auth.uid()
          and pa.is_active = true
      )
      or (
        public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = p_passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
      )
    )
  order by a.incident_date asc, a.incident_time asc;
$$;

grant execute on function public.get_abc_trend_data(uuid) to authenticated;
