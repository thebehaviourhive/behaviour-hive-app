/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   activity_log: a shared feed of "things that happened" on a child's
   passport, surfacing on the parent dashboard's new Recent Updates card
   and its expanded /parent-dashboard/activity page. Follows the same
   authorization shape already established for abc_logs (migration 0019)
   -- owns_passport() for the parent side, and the passport_access
   is_active check for the teacher side -- rather than inventing a new
   pattern.

   Only parents and linked teachers ever write here, both inserting as
   themselves (actor_id = auth.uid()), same discipline as abc_logs.logged_by.
   Only parents read it, since the Recent Updates / Activity page this
   feeds is parent-only in this build; a teacher-facing read can be added
   later with its own migration if that surfaces elsewhere in the app.
   Nobody can update or delete a row -- this is meant as an append-only
   log, so simply not defining those policies is enough given RLS
   defaults to deny anything without a matching permissive policy. */

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  actor_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null
    check (event_type in (
      'passport_updated',
      'morning_checkin',
      'afternoon_update',
      'abc_logged',
      'passport_shared',
      'team_linked'
    )),
  event_description text not null,
  created_at timestamptz not null default now()
);

-- Every read of this table is "latest N (or paginated) rows for one
-- passport_id, newest first" -- this index covers that exactly.
create index if not exists activity_log_passport_id_created_at_idx
  on public.activity_log (passport_id, created_at desc);

alter table public.activity_log enable row level security;

create policy "Parents can view activity for their own passport"
  on public.activity_log
  for select
  to authenticated
  using (public.owns_passport(passport_id));

create policy "Parents can insert activity for their own passport"
  on public.activity_log
  for insert
  to authenticated
  with check (
    actor_id = auth.uid()
    and public.owns_passport(passport_id)
  );

create policy "Teachers can insert activity for passports they access"
  on public.activity_log
  for insert
  to authenticated
  with check (
    actor_id = auth.uid()
    and exists (
      select 1 from public.passport_access pa
      where pa.passport_id = activity_log.passport_id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
    )
  );
