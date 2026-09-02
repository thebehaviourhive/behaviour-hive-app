-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Two independent pieces, combined here because both touch
-- incident_children and both were scoped in the same recon pass.
--
-- =====================================================================
-- PART 1: incidents in the Activity feed -- parent, teacher, clinician.
-- =====================================================================
--
-- Not principal, not SNA -- both parked deliberately. Principal has no
-- existing ABC-log visibility at all (get_abc_logs() has no principal
-- branch), so adding it here would be a new grant smuggled into a
-- display change, not a re-surfacing of something already authorised.
-- SNA has no activity panel and no serving RPC -- a new surface, not an
-- extension of an existing one. Neither is touched.
--
-- ONE FEED, SQL-SIDE: each of the three widened/new functions UNIONs
-- the audience's existing activity_log rows with an incidents branch
-- using THE SAME PREDICATE that already authorises that audience to see
-- those incidents elsewhere in the schema -- never a new one:
--   - Parent:    owns_passport() + teacher_signed_at is not null
--                (exactly get_parent_incidents()'s own gate, 0093)
--   - Teacher:   status <> 'draft' AND has_child_access()
--                (exactly can_view_incident()'s own child branch, 0104)
--   - Clinician: is_verified_clinician() + active clinician_access +
--                status <> 'draft'
--                (exactly get_clinician_incidents()'s own gate, 0095)
-- No access widens. get_my_incidents() (the teacher's OWNERSHIP-scoped
-- work queue) is untouched -- a different question ("incidents I must
-- finish") from the activity feed's ("incidents about children I can
-- see"), deliberately answered by two functions, not one doing both.
--
-- ORDERING: incident rows sort on occurred_at (when it happened), not
-- recorded_at/teacher_signed_at (when it was administratively
-- finished) -- matching how every other activity_log row is timestamped
-- (when the thing happened), because this feed's own purpose is seeing
-- a pattern over time, not "what's new" (that's IncidentNoticeCard's
-- job, on the parent track, entirely untouched by this migration). A
-- sign-off delayed by days means the incident can appear further back
-- in the feed than the day it was actually revealed -- an accurate
-- reflection of when the underlying event happened, not a bug.
--
-- ONE ROW PER (incident, accessible child), matching every other
-- activity_log row's own per-passport granularity -- a two-child
-- incident where the caller has access to both children legitimately
-- produces two rows, not one merged row, same as two separate ABC logs
-- would.
--
-- CREATE OR REPLACE cannot change a RETURNS TABLE column list (adding
-- incident_id) -- DROP + CREATE for the two existing functions, matching
-- established precedent for this exact trap.

drop function if exists public.get_teacher_activity_feed(integer, integer);

create function public.get_teacher_activity_feed(
  p_limit integer default 20, p_offset integer default 0
)
returns table (
  id uuid, passport_id uuid, child_name text, event_type text,
  event_description text, created_at timestamptz, incident_id uuid
)
language sql
security definer
set search_path = public
stable
as $$
  select * from (
    select al.id, al.passport_id, p.child_name, al.event_type, al.event_description, al.created_at,
      null::uuid as incident_id
    from public.activity_log al
    join public.passports p on p.id = al.passport_id
    where (
        exists (
          select 1 from public.passport_access pa
          join public.passport_institution_links pil
            on pil.passport_id = pa.passport_id and pil.institution_id = pa.institution_id
          where pa.passport_id = al.passport_id
            and pa.teacher_id = auth.uid()
            and pa.is_active = true
            and pa.actor_role = 'class_teacher'
        )
        or exists (
          select 1
          from public.class_children cc
          join public.classes c on c.id = cc.class_id
          join public.class_teachers ct on ct.class_id = c.id
          join public.institution_staff s on s.user_id = ct.user_id and s.institution_id = c.institution_id
          join public.passport_institution_links pil
            on pil.passport_id = cc.passport_id and pil.institution_id = c.institution_id
          where cc.passport_id = al.passport_id
            and cc.ended_at is null
            and ct.user_id = auth.uid()
            and ct.ended_at is null
            and s.deactivated_at is null
            and s.approved_at is not null
        )
        or exists (
          select 1
          from public.class_children cc
          join public.classes c on c.id = cc.class_id
          join public.class_sna_assignments csa on csa.class_id = c.id
          join public.institution_staff s on s.user_id = csa.user_id and s.institution_id = c.institution_id
          join public.passport_institution_links pil
            on pil.passport_id = cc.passport_id and pil.institution_id = c.institution_id
          where cc.passport_id = al.passport_id
            and cc.ended_at is null
            and csa.user_id = auth.uid()
            and csa.ended_at is null
            and s.deactivated_at is null
            and s.approved_at is not null
        )
      )
      and al.event_type in (
        'passport_updated', 'abc_logged', 'team_linked', 'strategy_logged',
        'access_revoked', 'afternoon_update', 'clinical_content_added'
      )
      and (al.event_type <> 'abc_logged' or al.actor_id = auth.uid())
      and not exists (
        select 1 from public.clinicians c where c.user_id = al.actor_id
      )

    union all

    -- Incidents -- exactly can_view_incident()'s own child branch
    -- (0104): status <> 'draft' and has_child_access() on the child.
    select ic.id, ic.passport_id, p.child_name, 'incident'::text, 'An incident was recorded.'::text,
      i.occurred_at, i.id as incident_id
    from public.incident_children ic
    join public.incidents i on i.id = ic.incident_id
    join public.passports p on p.id = ic.passport_id
    where i.status <> 'draft'
      and public.has_child_access(auth.uid(), ic.passport_id)
  ) combined
  order by created_at desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.get_teacher_activity_feed(integer, integer) to authenticated;

drop function if exists public.get_clinician_activity_feed(integer, integer);

create function public.get_clinician_activity_feed(
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  passport_id uuid,
  child_name text,
  event_type text,
  event_description text,
  created_at timestamptz,
  incident_id uuid
)
language sql
security definer
set search_path = public
stable
as $$
  select * from (
    select al.id, al.passport_id, p.child_name, al.event_type, al.event_description, al.created_at,
      null::uuid as incident_id
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

    union all

    -- Incidents -- exactly get_clinician_incidents()'s own gate (0095):
    -- verified clinician, active clinician_access, status <> 'draft'.
    select ic.id, ic.passport_id, p.child_name, 'incident'::text, 'An incident was recorded.'::text,
      i.occurred_at, i.id as incident_id
    from public.incident_children ic
    join public.incidents i on i.id = ic.incident_id
    join public.passports p on p.id = ic.passport_id
    join public.clinician_access ca on ca.passport_id = ic.passport_id
    where ca.clinician_id = auth.uid()
      and ca.is_active = true
      and public.is_verified_clinician(auth.uid())
      and i.status <> 'draft'
  ) combined
  order by created_at desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.get_clinician_activity_feed(integer, integer) to authenticated;

-- New for the parent track -- parent activity has never had a
-- dedicated RPC (the client queries activity_log directly, RLS as the
-- sole gate); a UNION with incidents needs a function, so this is new,
-- not a widening. Mirrors the live activity_log RLS policy (0054)
-- exactly for the activity_log half.
create function public.get_parent_activity_feed(
  p_passport_id uuid,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid, event_type text, event_description text, created_at timestamptz, incident_id uuid
)
language sql
security definer
set search_path = public
stable
as $$
  select * from (
    select al.id, al.event_type, al.event_description, al.created_at, null::uuid as incident_id
    from public.activity_log al
    where al.passport_id = p_passport_id
      and public.owns_passport(p_passport_id)
      and al.event_type not in ('questionnaire_sent', 'questionnaire_completed', 'calm_escalation')

    union all

    -- Incidents -- exactly get_parent_incidents()'s own gate (0093):
    -- owns_passport() + teacher_signed_at is not null.
    select ic.id, 'incident'::text, coalesce(i.parent_summary, 'The school has completed this record.'), i.occurred_at, i.id
    from public.incident_children ic
    join public.incidents i on i.id = ic.incident_id
    where ic.passport_id = p_passport_id
      and public.owns_passport(p_passport_id)
      and i.teacher_signed_at is not null
  ) combined
  order by created_at desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.get_parent_activity_feed(uuid, integer, integer) to authenticated;

-- =====================================================================
-- PART 2: acknowledge_incident() -- a parent's own record of having
-- seen an incident, distinct from parent_notified_at (we sent a
-- notice) and parent_called_at (we telephoned them). Same table, same
-- audit-pair shape as those two, and as calm_escalation_notices'
-- acknowledged_at/acknowledged_by (0054).
-- =====================================================================

alter table public.incident_children
  add column parent_acknowledged_at timestamptz,
  add column parent_acknowledged_by uuid references auth.users (id);

-- AFTER SIGN-OFF ONLY: a parent gets a time-only notice at the stamp
-- and the full account at sign-off (get_parent_incidents()'s own gate,
-- 0093) -- acknowledging the first would mean acknowledging they know
-- SOMETHING happened, not WHAT. Enforced here, at the write, not just
-- left to the client to gate -- matching mark_parent_called()'s own
-- explicit found/not-found + raise pattern (0100), not
-- acknowledge_calm_escalation()'s silent no-op-on-mismatch (0054): a
-- client seeing no error on a no-op UPDATE is exactly the silent-
-- failure trap this schema has been bitten by before.
create or replace function public.acknowledge_incident(p_incident_children_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.incident_children;
  v_incident public.incidents;
begin
  select * into v_row from public.incident_children where id = p_incident_children_id;
  if not found then
    raise exception 'Not found, or you do not have permission.';
  end if;

  if not public.owns_passport(v_row.passport_id) then
    raise exception 'Only this child''s own parent or guardian can acknowledge this incident.';
  end if;

  select * into v_incident from public.incidents where id = v_row.incident_id;

  if v_incident.teacher_signed_at is null then
    raise exception 'This incident''s full record isn''t ready yet.';
  end if;

  if v_row.parent_acknowledged_at is not null then
    raise exception 'This has already been acknowledged.';
  end if;

  update public.incident_children
  set parent_acknowledged_at = now(), parent_acknowledged_by = auth.uid()
  where id = p_incident_children_id;
end;
$$;

grant execute on function public.acknowledge_incident(uuid) to authenticated;

-- get_parent_incidents() widened: the incident_children row id (needed
-- to call acknowledge_incident() -- nothing before this returned it)
-- and parent_acknowledged_at, so the parent's own detail page can show
-- the button in the right state without a second round trip. Same
-- DROP + CREATE requirement as above.
drop function if exists public.get_parent_incidents(uuid);

create function public.get_parent_incidents(p_passport_id uuid)
returns table (
  incident_id uuid, incident_children_id uuid, occurred_at timestamptz, recorded_at timestamptz, location text,
  status text, parent_summary text, child_index text, distress_level text,
  remained_on_site boolean, remained_detail text, recovery_methods text[],
  parent_call_required boolean, parent_called_at timestamptz, parent_notified_at timestamptz,
  parent_acknowledged_at timestamptz,
  teacher_signed_at timestamptz, countersigned_at timestamptz, injuries jsonb, restrictive_practice jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select
    i.id as incident_id, ic.id as incident_children_id, i.occurred_at, i.recorded_at, loc.value as location,
    i.status, i.parent_summary,
    ic.child_index, ic.distress_level, ic.remained_on_site, ic.remained_detail, ic.recovery_methods,
    ic.parent_call_required, ic.parent_called_at, ic.parent_notified_at, ic.parent_acknowledged_at,
    i.teacher_signed_at, i.countersigned_at,
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

grant execute on function public.get_parent_incidents(uuid) to authenticated;
