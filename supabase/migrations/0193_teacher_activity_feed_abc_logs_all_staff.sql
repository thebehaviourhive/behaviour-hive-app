-- Stage 4, item 3's own teacher-half check (item 39): a teacher should
-- already see ABC logs for children they can access, via get_teacher_
-- activity_feed()'s own has_child_access() gate (fixed in Group B,
-- migration 0188). Confirmed live, not assumed, that this was still
-- broken: the activity_log branch's WHERE clause has a SEPARATE
-- restriction, unrelated to has_child_access() -- `and (al.event_type
-- <> 'abc_logged' or al.actor_id = auth.uid())` -- so an abc_logged
-- row only ever showed if the VIEWER THEMSELVES was the one who logged
-- it. A class teacher with full class-derived access to a child could
-- not see an SNA's own ABC log entry for that same child in their
-- activity feed, even though the ABC Logs tab itself (get_abc_logs())
-- has always correctly shown every staff member's entries to anyone
-- with has_child_access() -- this self-authored restriction was unique
-- to the FEED, not the underlying data visibility. A straight bug, not
-- a deliberate narrowing: nothing else in this schema treats "logged
-- it yourself" as a precondition for seeing a colleague's ABC entry
-- about a child you both have access to.
--
-- Same signature, CREATE OR REPLACE is safe.
create or replace function public.get_teacher_activity_feed(
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
    where public.has_child_access(auth.uid(), al.passport_id)
      and al.event_type in (
        'passport_updated', 'abc_logged', 'team_linked', 'strategy_logged',
        'access_revoked', 'afternoon_update', 'clinical_content_added'
      )
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

    union all

    -- Support alerts -- institution-wide, not per-child (passport_id/
    -- child_name null, same as the parent activity feed's own
    -- non-incident rows). Same audience support_alerts' own RLS SELECT
    -- policy already grants: any active institution_staff member at
    -- this alert's school.
    select
      sa.id, null::uuid, null::text, 'support_alert'::text,
      'Support Requested'
        || case when array_length(sa.room_names, 1) > 0 then ' - ' || array_to_string(sa.room_names, ', ') else '' end
        || case
             when sa.closed_at is null then ''
             when sa.is_likely_mistap then ' - cancelled'
             else ' - resolved'
           end,
      sa.raised_at, null::uuid
    from public.support_alerts sa
    where exists (
      select 1 from public.institution_staff s
      where s.institution_id = sa.institution_id
        and s.user_id = auth.uid()
        and s.deactivated_at is null
        and s.approved_at is not null
    )
  ) combined
  order by created_at desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.get_teacher_activity_feed(integer, integer) to authenticated;
