/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   ABC Incident Logger vocabulary refresh -- two independent schema
   changes, bundled here because they ship together as one feature.

   =====================================================================
   1. Sensory signals -- new, optional, all four role tracks.
   =====================================================================
   Deliberately NOT the same thing as the passport's own Section D
   sensory_seeks/sensory_avoids (profile-level, one-time, broad modality
   categories -- Touch, Sound, Proprioception...). This is per-incident,
   specific observable behaviour (rocking, mouthing items, covering
   ears...) captured at logging time alongside antecedent/behaviour/
   consequence -- same tier as those three (free vocabulary living in
   application code, not a DB allow-list), hence text[] with no CHECK
   here either. All four columns nullable: the whole block is optional
   in the UI, and every log written before this migration legitimately
   has nothing to backfill.

   =====================================================================
   2. perceived_function relabel + widen.
   =====================================================================
   'sensory' is renamed to 'automatic' -- the same clinical concept
   (self-regulation / automatic reinforcement), just a value that reads
   clearly against the new plain-English question copy ("To regulate
   themselves"). Existing rows are updated in place below (a value-
   preserving relabel, not a semantic change) before the CHECK is
   swapped to the new allowed set, which also admits 'other' for the
   first time -- paired with a new nullable perceived_function_other
   free-text column, the same pattern antecedent_other/behaviour_other/
   consequence_other already use.

   Access to perceived_function (and now perceived_function_other) is
   UNCHANGED by this migration -- both remain gated to verified,
   actively-linked clinicians only (the same CASE 0052/0064 already
   apply), regardless of who authored the log. That decision stands;
   this migration only widens what the column can *store*, not who can
   *read* it. get_abc_logs() below is recreated to add the new columns
   to its return shape (a DROP is required first -- Postgres won't let
   CREATE OR REPLACE change a function's RETURNS TABLE column list),
   applying the identical clinician-only CASE to perceived_function_other
   as it already does to perceived_function itself. */

-- =====================================================================
-- 1. Sensory signals columns.
-- =====================================================================
alter table public.abc_logs
  add column if not exists sensory_sought text[],
  add column if not exists sensory_avoided text[],
  add column if not exists sensory_sought_other text,
  add column if not exists sensory_avoided_other text;

-- =====================================================================
-- 2a. Relabel existing 'sensory' rows to 'automatic' BEFORE the CHECK
--     is swapped (so there's never a moment where a row's stored value
--     isn't covered by whichever constraint is currently in force).
-- =====================================================================
update public.abc_logs
  set perceived_function = 'automatic'
  where perceived_function = 'sensory';

-- =====================================================================
-- 2b. Widen the CHECK constraint.
-- =====================================================================
alter table public.abc_logs
  drop constraint if exists abc_logs_perceived_function_check;
alter table public.abc_logs
  add constraint abc_logs_perceived_function_check
  check (perceived_function in ('escape', 'attention', 'tangible', 'automatic', 'other'));

-- =====================================================================
-- 2c. New free-text column for when 'other' is picked.
-- =====================================================================
alter table public.abc_logs
  add column if not exists perceived_function_other text;

-- =====================================================================
-- 3. get_abc_logs() -- widen the return shape to carry the six new
--    columns. Sensory columns are returned to every authorized caller
--    unconditionally (no gating -- same tier as antecedents/behaviours/
--    consequences). perceived_function_other follows the EXACT SAME
--    clinician-only CASE as perceived_function, for the same reason:
--    it's the free-text elaboration of the same clinically-gated field,
--    and leaking the "other" description would defeat the gate on the
--    structured value right next to it.
-- =====================================================================
drop function if exists public.get_abc_logs(uuid);

create function public.get_abc_logs(p_passport_id uuid)
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
        -- Deliberately role-blind on actor_role, matching the CURRENT
        -- (0064) function exactly -- 0065's own comment already
        -- establishes why: this branch's passport_access check has no
        -- actor_role filter, so it covers class_teacher AND sna alike
        -- by construction the moment sna rows exist; 0065 explicitly
        -- left get_abc_logs untouched for this exact reason ("already
        -- correctly inclusive by the same reasoning"). Splitting this
        -- into two role-specific branches would be a pure, unneeded
        -- deviation from that established shape -- not done here.
        exists (
          select 1 from public.passport_access pa
          where pa.passport_id = p_passport_id
            and pa.teacher_id = auth.uid()
            and pa.is_active = true
        )
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
    )
  order by a.incident_date desc, a.incident_time desc;
$$;

grant execute on function public.get_abc_logs(uuid) to authenticated;
