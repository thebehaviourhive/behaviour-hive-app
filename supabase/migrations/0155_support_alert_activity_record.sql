-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Support Button, item 5 -- the press must be recorded. It already was,
-- structurally: support_alerts (0153) already carries who raised it,
-- which room, when, when closed and by whom, and whether it was
-- cancelled inside the 15-second window (is_likely_mistap); support_
-- alert_acknowledgements already carries who acknowledged and when.
-- Nothing new to store -- what's missing is a way to SEE it as activity.
--
-- TEACHER ONLY, THIS MIGRATION. Widens get_teacher_activity_feed() with
-- a third UNION branch, institution-wide (any active institution_staff
-- member sees every alert at their own school, not just their own raise
-- -- matching support_alerts' own RLS SELECT policy exactly, the same
-- "same predicate that already authorises this audience elsewhere"
-- discipline 0152 established for the incidents branch). The principal
-- side is deliberately NOT built here -- it depends on how the
-- principal's own activity container is scoped, reported separately,
-- not decided in the same breath as this.
--
-- CANCELLED ALERTS ARE STILL LOGGED, distinctly. A record of what
-- happened is different from a notification (Daniel's own framing) --
-- a mis-tap closed inside 15 seconds sent nothing further to anyone
-- live (see the report: no follow-up mechanism exists to suppress,
-- nothing was ever built), but it still shows in the audit trail here,
-- labelled "cancelled" rather than "resolved", so the record is honest
-- about which of the two happened.
--
-- CREATE OR REPLACE is sufficient -- the RETURNS TABLE column list is
-- unchanged, this only adds rows via another UNION ALL branch, not
-- another column.

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
