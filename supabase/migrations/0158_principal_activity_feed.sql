-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Support Button, item 6 -- the principal's Activity container.
--
-- SCOPE: institutional/operational events, not whole-school-per-child
-- (that's the teacher's own job, and duplicating it here breaks the
-- privacy posture the incident work-queue buckets already hold -- see
-- that page's own "deliberate privacy boundary" comment) and not
-- narrowly self-only (too thin to mean anything for a role that isn't
-- a participant in most school events the way a parent or teacher is).
--
-- THIS PASS: support_alerts only, the first real candidate. The UNION
-- shape is ready for more branches (staff joins/leaves, class-teacher
-- or principal handovers, temporary access grants) but none of those
-- are built here -- each is a real, separate decision, not bolted on
-- speculatively.
--
-- Row shape is deliberately LEANER than get_teacher/clinician/parent_
-- activity_feed() -- no passport_id/child_name/incident_id, because
-- this feed's rows are institution-wide by construction, never per-
-- child. Widen it if a future branch genuinely needs one of those
-- columns, not preemptively.
--
-- Principal-only, own institution -- institution_staff_has_current_
-- standing() per CLAUDE.md's own rule against hand-writing deactivated_
-- at/approved_at conditions again.

create or replace function public.get_principal_activity_feed(
  p_limit integer default 20, p_offset integer default 0
)
returns table (
  id uuid, event_type text, event_description text, created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select * from (
    -- Support alerts -- same event_description shape as the teacher
    -- feed's own branch (0155): room(s) plus resolved/cancelled once
    -- closed, nothing while still open (the transformed nav bar is
    -- that surface, not this one).
    select
      sa.id, 'support_alert'::text,
      'Support Requested'
        || case when array_length(sa.room_names, 1) > 0 then ' - ' || array_to_string(sa.room_names, ', ') else '' end
        || case
             when sa.closed_at is null then ''
             when sa.is_likely_mistap then ' - cancelled'
             else ' - resolved'
           end,
      sa.raised_at as created_at
    from public.support_alerts sa
    where exists (
      select 1 from public.institution_staff s
      where s.institution_id = sa.institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
    )
    and public.institution_staff_has_current_standing(auth.uid(), sa.institution_id)
  ) combined
  order by created_at desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.get_principal_activity_feed(integer, integer) to authenticated;
