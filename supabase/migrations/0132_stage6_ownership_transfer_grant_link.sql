-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 2, Stage 6 follow-up -- fold the transfer link in now, while
-- resolve_lapsed_incident_ownership() is the one place that ever
-- observes both halves (the incident losing its owner, and the grant
-- that made them eligible in the first place) in the same
-- transaction. Matching institution + person + date afterwards, from
-- a dashboard card or anywhere else, is reconstruction with growing
-- ambiguity as more grants accumulate for the same person over time --
-- this is a record, made once, at the moment of highest certainty.
--
-- temporary_access_id -- nullable, no backfill. Two real reasons
-- ownership can lapse (can_own_incident(), 0107): a temporary grant
-- ending, or a genuine class_teacher's own institution_staff row being
-- deactivated -- the second has no temporary_access row to link to at
-- all, and existing transfer rows predate this column entirely and
-- can't be attributed without inferring one. An inferred foreign key
-- in an audit trail is a false statement -- same reasoning as
-- enrolment_id in PRD 1 Stage 6 (0121/0122): a column that means
-- "we're confident this is the record that caused it" has to stay
-- genuinely unknown where it's genuinely unknown, not backfilled to
-- the nearest plausible guess.
--
-- Populated as a best-effort match, not a guaranteed precise one, and
-- said so in the code: the most recent temporary_access row for this
-- person at this institution, dated today or earlier. resolve_lapsed_
-- incident_ownership() has no record of which specific grant was live
-- when the incident was first created (create_incident_stamp() never
-- stored one), so this is the closest derivable link, made at the
-- moment of highest available certainty rather than not at all. If no
-- such row exists (the deactivated-class_teacher case), it stays null
-- -- correctly, not a wrong guess.
--
-- Not built here, deliberately: any UI surfacing this. Stage 7 specs
-- an inherited-incidents dashboard card that needs exactly this link;
-- surfacing belongs there. This migration only makes the data exist.

alter table public.incident_ownership_transfers
  add column temporary_access_id uuid references public.temporary_access (id);

create or replace function public.resolve_lapsed_incident_ownership(p_institution_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_principal_id uuid;
  v_resolved integer := 0;
  v_incident record;
  v_temporary_access_id uuid;
begin
  if not exists (
    select 1 from public.institution_staff s
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.deactivated_at is null
      and s.approved_at is not null
  ) then
    raise exception 'Only active staff at this institution can resolve incident ownership here.';
  end if;

  select user_id into v_principal_id
  from public.institution_staff
  where institution_id = p_institution_id
    and role = 'principal'
    and deactivated_at is null
    and approved_at is not null
  limit 1;

  if v_principal_id is null then
    return 0;
  end if;

  for v_incident in
    select distinct i.id, i.owning_teacher_id
    from public.incidents i
    join public.incident_children ic on ic.incident_id = i.id
    where i.institution_id = p_institution_id
      and i.teacher_signed_at is null
      and i.owning_teacher_id is not null
      and i.owning_teacher_id <> v_principal_id
      and not public.can_own_incident(i.owning_teacher_id, p_institution_id)
  loop
    update public.incidents set owning_teacher_id = v_principal_id where id = v_incident.id;

    -- Best-effort, not a guaranteed precise causal link -- see the
    -- migration's own header. Null when no temporary_access row exists
    -- for this person at all (the deactivated-class_teacher case).
    select id into v_temporary_access_id
    from public.temporary_access
    where granted_to = v_incident.owning_teacher_id
      and institution_id = p_institution_id
      and granted_for_date <= (now() at time zone public.app_local_timezone())::date
    order by granted_for_date desc, created_at desc
    limit 1;

    insert into public.incident_ownership_transfers (incident_id, from_teacher_id, to_principal_id, reason, temporary_access_id)
    values (v_incident.id, v_incident.owning_teacher_id, v_principal_id, 'Temporary access ended before this incident was signed off.', v_temporary_access_id);

    v_resolved := v_resolved + 1;
  end loop;

  return v_resolved;
end;
$$;

grant execute on function public.resolve_lapsed_incident_ownership(uuid) to authenticated;
