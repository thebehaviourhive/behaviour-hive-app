-- Stage 4, item 1: the principal sees the full classroom profile, as a
-- class teacher does, including Progress. Confirmed via a dedicated
-- investigation before building: get_child_passport_profile_for_
-- principal() (0160) already covers diagnoses/hard signals & triggers/
-- communication methods/before-during-after distress/sensory seeks &
-- avoids -- everything teacher's own behaviour/communication/supports
-- tabs show. Two genuine gaps remained, exactly as scoped: today's
-- context (morning_checkins) and Section E (passport_section_e) have
-- NO principal read path anywhere in the schema. Both fixed below with
-- a new, additive SELECT policy -- same shape as passport_section_e's
-- own existing "Teachers with granted access" / "Clinicians with
-- active access" policies (0184), scoped via passport_institution_
-- links + institution_staff, role='principal', active standing.
--
-- A THIRD, RELATED GAP FOUND WHILE BUILDING -- BEYOND WHAT WAS ASKED,
-- FLAGGED HERE RATHER THAN SILENTLY EXPANDED OR SILENTLY SHIPPED
-- BROKEN. Progress's own afternoon/school-regulation series (useDaily
-- Patterns) reads teacher_updates directly, same as morning_checkins --
-- and teacher_updates' current SELECT policy ("Teachers and the
-- child's parent can view an update", live def: 0118) is narrower than
-- has_child_access() even for a class teacher: `auth.uid() = teacher_id
-- or owns_passport()` -- ONLY the update's own author, or the child's
-- parent, can read a teacher_updates row today, not "any staff member
-- with access to this child". That's a pre-existing restriction this
-- migration does not touch or widen for teacher/SNA -- only a NEW,
-- ADDITIVE principal policy is added here, for the same reason a
-- principal branch was added inline rather than into has_child_access()
-- itself throughout this stage: without it, Progress's afternoon series
-- would be silently and permanently empty for every principal, which
-- would ship item 1 incomplete against its own explicit brief ("Progress"
-- named directly). If this narrower-than-expected teacher_updates policy
-- turns out to be its own bug for teacher/SNA, that's a separate finding
-- for a separate pass -- not conflated with this one.
create policy "Principals can view section E for their own institution's children"
  on public.passport_section_e
  for select
  to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      join public.passport_institution_links pil on pil.institution_id = s.institution_id
      where pil.passport_id = passport_section_e.passport_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and s.deactivated_at is null
        and s.approved_at is not null
    )
  );

create policy "Principals can view morning check-ins for their own institution's children"
  on public.morning_checkins
  for select
  to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      join public.passport_institution_links pil on pil.institution_id = s.institution_id
      where pil.passport_id = morning_checkins.passport_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and s.deactivated_at is null
        and s.approved_at is not null
    )
  );

-- See the header comment above -- additive only, does not touch the
-- existing author-or-parent policy for anyone else.
create policy "Principals can view EOD updates for their own institution's children"
  on public.teacher_updates
  for select
  to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      join public.passport_institution_links pil on pil.institution_id = s.institution_id
      where pil.passport_id = teacher_updates.passport_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and s.deactivated_at is null
        and s.approved_at is not null
    )
  );

-- get_abc_trend_data() (live def: 0104) -- class_teacher's own branch is
-- narrower than has_child_access() (self-logged, or a message recipient
-- on that log, only) -- a principal branch here matches get_abc_logs()'s
-- own institution-wide principal visibility (0190), not that narrower
-- teacher scope: a principal reviewing Progress needs the full trend,
-- not just entries they happened to be messaged about. Same signature,
-- same return shape -- CREATE OR REPLACE is sufficient.
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
      or (
        public.has_class_teacher_access(auth.uid(), p_passport_id)
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
      -- NEW: institution-wide principal visibility, matching get_abc_logs()'s
      -- own 0190 principal branch.
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
  order by a.incident_date asc, a.incident_time asc;
$$;

grant execute on function public.get_abc_trend_data(uuid) to authenticated;
