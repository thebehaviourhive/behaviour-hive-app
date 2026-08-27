-- Fixes a real gap found while building piece 3's client code:
-- build_staff_attestations_summary() only ever returned status/
-- status_label -- no addendum text, no withdrawal reason, no
-- involvement. get_countersign_summary() needs all of these ("any
-- addenda, in full and attributed", "any withdrawal, with its reason,
-- prominently") and literally could not show them. Only this one
-- shared helper changes -- both get_incident_signoff_summary() and
-- get_countersign_summary() already pass its output through
-- unchanged, so neither needs to be re-created.
--
-- addendum/attested_at come from the LATEST 'attested' row per staff
-- member; withdrawal_reason/withdrawn_at from the LATEST 'withdrawn'
-- row. Both are independent lateral joins, so a staff member who
-- withdrew and then re-attested carries both timestamps at once --
-- correct (both happened), the client renders it as a sequence, not
-- two contradictory states.
create or replace function public.build_staff_attestations_summary(p_incident_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
      'incident_staff_id', st.id,
      'name', coalesce(
        nullif(trim(st.free_text_name), ''),
        coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
        'Named staff member'
      ),
      'involvement', st.involvement,
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
      'blocks_signoff', st.user_id is not null and public.get_attestation_status(st.id) in ('stale', 'withdrawn'),
      'addendum', latest_attested.addendum,
      'attested_at', latest_attested.created_at,
      'withdrawal_reason', latest_withdrawn.withdrawal_reason,
      'withdrawn_at', latest_withdrawn.created_at
    ) order by st.id), '[]'::jsonb)
  from public.incident_staff st
  left join auth.users u on u.id = st.user_id
  left join lateral (
    select a.addendum, a.created_at
    from public.incident_attestations a
    where a.incident_staff_id = st.id and a.action = 'attested'
    order by a.created_at desc
    limit 1
  ) latest_attested on true
  left join lateral (
    select a.withdrawal_reason, a.created_at
    from public.incident_attestations a
    where a.incident_staff_id = st.id and a.action = 'withdrawn'
    order by a.created_at desc
    limit 1
  ) latest_withdrawn on true
  where st.incident_id = p_incident_id;
$function$;
