/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   BUG FIX, found during Phase 3 live verification (not in the original
   audit): get_teacher_activity_feed's event_type filter has never
   included 'afternoon_update', in any of its three prior definitions
   (0028, 0026 untouched it, 0038). 'afternoon_update' is a legal value in
   activity_log_event_type_check and logActivity() is called with it every
   time a teacher submits an end-of-day update (src/app/teacher/eod/
   [passportId]/page.tsx), but the row was silently filtered out of the
   teacher's own feed at read time -- a teacher has never been able to see
   their own submitted EOD updates in their activity history. Confirmed
   live: submitted a real EOD update, it did not appear on
   /teacher/activity even after a fresh fetch.

   This is a pure widen-the-filter fix -- adds one value to the same `in
   (...)` list, changes nothing else about the function. */

create or replace function public.get_teacher_activity_feed(
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  passport_id uuid,
  child_name text,
  event_type text,
  event_description text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select al.id, al.passport_id, p.child_name, al.event_type, al.event_description, al.created_at
  from public.activity_log al
  join public.passports p on p.id = al.passport_id
  join public.passport_access pa
    on pa.passport_id = al.passport_id
    and pa.teacher_id = auth.uid()
    and pa.is_active = true
  join public.passport_institution_links pil
    on pil.passport_id = pa.passport_id
    and pil.institution_id = pa.institution_id
    and pil.approved_by_parent = true
  where al.event_type in ('passport_updated', 'abc_logged', 'team_linked', 'strategy_logged', 'access_revoked', 'afternoon_update')
    and not exists (
      select 1 from public.clinicians c where c.user_id = al.actor_id
    )
  order by al.created_at desc
  limit p_limit offset p_offset;
$$;
