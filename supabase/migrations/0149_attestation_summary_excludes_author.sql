-- build_staff_attestations_summary() -- excludes the incident's own
-- author (owning_teacher_id) from the returned set. An author has
-- nothing to attest to; their own account is theirs. Found live: the
-- author's own incident_staff row (status "not_attested") was showing
-- in SignOffCard's "Not yet resolved -- will not block sign-off" list,
-- and AttestationCard was rendering "Your attestation" for them too
-- (the AttestationCard half was already fixed client-side, since it
-- runs its own separate query -- this is the other half, the shared
-- summary function both get_incident_signoff_summary() (teacher) and
-- get_countersign_summary() (principal) build on).
--
-- "Author" is owning_teacher_id, not created_by -- checked against the
-- live incidents UPDATE policy ("Owning teacher can edit before
-- teacher sign-off", 0069/0106), which grants write access to
-- owning_teacher_id ONLY. They diverge after a supply-teacher
-- ownership transfer; created_by would incorrectly keep excluding the
-- departed original stamper instead of the person who actually owns
-- and writes the account today.
--
-- `is distinct from` handles the null-owner case correctly (a stamp
-- nobody is yet eligible to own, e.g. an SNA's stage-one stamp) --
-- nothing gets excluded, since there is no author identity to exclude.
--
-- No RETURNS TABLE shape change (this returns jsonb, not a table), so
-- CREATE OR REPLACE is sufficient -- no DROP FUNCTION needed here.

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
  where st.incident_id = p_incident_id
    and st.user_id is distinct from (select owning_teacher_id from public.incidents where id = p_incident_id);
$function$;
