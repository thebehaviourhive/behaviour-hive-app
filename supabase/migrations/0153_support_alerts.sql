-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Support Button -- stage 1 (SQL) of the crisis-assistance feature.
-- Replacing a school-wide WhatsApp group, so the shape is deliberately
-- narrow: name the teacher and the room, NEVER the child; anyone at the
-- school can acknowledge; only the raiser closes it.
--
-- THE ROOM IS RESOLVED AT RAISE TIME, CLIENT-SIDE -- Daniel's own call,
-- and it removes what would otherwise have been the largest new SQL
-- surface in this feature. The client already knows the raiser's own
-- classes (teacher/class/page.tsx's own class_teachers query); the
-- three edge cases from recon (multiple classes, none, SNA assigned to
-- a child not a room) are all resolved by what the raise SCREEN shows
-- and lets them pick or leave empty -- not by a server-side resolver.
-- room_names is therefore a plain text[] the client passes in, not
-- derived from class_teachers/class_sna_assignments/child_assignments
-- server-side. Empty array is a valid, designed-for case: "[Teacher
-- name] needs assistance" with no room named is still worth more than a
-- refusal to raise.
--
-- TWO TABLES: support_alerts (one row per raise), support_alert_
-- acknowledgements (one row per person who's seen it, unique per
-- person per alert so acknowledging twice is a no-op, not an error).
-- Same shape family as calm_escalation_notices (0054) -- raise, persist
-- until acted on, acknowledge -- but acknowledgement here doesn't close
-- it; only the raiser's own close does, per spec.
--
-- CLOSE-TIME MISTAP LOGIC: is_likely_mistap is computed once, at close,
-- by the RPC itself -- true if closed within 15 seconds of being
-- raised, OR if nobody ever acknowledged it (Daniel's own instruction:
-- treat a zero-acknowledgement close the same as a mis-tap, whatever
-- the elapsed time -- both mean nobody was in a position to help or it
-- didn't need raising). This is a REPORTING signal, not a
-- consequence -- nothing in this migration treats it as a failure by
-- the raiser; it's recorded so it isn't miscounted as a real callout
-- later.
--
-- NOT BUILT HERE (stage 3, deliberately not started): the ambient
-- "everyone sees it without navigating" surfacing. get_active_support_
-- alerts() below returns currently-open alerts to whoever calls it --
-- there is no ongoing mechanism yet that pushes this to a screen a
-- person hasn't navigated to. See the separate report on realistic
-- reach before that gets built.

-- =====================================================================
-- 1. support_alerts
-- =====================================================================

create table public.support_alerts (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  raised_by uuid not null references auth.users (id),
  room_names text[] not null default '{}',
  raised_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references auth.users (id),
  is_likely_mistap boolean,
  constraint support_alerts_closed_paired check (
    (closed_at is null and closed_by is null and is_likely_mistap is null)
    or (closed_at is not null and closed_by is not null and is_likely_mistap is not null)
  )
);

create index support_alerts_open_idx on public.support_alerts (institution_id) where closed_at is null;

alter table public.support_alerts enable row level security;

create policy "Institution staff can view support alerts for their own school"
  on public.support_alerts
  for select
  to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = support_alerts.institution_id
        and s.user_id = auth.uid()
        and s.deactivated_at is null
        and s.approved_at is not null
    )
  );

-- No client-facing INSERT/UPDATE policy -- every write goes through the
-- RPCs below, matching school_notices/clinician_incident_notices' own
-- established "system-written only" pattern.

-- =====================================================================
-- 2. support_alert_acknowledgements
-- =====================================================================

create table public.support_alert_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  support_alert_id uuid not null references public.support_alerts (id) on delete cascade,
  acknowledged_by uuid not null references auth.users (id),
  acknowledged_at timestamptz not null default now(),
  unique (support_alert_id, acknowledged_by)
);

alter table public.support_alert_acknowledgements enable row level security;

create policy "Institution staff can view acknowledgements for their own school's alerts"
  on public.support_alert_acknowledgements
  for select
  to authenticated
  using (
    exists (
      select 1 from public.support_alerts sa
      join public.institution_staff s on s.institution_id = sa.institution_id
      where sa.id = support_alert_acknowledgements.support_alert_id
        and s.user_id = auth.uid()
        and s.deactivated_at is null
        and s.approved_at is not null
    )
  );

-- =====================================================================
-- 3. raise_support_alert() -- teachers and SNAs only, no confirmation
--    step (the RPC itself IS the immediate action). Refuses a second
--    open alert from the same raiser -- one open alert per person at a
--    time, close the first before raising again.
-- =====================================================================

