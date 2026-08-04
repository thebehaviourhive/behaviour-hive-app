/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   BUG FIX (A-12) -- revoking a teacher's or clinician's access was never
   written to activity_log at all: a parent reviewing their history sees
   only the "linked to passport" events, with no record that access was
   ever removed, when, or for how long. This adds 'access_revoked' as a
   legal event_type (widening the CHECK constraint -- no existing rows or
   values affected), and includes it in both the teacher and clinician
   activity feed functions using the same visibility rule already applied
   to 'team_linked' in each.

   D-10, done in the same migration since it touches the same function:
   get_clinician_activity_feed's event_type filter never included
   'team_linked' (get_teacher_activity_feed's always did) -- a clinician
   working as part of a multi-disciplinary team benefits from seeing when
   a new teacher joins the picture, so this adds it alongside
   'access_revoked'. */

alter table public.activity_log drop constraint if exists activity_log_event_type_check;
alter table public.activity_log add constraint activity_log_event_type_check
  check (event_type in (
    'passport_updated',
    'morning_checkin',
    'afternoon_update',
    'abc_logged',
    'passport_shared',
    'team_linked',
    'clinician_logged',
    'strategy_logged',
    'access_revoked'
  ));

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
  where al.event_type in ('passport_updated', 'abc_logged', 'team_linked', 'strategy_logged', 'access_revoked')
    and not exists (
      select 1 from public.clinicians c where c.user_id = al.actor_id
    )
  order by al.created_at desc
  limit p_limit offset p_offset;
$$;

create or replace function public.get_clinician_activity_feed(
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
  join public.clinician_access ca on ca.passport_id = al.passport_id
  where ca.clinician_id = auth.uid()
    and ca.is_active = true
    and public.is_verified_clinician(auth.uid())
    and al.event_type in ('abc_logged', 'passport_updated', 'clinician_logged', 'team_linked', 'access_revoked')
  order by al.created_at desc
  limit p_limit offset p_offset;
$$;
