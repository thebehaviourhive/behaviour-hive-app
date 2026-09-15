-- Stage 2 prep: the AbcLogReference "View log" gap named during the QA
-- pass (item 5b's sibling finding) is now decided -- a sixth tab on the
-- principal's ChildDetail, "ABC Logs", matching SNA's own page exactly
-- (Daniel's own instruction: "a principal should not find ABC logs
-- somewhere different from where an SNA finds them", and folding it
-- into the existing "Incidents" tab would blur formal-record versus
-- day-to-day-log, the exact ambiguity that made this unclear in the
-- first place).
--
-- get_abc_logs() (live def: 0104) had NO principal branch at all --
-- confirmed by reading its current WHERE clause: owns_passport
-- (parent), has_child_access() scoped to the caller's OWN logged
-- entries or ones they're a message recipient on (teacher/SNA,
-- deliberately narrower than full institution access), or a verified,
-- actively-engaged clinician. A principal calling this today gets zero
-- rows, always, regardless of institution. Adding institution-wide
-- principal visibility, same pattern get_passport_clinical_content()
-- (0160) already established for the identical "principal viewing a
-- child's own record" case -- institution_staff + passport_
-- institution_links, role='principal', active standing. Same
-- signature, CREATE OR REPLACE is safe.
create or replace function public.get_abc_logs(p_passport_id uuid)
returns table (
  id uuid,
  passport_id uuid,
  logged_by uuid,
  logged_by_name text,
  logged_by_role text,
  incident_date date,
  incident_time time,
  duration_minutes integer,
  intensity integer,
  antecedents text[],
  antecedent_other text,
  behaviours text[],
  behaviour_other text,
  consequences text[],
  consequence_other text,
  sensory_sought text[],
  sensory_avoided text[],
  sensory_sought_other text,
  sensory_avoided_other text,
  perceived_function text,
  perceived_function_other text,
  general_notes text,
  is_draft boolean,
  sync_status text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    a.id, a.passport_id, a.logged_by,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as logged_by_name,
    a.logged_by_role, a.incident_date, a.incident_time, a.duration_minutes,
    a.intensity, a.antecedents, a.antecedent_other, a.behaviours, a.behaviour_other,
    a.consequences, a.consequence_other,
    a.sensory_sought, a.sensory_avoided, a.sensory_sought_other, a.sensory_avoided_other,
    case
      when public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = a.passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
      then a.perceived_function
      else null
    end as perceived_function,
    case
      when public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = a.passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
      then a.perceived_function_other
      else null
    end as perceived_function_other,
    a.general_notes,
    a.is_draft, a.sync_status, a.created_at
  from public.abc_logs a
  join auth.users u on u.id = a.logged_by
  where a.passport_id = p_passport_id
    and (
      public.owns_passport(p_passport_id)
      or (
        public.has_child_access(auth.uid(), p_passport_id)
        and (
          a.logged_by = auth.uid()
          or exists (
            select 1 from public.messages m
            join public.message_recipients mr on mr.message_id = m.id
            where m.abc_log_id = a.id
              and mr.recipient_id = auth.uid()
          )
        )
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
      -- NEW: institution-wide principal visibility -- same pattern
      -- get_passport_clinical_content() (0160) already established.
      or exists (
        select 1 from public.institution_staff s
        join public.passport_institution_links pil on pil.institution_id = s.institution_id
        where pil.passport_id = p_passport_id
          and s.user_id = auth.uid()
          and s.role = 'principal'
          and s.deactivated_at is null
          and s.approved_at is not null
      )
    )
  order by a.incident_date desc, a.incident_time desc;
$$;

grant execute on function public.get_abc_logs(uuid) to authenticated;
