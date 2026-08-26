/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SCHOOL INCIDENT LOG -- small copy fix in get_incident_signoff_summary(),
   caught by the adversarial suite (CHECK O4e), not by eye.

   THE BUG: status_label used initcap(replace(status, '_', ' ')) for the
   three real-account states -- initcap() capitalises every word, so
   'not_attested' became "Not Attested" (capital A), while the free-text
   branch was hardcoded to "Not attested -- no account" (lowercase a).
   The brief's own wording was lowercase in both: "not attested" and
   "not attested - no account". Fixed with an explicit mapping instead
   of a generic transform, so the four real statuses read "Not
   attested" / "Stale" / "Withdrawn" / "Current", matching the
   free-text branch's own casing convention exactly. */

create or replace function public.get_incident_signoff_summary(p_incident_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident public.incidents;
  v_staff jsonb;
  v_issues jsonb;
begin
  select * into v_incident from public.incidents where id = p_incident_id;
  if not found then
    raise exception 'Incident not found, or you do not have permission to view it.';
  end if;

  if not (v_incident.created_by = auth.uid() or v_incident.owning_teacher_id = auth.uid()) then
    raise exception 'Only this incident''s creator or owning teacher can view its sign-off summary.';
  end if;

  if v_incident.teacher_signed_at is not null then
    raise exception 'This incident has already been signed off.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'incident_staff_id', st.id,
      'name', coalesce(
        nullif(trim(st.free_text_name), ''),
        coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
        'Named staff member'
      ),
      'has_account', st.user_id is not null,
      'status', case when st.user_id is null then 'not_attested' else public.get_attestation_status(st.id) end,
      'status_label', case
        when st.user_id is null then 'Not attested -- no account'
        else case public.get_attestation_status(st.id)
          when 'current' then 'Current'
          when 'stale' then 'Stale'
          when 'withdrawn' then 'Withdrawn'
          when 'not_attested' then 'Not attested'
          else initcap(replace(public.get_attestation_status(st.id), '_', ' '))
        end
      end,
      'blocks_signoff', st.user_id is not null and public.get_attestation_status(st.id) in ('stale', 'withdrawn')
    ) order by st.id), '[]'::jsonb)
  into v_staff
  from public.incident_staff st
  left join auth.users u on u.id = st.user_id
  where st.incident_id = p_incident_id;

  v_issues := public.incident_signoff_issues(v_incident);

  return jsonb_build_object(
    'can_sign_off', jsonb_array_length(v_issues) = 0,
    'blocking_issues', v_issues,
    'staff_attestations', v_staff,
    'anyone_injured', jsonb_build_object(
      'value', v_incident.anyone_injured,
      'note', case when v_incident.anyone_injured is null then 'not recorded' else null end
    )
  );
end;
$$;

grant execute on function public.get_incident_signoff_summary(uuid) to authenticated;
