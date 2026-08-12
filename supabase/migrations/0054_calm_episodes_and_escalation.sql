/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   THE CALM BUTTON, Stage 3 -- episode substrate + the red-notice
   escalation mechanism. Two new tables, one activity_log event type,
   and three RPCs.

   ============================================================
   1. calm_episodes -- constraint 3D's silent substrate. One row per
      Calm flow session: which door, which tags were picked, which
      cards were actually shown (client-accumulated as the parent swipes
      through, written once when the session ends -- not one DB write
      per card), whether it ended at the safety screen, and (backfilled
      later, if the log-nudge is accepted) which abc_logs row resulted.
      No UI reads this table in v1 -- it exists for future strategy-
      effectiveness tracking only.

      RLS is slightly wider than the brief's own three-line shorthand
      ("parent inserts own; authoring clinician SELECT on linked cases;
      teachers never"): parent also gets UPDATE and SELECT on their own
      rows. UPDATE is load-bearing, not a nice-to-have -- abc_log_id can
      only be known after the fact (the log-nudge's [Log it] path opens
      the ABC logger AFTER the episode already ended), so there is no
      way to satisfy "cards_shown... reached_safety... abc_log_id" as a
      single atomic insert. SELECT-own is the same default posture every
      other user-generated table in this app already gives its author
      (abc_logs, morning_checkins, ...) and costs nothing privacy-wise
      since it's the user's own written data.

      "Authoring clinician" is implemented as the same verified +
      actively-linked clinician check every other clinician read in this
      app already uses (get_abc_logs, fba_reports, ...) -- calm_episodes
      has no FBA/card reference to trace a specific "authoring" clinician
      through, so this is the passport-level equivalent of that check.

   ============================================================
   2. calm_escalation_notices -- the persisting, Acknowledge-able red
      card (constraint 3B). Deliberately a SEPARATE table from
      calm_episodes, not extra columns on it: an episode is an immutable
      historical record the instant it's written, but a notice has its
      own independent mutable lifecycle (occurs, sits unacknowledged,
      gets acknowledged by a specific clinician at a specific time) that
      doesn't belong mixed into the episode row.

      No policy at all for parent OR teacher -- the parent write path is
      exclusively through record_calm_episode() below (SECURITY DEFINER,
      so it doesn't need its own INSERT policy on this table), and "the
      parent is NOT shown that the notice fired" means parent gets zero
      read access too, by omission, same posture as every "teacher: no
      policy" case elsewhere in this app.

   ============================================================
   3. activity_log gains a new event type, 'calm_escalation', following
      the exact established pattern (migration 0049 et al.): added to
      the CHECK constraint, added to get_clinician_activity_feed()'s
      allow-list, and explicitly EXCLUDED from the parent's own
      activity_log visibility (narrowing that policy, same technique
      already used there for questionnaire_sent/completed) -- "the
      parent is NOT shown that the notice fired" applies here too, not
      just to calm_escalation_notices itself. get_teacher_activity_feed()
      needs no change: its allow-list simply never gains this type,
      correct by omission.

   ============================================================
   4. Three RPCs:
      - record_calm_episode(...): the ONE call CalmFlow makes when a
        session ends, whichever way it ends. Always inserts into
        calm_episodes. When p_reached_safety is true, ALSO -- in the
        same call -- inserts the calm_escalation_notices row and the
        activity_log 'calm_escalation' row, so "reaching the escalation
        screen fires a high-visibility alert" is a single atomic
        consequence of one client call, not two separate ones that could
        get out of sync.
      - attach_calm_episode_abc_log(...): the log-nudge's [Log it]
        backfill, gated to the episode's own author.
      - acknowledge_calm_escalation(...): the clinician's [Acknowledge]
        action, gated to verified + actively-linked clinician for that
        notice's passport. Unacknowledged notices themselves are read via
        a plain direct SELECT on calm_escalation_notices (its own RLS
        already scopes correctly) -- no separate read RPC needed. */

create table public.calm_episodes (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  parent_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  door_type text not null
    check (door_type in ('prevention', 'deescalation')),
  tags_selected text[] not null default '{}',
  cards_shown uuid[] not null default '{}',
  reached_safety boolean not null default false,
  abc_log_id uuid references public.abc_logs (id) on delete set null,
  created_at timestamptz not null default now()
);

create index calm_episodes_passport_id_idx on public.calm_episodes (passport_id);

alter table public.calm_episodes enable row level security;

create policy "Parents can view their own calm episodes"
  on public.calm_episodes
  for select
  to authenticated
  using (parent_id = auth.uid() and public.owns_passport(passport_id));

create policy "Parents can insert their own calm episodes"
  on public.calm_episodes
  for insert
  to authenticated
  with check (parent_id = auth.uid() and public.owns_passport(passport_id));

create policy "Parents can update their own calm episodes"
  on public.calm_episodes
  for update
  to authenticated
  using (parent_id = auth.uid() and public.owns_passport(passport_id))
  with check (parent_id = auth.uid() and public.owns_passport(passport_id));

create policy "Verified linked clinicians can view calm episodes"
  on public.calm_episodes
  for select
  to authenticated
  using (
    public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = calm_episodes.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

-- No policy at all for class_teacher -- zero access, by omission,
-- matching every other clinical/calm table in this app.

-- ============================================================

create table public.calm_escalation_notices (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  calm_episode_id uuid references public.calm_episodes (id) on delete set null,
  occurred_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index calm_escalation_notices_passport_id_idx on public.calm_escalation_notices (passport_id);

alter table public.calm_escalation_notices enable row level security;

create policy "Verified linked clinicians can view escalation notices"
  on public.calm_escalation_notices
  for select
  to authenticated
  using (
    public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = calm_escalation_notices.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

create policy "Verified linked clinicians can acknowledge escalation notices"
  on public.calm_escalation_notices
  for update
  to authenticated
  using (
    public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = calm_escalation_notices.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  )
  with check (
    public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = calm_escalation_notices.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

-- No policy at all for parent OR class_teacher on this table -- see
-- header comment. The parent's only path to a row in this table is
-- through record_calm_episode() below, which is SECURITY DEFINER.

-- ============================================================
-- activity_log: new event type + feed/visibility wiring
-- ============================================================

alter table public.activity_log drop constraint if exists activity_log_event_type_check;
alter table public.activity_log add constraint activity_log_event_type_check
  check (event_type in (
    'passport_updated', 'morning_checkin', 'afternoon_update', 'abc_logged',
    'passport_shared', 'team_linked', 'clinician_logged', 'strategy_logged',
    'access_revoked', 'fba_started', 'fba_completed', 'clinical_content_added',
    'questionnaire_sent', 'questionnaire_completed', 'calm_escalation'
  ));

alter policy "Parents can view activity for their own passport"
  on public.activity_log
  using (
    public.owns_passport(passport_id)
    and event_type not in ('questionnaire_sent', 'questionnaire_completed', 'calm_escalation')
  );

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
    and al.event_type in (
      'abc_logged', 'passport_updated', 'clinician_logged', 'team_linked',
      'access_revoked', 'fba_started', 'fba_completed', 'clinical_content_added',
      'questionnaire_sent', 'questionnaire_completed', 'calm_escalation'
    )
  order by al.created_at desc
  limit p_limit offset p_offset;
$$;

-- get_teacher_activity_feed() needs no change -- 'calm_escalation' is
-- simply never added to its allow-list, correct by omission.

-- ============================================================
-- RPCs
-- ============================================================

create or replace function public.record_calm_episode(
  p_passport_id uuid,
  p_door_type text,
  p_tags_selected text[],
  p_cards_shown uuid[],
  p_reached_safety boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_episode_id uuid;
  v_child_name text;
begin
  if not public.owns_passport(p_passport_id) then
    raise exception 'Not authorized for this passport';
  end if;

  insert into public.calm_episodes (passport_id, parent_id, door_type, tags_selected, cards_shown, reached_safety)
  values (p_passport_id, auth.uid(), p_door_type, p_tags_selected, p_cards_shown, p_reached_safety)
  returning id into v_episode_id;

  if p_reached_safety then
    insert into public.calm_escalation_notices (passport_id, calm_episode_id)
    values (p_passport_id, v_episode_id);

    select child_name into v_child_name from public.passports where id = p_passport_id;

    insert into public.activity_log (passport_id, actor_id, event_type, event_description)
    values (
      p_passport_id,
      auth.uid(),
      'calm_escalation',
      coalesce(v_child_name, 'A child') || '''s parent used the emergency escalation -- please make contact as soon as possible'
    );
  end if;

  return v_episode_id;
end;
$$;

grant execute on function public.record_calm_episode(uuid, text, text[], uuid[], boolean) to authenticated;

create or replace function public.attach_calm_episode_abc_log(
  p_episode_id uuid,
  p_abc_log_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.calm_episodes
  set abc_log_id = p_abc_log_id
  where id = p_episode_id
    and parent_id = auth.uid();
end;
$$;

grant execute on function public.attach_calm_episode_abc_log(uuid, uuid) to authenticated;

create or replace function public.acknowledge_calm_escalation(p_notice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.calm_escalation_notices
  set acknowledged_at = now(), acknowledged_by = auth.uid()
  where id = p_notice_id
    and public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = calm_escalation_notices.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    );
end;
$$;

grant execute on function public.acknowledge_calm_escalation(uuid) to authenticated;
