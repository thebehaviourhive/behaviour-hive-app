-- Phase 4, piece 4 (part 1 of 2 -- clinician notification still open).
-- Two-stage parent notification and the parent-call flag's remaining
-- gap (parent_called_at/by had no write path at all).
--
-- Redaction rules matter more than the mechanics here -- this is the
-- first thing in this module that leaves the building.

-- =====================================================================
-- 1. Fix get_parent_incidents(): a real, separate bug found while
-- building this piece, not introduced by it. It gated on
-- i.status <> 'draft', which was correct when written (0068) but drifted
-- in meaning once 0089 made status derive from attestations_requested --
-- status now leaves 'draft' well before teacher sign-off, so this RPC
-- was handing a parent the full parent_summary plus injury/restrictive-
-- practice detail as soon as the teacher requested attestations,
-- contradicting "at teacher sign-off, not before". Audited every other
-- status <> 'draft' occurrence in the schema (0068/0075/0078/0089, seven
-- total): all six of the others are inside can_view_incident()'s
-- deliberate staff "once past draft" visibility branches, unchanged from
-- this session's own earlier review -- this is the only one that had
-- actually drifted. No client currently calls this RPC (checked), so
-- unexploited, but a real query-level gap regardless.
--
-- Byte-identical otherwise to the live definition (0075's rename of
-- principal_signed_at -> countersigned_at).
create or replace function public.get_parent_incidents(p_passport_id uuid)
returns table (
  incident_id uuid, occurred_at timestamptz, recorded_at timestamptz, location text,
  status text, parent_summary text, child_index text, distress_level text,
  remained_on_site boolean, remained_detail text, recovery_methods text[],
  parent_call_required boolean, parent_called_at timestamptz, parent_notified_at timestamptz,
  teacher_signed_at timestamptz, countersigned_at timestamptz, injuries jsonb, restrictive_practice jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select
    i.id as incident_id, i.occurred_at, i.recorded_at, loc.value as location, i.status, i.parent_summary,
    ic.child_index, ic.distress_level, ic.remained_on_site, ic.remained_detail, ic.recovery_methods,
    ic.parent_call_required, ic.parent_called_at, ic.parent_notified_at, i.teacher_signed_at, i.countersigned_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'injury_types', inj.injury_types, 'injury_notes', inj.injury_notes,
        'first_aider_called', inj.first_aider_called, 'first_aider_name', inj.first_aider_name,
        'doctor_ambulance_called', inj.doctor_ambulance_called, 'treatments', inj.treatments,
        'treatment_other', inj.treatment_other, 'remained_on_site', inj.remained_on_site, 'remained_detail', inj.remained_detail
      ))
      from public.incident_injuries inj
      where inj.incident_id = i.id and inj.injured_party_type = 'student' and inj.passport_id = p_passport_id
    ), '[]'::jsonb) as injuries,
    coalesce((
      select jsonb_agg(jsonb_build_object('planning_status', rp.planning_status, 'ncse_report_complete', rp.ncse_report_complete))
      from public.restrictive_practices rp
      where rp.incident_id = i.id and rp.passport_id = p_passport_id
    ), '[]'::jsonb) as restrictive_practice
  from public.incidents i
  join public.incident_children ic on ic.incident_id = i.id and ic.passport_id = p_passport_id
  join public.incident_locations loc on loc.id = i.location_id
  where public.owns_passport(p_passport_id)
    and i.teacher_signed_at is not null
  order by i.occurred_at desc;
$$;

-- =====================================================================
-- 2. incident_children: one new column. A staff-visible reason when a
-- notification attempt was blocked, cleared automatically the moment a
-- later attempt succeeds (accounts don't go dormant again once
-- confirmed -- monotonic in the same direction as parent_call_required
-- itself, just the opposite value).
-- =====================================================================
alter table public.incident_children
  add column parent_notification_blocked_reason text
  check (parent_notification_blocked_reason is null or parent_notification_blocked_reason in ('dormant_account'));

