-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- The same gap 0299 closed for care_staff, closed now for centre_
-- manager, for the same reason care_staff could not wait: PRD 11
-- section 7 has the ABC entries assembling directly into the post-stay
-- report, not retyped -- a manager who cannot read them cannot write
-- the report that is theirs to finalise. 0299's own migration flagged
-- this exact gap and deliberately didn't build it, since Daniel's own
-- instruction at the time was scoped to care_staff specifically -- now
-- scoped to centre_manager, explicitly, by the same instruction.
--
-- IDENTICAL SCOPE TO CARE_STAFF, not a wider or narrower one: entries
-- for a child with an active placement (episodes_of_care, ended_at
-- still null) at the manager's own centre. Same reasoning as 0299 --
-- placement-scoped, not stay-scoped, since a manager assembling a
-- report needs the WHOLE placement's own history, not just entries
-- from whichever stay happens to be active right now (a report is
-- written once the relevant stay has ALREADY ended, so a stay-scoped
-- read would refuse the manager reading the very entries the report is
-- about).
--
-- BOTH PATHS, same as 0299 -- the raw table SELECT policy (RLS), and
-- get_abc_logs() itself, which had no centre_manager branch either
-- (confirmed by reading its own live WHERE clause directly, the same
-- one 0299 just widened for care_staff -- centre_manager was absent
-- from it both before and after that migration).
--
-- perceived_function/perceived_function_other stay redacted for
-- centre_manager too, unchanged -- the existing CASE expression
-- already defaults to null for any caller who isn't a verified,
-- actively-engaged clinician; a centre manager is an administrative
-- role, not a clinical one, and nothing here changes that.
--
-- THE FBA IS NOT TOUCHED BY ANY PART OF THIS MIGRATION.

create policy "Centre managers can view abc logs for children with an active placement at their centre"
  on public.abc_logs
  for select
  to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.role = 'centre_manager'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
        and exists (
          select 1 from public.episodes_of_care e
          where e.passport_id = abc_logs.passport_id
            and e.institution_id = s.institution_id
            and e.ended_at is null
        )
    )
  );

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
      or exists (
        select 1 from public.institution_staff s
        join public.passport_institution_links pil on pil.institution_id = s.institution_id
        where pil.passport_id = p_passport_id
          and s.user_id = auth.uid()
          and s.role = 'principal'
          and s.deactivated_at is null
          and s.approved_at is not null
      )
      or exists (
        select 1 from public.institution_staff s
        where s.user_id = auth.uid()
          and s.role = 'care_staff'
          and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
          and exists (
            select 1 from public.episodes_of_care e
            where e.passport_id = p_passport_id
              and e.institution_id = s.institution_id
              and e.ended_at is null
          )
      )
      -- NEW: centre_manager, identical shape to the care_staff branch
      -- immediately above -- same placement-level scope, same reason
      -- (the post-stay report needs the whole placement's own history,
      -- not just whatever stay happens to be active right now).
      or exists (
        select 1 from public.institution_staff s
        where s.user_id = auth.uid()
          and s.role = 'centre_manager'
          and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
          and exists (
            select 1 from public.episodes_of_care e
            where e.passport_id = p_passport_id
              and e.institution_id = s.institution_id
              and e.ended_at is null
          )
      )
    )
  order by a.incident_date desc, a.incident_time desc;
$$;

grant execute on function public.get_abc_logs(uuid) to authenticated;
