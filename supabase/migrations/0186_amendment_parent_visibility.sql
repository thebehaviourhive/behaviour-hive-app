-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- THE AMENDMENT LEAK, FIXED (CLAUDE.md, PARENT-VERSION INCIDENT PDF
-- entry, 0183's own "NAMED RISK, not solved here" comment). Confirmed
-- live during that entry's own verification pass: on a two-child
-- incident, Parent B's export and on-screen record showed the SAME
-- amendment text as Parent A's -- incident_amendments has no per-child
-- scoping at all, so if a principal's free text happens to name the
-- other child, that name reaches a family it was never meant to. 0183
-- named this as a content-authoring risk, not fixable by a WHERE
-- clause, and shipped only an authoring-time reminder. Decided: that
-- isn't enough on its own -- this is the one place free text can carry
-- another child's name into a document that leaves the app.
--
-- Fixed with an explicit author choice, not a database-level guess.
-- Weighed three options: omit amendments from the parent version
-- entirely (safe, but a parent loses a genuine correction to their own
-- child's record); require child-agnostic writing (unenforceable --
-- free text, no way to check it); or make sharing opt-in per amendment,
-- decided by the one person who actually knows what the amendment says
-- and who else is on the incident. Built the third: is_parent_visible,
-- set only by the amendment's own author at write time via an explicit
-- checkbox ("Share this amendment with the family"), default false.
--
-- EVERY EXISTING AMENDMENT DEFAULTS TO NOT SHARED. Nobody was asked
-- when they wrote it, so nothing retroactively becomes visible to a
-- parent who was never meant to see it -- a principal who wants an
-- existing correction shared has to add a fresh one and actively check
-- the box, a deliberate re-decision rather than a bulk migration of
-- intent nobody actually expressed.

alter table public.incident_amendments
  add column is_parent_visible boolean not null default false;

comment on column public.incident_amendments.is_parent_visible is
  'Set explicitly by the amendment''s own author at write time (AddAmendmentSheet''s "Share with the family" checkbox). Default false -- every amendment defaults to staff-only until its author chooses otherwise. Gates whether get_parent_incidents() includes this amendment in a parent''s own record/PDF.';

-- get_incident_amendments(): same signature (uuid), but the RETURNS
-- TABLE shape gains a column -- Postgres refuses that via bare CREATE
-- OR REPLACE ("cannot change return type of existing function"), so
-- DROP + CREATE, matching this schema's own established discipline for
-- any changed RETURNS TABLE shape, not only a changed parameter list.
-- Surfaced to the staff-side amendments list too (IncidentAmendmentsSection)
-- so a teacher/principal can see, without opening the parent PDF,
-- which of an incident's amendments a parent will actually see.
drop function if exists public.get_incident_amendments(uuid);

create function public.get_incident_amendments(p_incident_id uuid)
returns table (
  id uuid,
  reason text,
  content text,
  author_name text,
  created_at timestamptz,
  is_parent_visible boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.can_view_incident(p_incident_id) then
    raise exception 'You do not have permission to view this incident.';
  end if;

  return query
  select
    am.id,
    am.reason,
    am.content,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as author_name,
    am.created_at,
    am.is_parent_visible
  from public.incident_amendments am
  left join auth.users u on u.id = am.author_id
  where am.incident_id = p_incident_id
  order by am.created_at;
end;
$$;

grant execute on function public.get_incident_amendments(uuid) to authenticated;

-- get_parent_incidents(): same signature and same RETURNS TABLE shape
-- as the live 0183 definition (amendments stays a jsonb array) -- only
-- the subquery's WHERE clause changes to filter on the new column, so
-- CREATE OR REPLACE is the correct, safe form here (no overload risk,
-- no return-type change). Every other part of this function is
-- reproduced verbatim from 0183, unchanged.
create or replace function public.get_parent_incidents(p_passport_id uuid, p_incident_id uuid default null)
returns table (
  incident_id uuid, incident_children_id uuid, occurred_at timestamptz, recorded_at timestamptz, location text,
  status text, parent_summary text, child_index text, distress_level text,
  remained_on_site boolean, remained_detail text, recovery_methods text[],
  parent_call_required boolean, parent_called_at timestamptz, parent_notified_at timestamptz,
  parent_acknowledged_at timestamptz,
  teacher_signed_at timestamptz, countersigned_at timestamptz,
  restraint_used boolean,
  injuries jsonb, restrictive_practice jsonb, amendments jsonb
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
    exists (
      select 1 from public.restrictive_practices rp2
      where rp2.incident_id = i.id and rp2.passport_id = p_passport_id
    ) as restraint_used,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'injury_types', inj.injury_types, 'injury_notes', inj.injury_notes,
        'first_aider_called', inj.first_aider_called, 'first_aider_name', inj.first_aider_name,
        'doctor_ambulance_called', inj.doctor_ambulance_called, 'treatments', inj.treatments,
        'treatment_other', inj.treatment_other, 'remained_on_site', inj.remained_on_site, 'remained_detail', inj.remained_detail,
        'body_marks', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', bm.id, 'view', bm.view, 'x', bm.x, 'y', bm.y,
            'region_value', reg.value, 'side', bm.side,
            'injury_type_name', it.value, 'skin_broken', bm.skin_broken
          ) order by bm.created_at)
          from public.incident_body_marks bm
          join public.incident_body_regions reg on reg.id = bm.region_id
          join public.incident_injury_types it on it.id = bm.injury_type_id
          where bm.injury_id = inj.id
        ), '[]'::jsonb)
      ))
      from public.incident_injuries inj
      where inj.incident_id = i.id and inj.injured_party_type = 'student' and inj.passport_id = p_passport_id
    ), '[]'::jsonb) as injuries,
    coalesce((
      select jsonb_agg(jsonb_build_object('planning_status', rp.planning_status, 'ncse_report_complete', rp.ncse_report_complete))
      from public.restrictive_practices rp
      where rp.incident_id = i.id and rp.passport_id = p_passport_id
    ), '[]'::jsonb) as restrictive_practice,
    -- THE FIX: only amendments their own author explicitly marked
    -- parent-visible reach this function's caller at all -- every
    -- other column above stays exactly as 0183 defined it.
    coalesce((
      select jsonb_agg(jsonb_build_object('reason', am.reason, 'content', am.content, 'created_at', am.created_at) order by am.created_at)
      from public.incident_amendments am
      where am.incident_id = i.id and am.is_parent_visible = true
    ), '[]'::jsonb) as amendments
  from public.incidents i
  join public.incident_children ic on ic.incident_id = i.id and ic.passport_id = p_passport_id
  join public.incident_locations loc on loc.id = i.location_id
  where (public.owns_passport(p_passport_id) or public.can_view_incident(i.id))
    and i.teacher_signed_at is not null
    and (p_incident_id is null or i.id = p_incident_id)
  order by i.occurred_at desc;
$$;

grant execute on function public.get_parent_incidents(uuid, uuid) to authenticated;