-- =====================================================================
-- 3. parent_incident_notices -- same shape as school_notices, parent-
-- scoped instead of staff-scoped, no body column: the client sources
-- actual content from incidents.occurred_at at stage 1 and from
-- get_parent_incidents() at stage 2, never a duplicated string stored
-- here. Per-passport by construction (not nullable, unlike
-- school_notices' optional passport_id) -- this table only ever exists
-- to be about exactly one child.
-- =====================================================================
create table public.parent_incident_notices (
  id uuid primary key default gen_random_uuid(),
  notice_type text not null check (notice_type in ('incident_recorded', 'incident_summary_ready')),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  passport_id uuid not null references public.passports (id) on delete cascade,
  institution_id uuid not null references public.institutions (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index parent_incident_notices_passport_id_idx on public.parent_incident_notices (passport_id);
create index parent_incident_notices_incident_id_idx on public.parent_incident_notices (incident_id);

alter table public.parent_incident_notices enable row level security;

create policy "Parent can view their own child's incident notices"
  on public.parent_incident_notices for select to authenticated
  using (public.owns_passport(passport_id));

-- No INSERT/UPDATE/DELETE policy for authenticated at all -- system-
-- written only, via the two trigger functions below (bypass RLS via
-- table ownership), same as school_notices' own established pattern.

-- =====================================================================
-- 4. Stage 1 -- fires on every incident_children insert (the 15-second
-- stamp). Dormant check fails closed: any lookup failure blocks rather
-- than silently notifies -- a teacher believing a parent was told when
-- they weren't is worse than a visible gap.
-- =====================================================================
create or replace function public.notify_parent_of_incident_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_id uuid;
  v_dormant boolean;
  v_institution_id uuid;
begin
  select p.user_id into v_parent_id from public.passports p where p.id = new.passport_id;

  select (u.email_confirmed_at is null or u.last_sign_in_at is null)
  into v_dormant
  from auth.users u
  where u.id = v_parent_id;

  if coalesce(v_dormant, true) then
    update public.incident_children
    set parent_notification_blocked_reason = 'dormant_account'
    where id = new.id;
    return new;
  end if;

  select i.institution_id into v_institution_id from public.incidents i where i.id = new.incident_id;

  insert into public.parent_incident_notices (notice_type, incident_id, passport_id, institution_id)
  values ('incident_recorded', new.incident_id, new.passport_id, v_institution_id);

  update public.incident_children
  set parent_notified_at = now(), parent_notified_by = new.added_by, parent_notification_blocked_reason = null
  where id = new.id;

  return new;
end;
$$;

create trigger notify_parent_on_incident_children_insert
  after insert on public.incident_children
  for each row
  execute function public.notify_parent_of_incident_stamp();

-- =====================================================================
-- 5. Stage 2 -- fires on the teacher_signed_at null->not-null
-- transition, once per named child, same dormant handling as stage 1.
-- AFTER UPDATE (not BEFORE, unlike derive_incident_status()/
-- derive_countersign_fields()) -- this trigger only performs side
-- effects on OTHER tables/rows, never modifies NEW itself.
-- =====================================================================
create or replace function public.notify_parents_of_incident_signoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child record;
  v_parent_id uuid;
  v_dormant boolean;
begin
  if new.teacher_signed_at is not null and old.teacher_signed_at is null then
    for v_child in
      select ic.id, ic.passport_id from public.incident_children ic where ic.incident_id = new.id
    loop
      select p.user_id into v_parent_id from public.passports p where p.id = v_child.passport_id;

      select (u.email_confirmed_at is null or u.last_sign_in_at is null)
      into v_dormant
      from auth.users u
      where u.id = v_parent_id;

      if coalesce(v_dormant, true) then
        update public.incident_children
        set parent_notification_blocked_reason = 'dormant_account'
        where id = v_child.id;
        continue;
      end if;

      insert into public.parent_incident_notices (notice_type, incident_id, passport_id, institution_id)
      values ('incident_summary_ready', new.id, v_child.passport_id, new.institution_id);

      update public.incident_children
      set parent_notified_at = now(), parent_notified_by = new.teacher_signed_by, parent_notification_blocked_reason = null
      where id = v_child.id;
    end loop;
  end if;
  return new;
end;
$$;

create trigger notify_parents_on_teacher_signoff
  after update on public.incidents
  for each row
  execute function public.notify_parents_of_incident_signoff();

-- =====================================================================
-- 6. mark_parent_called -- the only write path for parent_called_at/by
-- (previously dead columns, nothing wrote them at all). Same "who can
-- act on this flag" set as school_notices' own visibility (principal or
-- incident creator/owning teacher). Overwritable, not append-only -- a
-- real phone call may need retrying; this isn't an audit-immutable
-- record the way attestations/messages are.
-- =====================================================================
create or replace function public.mark_parent_called(p_incident_children_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident_id uuid;
begin
  select incident_id into v_incident_id from public.incident_children where id = p_incident_children_id;
  if v_incident_id is null then
    raise exception 'Not found, or you do not have permission.';
  end if;

  if not exists (
    select 1 from public.incidents i
    where i.id = v_incident_id
      and (
        i.created_by = auth.uid()
        or i.owning_teacher_id = auth.uid()
        or exists (
          select 1 from public.institution_staff s
          join public.institutions inst on inst.id = s.institution_id
          where s.institution_id = i.institution_id
            and s.user_id = auth.uid()
            and s.role = 'principal'
            and inst.status = 'verified'
        )
      )
  ) then
    raise exception 'You do not have permission to mark this parent as called.';
  end if;

  update public.incident_children
  set parent_called_at = now(), parent_called_by = auth.uid()
  where id = p_incident_children_id;
end;
$$;

grant execute on function public.mark_parent_called(uuid) to authenticated;