create or replace function public.raise_support_alert(
  p_institution_id uuid,
  p_room_names text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alert_id uuid;
begin
  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role in ('class_teacher', 'sna')
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) then
    raise exception 'Only an active teacher or SNA at this school can raise a support alert.';
  end if;

  if exists (
    select 1 from public.support_alerts
    where raised_by = auth.uid() and closed_at is null
  ) then
    raise exception 'You already have an open support alert. Close it before raising a new one.';
  end if;

  insert into public.support_alerts (institution_id, raised_by, room_names)
  values (p_institution_id, auth.uid(), coalesce(p_room_names, '{}'))
  returning id into v_alert_id;

  return v_alert_id;
end;
$$;

grant execute on function public.raise_support_alert(uuid, text[]) to authenticated;

-- =====================================================================
-- 4. acknowledge_support_alert() -- any active staff member at the same
--    school. Idempotent (ON CONFLICT DO NOTHING) -- acknowledging
--    twice is not an error, the unique constraint just makes the
--    second attempt a no-op.
-- =====================================================================

create or replace function public.acknowledge_support_alert(p_support_alert_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_institution_id uuid;
begin
  select institution_id into v_institution_id
  from public.support_alerts
  where id = p_support_alert_id and closed_at is null;

  if v_institution_id is null then
    raise exception 'This alert is no longer open.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    where s.institution_id = v_institution_id
      and s.user_id = auth.uid()
      and s.deactivated_at is null
      and s.approved_at is not null
  ) then
    raise exception 'Only active staff at this school can acknowledge this alert.';
  end if;

  insert into public.support_alert_acknowledgements (support_alert_id, acknowledged_by)
  values (p_support_alert_id, auth.uid())
  on conflict (support_alert_id, acknowledged_by) do nothing;
end;
$$;

grant execute on function public.acknowledge_support_alert(uuid) to authenticated;

-- =====================================================================
-- 5. close_support_alert() -- THE RAISER ONLY. Computes is_likely_mistap
--    here, once, at the moment of close -- see the migration header for
--    the rule and why it's a reporting signal, not a judgement.
-- =====================================================================

create or replace function public.close_support_alert(p_support_alert_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alert public.support_alerts;
  v_ack_count integer;
  v_is_mistap boolean;
begin
  select * into v_alert from public.support_alerts where id = p_support_alert_id;
  if not found then
    raise exception 'Not found.';
  end if;

  if v_alert.raised_by <> auth.uid() then
    raise exception 'Only the person who raised this can close it.';
  end if;

  if v_alert.closed_at is not null then
    raise exception 'This has already been closed.';
  end if;

  select count(*) into v_ack_count
  from public.support_alert_acknowledgements
  where support_alert_id = p_support_alert_id;

  v_is_mistap := (v_ack_count = 0) or (now() - v_alert.raised_at < interval '15 seconds');

  update public.support_alerts
  set closed_at = now(), closed_by = auth.uid(), is_likely_mistap = v_is_mistap
  where id = p_support_alert_id;
end;
$$;

grant execute on function public.close_support_alert(uuid) to authenticated;

-- =====================================================================
-- 6. get_active_support_alerts() -- currently-open alerts for an
--    institution, with who's acknowledged so far. Scope note: this
--    answers "what's open right now, for whoever calls it" -- it is
--    NOT the stage-3 ambient surfacing mechanism; nothing calls this on
--    a timer or a subscription yet.
-- =====================================================================

create or replace function public.get_active_support_alerts(p_institution_id uuid)
returns table (
  id uuid,
  raised_by uuid,
  raised_by_name text,
  room_names text[],
  raised_at timestamptz,
  is_own boolean,
  acknowledgements jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select
    sa.id,
    sa.raised_by,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as raised_by_name,
    sa.room_names,
    sa.raised_at,
    (sa.raised_by = auth.uid()) as is_own,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', ack.acknowledged_by,
          'name', coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_app_meta_data ->> 'full_name'),
          'acknowledged_at', ack.acknowledged_at
        )
        order by ack.acknowledged_at
      )
      from public.support_alert_acknowledgements ack
      join auth.users au on au.id = ack.acknowledged_by
      where ack.support_alert_id = sa.id
    ), '[]'::jsonb) as acknowledgements
  from public.support_alerts sa
  join auth.users u on u.id = sa.raised_by
  where sa.institution_id = p_institution_id
    and sa.closed_at is null
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and s.deactivated_at is null
        and s.approved_at is not null
    )
  order by sa.raised_at desc;
$$;

grant execute on function public.get_active_support_alerts(uuid) to authenticated;

-- =====================================================================
-- 7. The incident-flow field -- "Was the [Support Button] pressed?" A
--    plain boolean, not a link to a specific alert row: the ask was a
--    yes/no question on the incident record, not a structured
--    cross-reference. Existing incidents UPDATE policy (owning teacher,
--    pre-sign-off) already covers writes -- RLS is row-level, a new
--    column needs no new policy.
-- =====================================================================

alter table public.incidents
  add column support_button_pressed boolean not null default false;
