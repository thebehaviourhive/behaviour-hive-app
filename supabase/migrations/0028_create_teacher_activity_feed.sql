/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   Teacher dashboard upgrade needs a "Recent Activity" feed, same pattern as
   the parent and clinician dashboards. Three gaps found while verifying
   against the real schema (per the brief's own instruction not to invent
   parallel fields):

   1. activity_log has no teacher-facing SELECT policy at all yet -- the
      original migration 0022 explicitly deferred this ("a teacher-facing
      read can be added later with its own migration if that surfaces
      elsewhere in the app"). This is that migration.

   2. The strategy ledger (public.strategy_ledger, migration 0009) has
      NEVER been wired into activity_log -- there is no existing event_type
      for it, and no logActivity() call anywhere near
      StrategyLedgerSheet.tsx. The brief asks for "strategy ledger
      contributions" in the feed using "the real event_type from the
      codebase" -- there isn't one, so this adds 'strategy_logged' as a new
      value and the app-code change (StrategyLedgerSheet.tsx) fires it
      going forward. Nothing retroactive -- no historical strategy_ledger
      rows get backfilled into activity_log.

   3. abc_logged rows are now shared across parent/teacher/clinician actors
      (all write the same event_type since the recent duplicate-log fix).
      The brief requires clinician-authored ABC logs to never reach a
      teacher's feed. activity_log has no actor-role column (by design --
      see 0022's comment), so role is resolved the same way
      get_passport_team()/get_passport_clinicians() already do it: by
      checking whether actor_id has a row in public.clinicians.

   Scoping for both the SELECT policy and the feed function mirrors the
   *stricter* "real student" definition already used by the teacher
   dashboard client-side today: passport_access.is_active = true AND a
   matching passport_institution_links.approved_by_parent = true row for
   the same institution_id. (The existing teacher INSERT policy on
   activity_log only checks passport_access -- left untouched here, since
   fixing that would be a separate, unrelated change.) */

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
    'strategy_logged'
  ));

create policy "Teachers can view activity for passports they access"
  on public.activity_log
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.passport_access pa
      join public.passport_institution_links pil
        on pil.passport_id = pa.passport_id
        and pil.institution_id = pa.institution_id
        and pil.approved_by_parent = true
      where pa.passport_id = activity_log.passport_id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
    )
  );

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
  where al.event_type in ('passport_updated', 'abc_logged', 'team_linked', 'strategy_logged')
    and not exists (
      select 1 from public.clinicians c where c.user_id = al.actor_id
    )
  order by al.created_at desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.get_teacher_activity_feed(integer, integer) to authenticated;
