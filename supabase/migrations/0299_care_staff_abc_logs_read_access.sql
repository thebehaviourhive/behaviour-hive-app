-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Care staff can write an ABC entry (0297) and could not read one back --
-- not their own, not a colleague's from a previous shift. Named directly
-- by Daniel, not deferrable to a later stage: a care worker is the
-- primary AUTHOR of this data during a stay, and the handover PRD 11
-- section 6 describes is partly this exact need -- reading what the
-- previous shift logged, not just writing your own entry into a record
-- nobody on your own team can see again.
--
-- SCOPE, Daniel's own words, built literally: "care staff read entries
-- for a child whose record is active at their centre, and nothing
-- else." Institution-wide within the centre, not narrowed to a
-- specific stay or to the caller's own entries -- deliberately, because
-- the whole point is reading a COLLEAGUE's entry from an earlier shift,
-- which "my own entries only" or "this specific stay only" would both
-- defeat. "Active at their centre" means the same thing it already
-- means everywhere else in this PRD: an episodes_of_care row for this
-- passport at the caller's own institution with ended_at still null --
-- the placement itself, already live since Stage 3, needing nothing
-- new. No activation/stay-level gate is needed for READ specifically --
-- unlike the WRITE policy (0297), which is correctly scoped to an
-- ACTIVE STAY (a narrower, time-boxed window, since writing an entry
-- only makes sense while genuinely on site), reading needs the WIDER
-- placement-level window so a handover read the day after a stay ends,
-- or before the next one starts, still works while the placement
-- itself remains open. Two different questions ("when may you write"
-- vs "when may you read"), two different answers, on purpose.
--
-- TWO PATHS, BOTH FIXED -- this table has two ways to be read, and
-- leaving either one closed would be a real, not just theoretical, gap:
--   1. The raw table SELECT policy (RLS) -- the one every other
--      logging role already has its own version of (parent, teacher).
--      Reuses institution_staff_has_current_standing() (this schema's
--      own standing rule), never hand-written deactivated_at/
--      approved_at conditions.
--   2. get_abc_logs() -- the actual, sanctioned UI-facing read path
--      (live def: 0190). Had NO branch for care_staff at all, same gap
--      0190 itself closed for principal at the time -- a caller with a
--      real, valid RLS-level read would still have gotten zero rows
--      back from the one function every real screen actually calls.
--      Same signature, same return shape -- CREATE OR REPLACE is safe,
--      no DROP needed.
--
-- perceived_function/perceived_function_other stay redacted for
-- care_staff, untouched -- the existing CASE expression already
-- defaults to null for any caller who isn't a verified, actively-
-- engaged clinician, which correctly covers a new role with zero
-- additional code. Care staff is a non-clinical support role; a
-- clinical judgement field was never meant to reach it and nothing
-- here changes that.
--
-- NOT DONE HERE, flagged rather than silently expanded: centre_manager
-- has no equivalent read access either, and will very likely need one
-- to finalise the post-stay report their own consent screen names --
-- Daniel's instruction was scoped to care_staff specifically, and this
-- migration builds exactly that, not a guess at what the report's own
-- read requirements will turn out to be. stay_id is not added to get_
-- abc_logs()'s own return shape -- this migration is about WHICH ROWS
-- a care worker may read, not a new column in what's returned; a
-- stay-scoped view is the report's own future concern, not this one's.
--
-- THE FBA IS NOT TOUCHED BY ANY PART OF THIS MIGRATION.

create policy "Care staff can view abc logs for children with an active placement at their centre"
  on public.abc_logs
  for select
  to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.role = 'care_staff'
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
      -- NEW: care_staff, institution-wide within their own centre,
      -- scoped to an active placement -- matching the RLS policy above
      -- exactly, the same predicate stated twice deliberately (once as
      -- the table's own real, independent RLS grant, once as this
      -- function's own gate) rather than one relying silently on the
      -- other.
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
    )
  order by a.incident_date desc, a.incident_time desc;
$$;

grant execute on function public.get_abc_logs(uuid) to authenticated;
