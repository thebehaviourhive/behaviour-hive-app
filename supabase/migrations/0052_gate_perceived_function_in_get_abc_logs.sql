/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   Adversarial check during the Progress feature's Stage B build found a
   pre-existing gap (not introduced by Stage B): get_abc_logs() (migration
   0029) returns perceived_function to ANY caller with row-level access to
   a passport's abc_logs -- parent, teacher, or clinician alike, no per-
   role column scoping. Confirmed live: signed in as the fbatest teacher
   via anon key, called get_abc_logs() directly, got back real
   perceived_function values.

   That RPC is the same one ABCTimeline.tsx already calls for its own
   read (src/components/abc-logger/ABCTimeline.tsx), and that component
   is used by both the parent's and teacher's ABC Log viewing screens --
   so perceived_function is already being fetched into the parent's and
   teacher's browser today during normal use, not just via a direct REST
   call. ABCTimeline.tsx's own render logic never displays it (confirmed
   via grep -- no "perceived"/"Function" reference in its JSX), so today
   it's a silent network-payload leak rather than a rendered one, but the
   app's own established posture (see this function's original 2019
   comment about clinical_notes, and get_abc_trend_data's, migration
   0051) is explicit that "enforce at query level" is the real bar, not
   "the UI happens not to show it".

   Fix: gate perceived_function server-side, inside the same function --
   real value only when the caller is a verified, actively-linked
   clinician for this passport; null otherwise. Every other column and
   the function's authorization (which ROWS a caller can see at all) is
   completely unchanged -- this only ever narrows what one already-
   returned column can contain.

   Return shape (column list/types) is unchanged, so plain CREATE OR
   REPLACE is safe here -- same reasoning migration 0029 itself gives for
   why it could do the same. No DROP needed. */

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
  perceived_function text,
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
    a.general_notes,
    a.is_draft, a.sync_status, a.created_at
  from public.abc_logs a
  join auth.users u on u.id = a.logged_by
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
  order by a.incident_date desc, a.incident_time desc;
$$;
