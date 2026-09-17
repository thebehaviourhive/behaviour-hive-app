-- PRD 5 Stage 1, item 4. get_principal_activity_feed()'s own
-- "staff joined" branch baked a role->label translation directly into
-- SQL (0171, carried forward unchanged by 0192) -- a Postgres-side copy
-- of the same map that already existed nine times over in TypeScript,
-- and the one copy no future TS-side translation function could ever
-- reach. Daniel's own call: have this function return the raw role and
-- let the client format it through the shared function, rather than
-- maintaining a second label map that can silently diverge from the
-- first -- exactly how this one became a tenth copy in the first place.
--
-- Return row type widened (one new column, actor_role) -- CREATE OR
-- REPLACE cannot change a function's OUT-parameter row type (42P13),
-- so the prior signature is dropped first, same pattern 0192's own
-- comment already documents for this exact function.
drop function if exists public.get_principal_activity_feed(integer, integer);

create function public.get_principal_activity_feed(
  p_limit integer default 20, p_offset integer default 0
)
returns table (
  id uuid, event_type text, event_description text, created_at timestamptz,
  passport_id uuid, child_name text, incident_id uuid, actor_role text
)
language sql
security definer
set search_path = public
stable
as $$
  select * from (
    -- Support alerts -- unchanged from 0158.
    select
      sa.id, 'support_alert'::text,
      'Support Requested'
        || case when array_length(sa.room_names, 1) > 0 then ' - ' || array_to_string(sa.room_names, ', ') else '' end
        || case
             when sa.closed_at is null then ''
             when sa.is_likely_mistap then ' - cancelled'
             else ' - resolved'
           end,
      sa.raised_at as created_at,
      null::uuid, null::text, null::uuid, null::text
    from public.support_alerts sa
    where exists (
      select 1 from public.institution_staff s
      where s.institution_id = sa.institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
    )
    and public.institution_staff_has_current_standing(auth.uid(), sa.institution_id)

    union all

    -- Staff joined (approved, first time or a re-request granted).
    -- event_description no longer bakes in a role label -- just the
    -- name and "joined"; actor_role carries the raw institution_staff
    -- role value for the client to translate via the shared vocabulary
    -- function (institution-type-aware, unlike this SQL ever was).
    select
      (md5(s.id::text || ':joined'))::uuid, 'staff_joined'::text,
      coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') || ' joined',
      s.approved_at as created_at,
      null::uuid, null::text, null::uuid, s.role
    from public.institution_staff s
    join auth.users u on u.id = s.user_id
    where s.approved_at is not null
      and s.approval_source is distinct from 'temporary_grant'
      and exists (
        select 1 from public.institution_staff p
        where p.institution_id = s.institution_id
          and p.user_id = auth.uid()
          and p.role = 'principal'
      )
      and public.institution_staff_has_current_standing(auth.uid(), s.institution_id)

    union all

    -- Staff deactivated.
    select
      (md5(s.id::text || ':deactivated'))::uuid, 'staff_deactivated'::text,
      coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') || ' deactivated',
      s.deactivated_at as created_at,
      null::uuid, null::text, null::uuid, null::text
    from public.institution_staff s
    join auth.users u on u.id = s.user_id
    where s.deactivated_at is not null
      and s.approval_source is distinct from 'temporary_grant'
      and exists (
        select 1 from public.institution_staff p
        where p.institution_id = s.institution_id
          and p.user_id = auth.uid()
          and p.role = 'principal'
      )
      and public.institution_staff_has_current_standing(auth.uid(), s.institution_id)

    union all

    -- Staff join request rejected.
    select
      (md5(s.id::text || ':rejected'))::uuid, 'staff_join_rejected'::text,
      coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') || '''s join request was rejected',
      s.rejected_at as created_at,
      null::uuid, null::text, null::uuid, null::text
    from public.institution_staff s
    join auth.users u on u.id = s.user_id
    where s.rejected_at is not null
      and exists (
        select 1 from public.institution_staff p
        where p.institution_id = s.institution_id
          and p.user_id = auth.uid()
          and p.role = 'principal'
      )
      and public.institution_staff_has_current_standing(auth.uid(), s.institution_id)

    union all

    -- Principal handovers.
    select
      h.id, 'principal_handover'::text,
      coalesce(pu.raw_user_meta_data ->> 'full_name', pu.raw_app_meta_data ->> 'full_name')
        || ' handed over the principal role to '
        || coalesce(su.raw_user_meta_data ->> 'full_name', su.raw_app_meta_data ->> 'full_name'),
      h.created_at,
      null::uuid, null::text, null::uuid, null::text
    from public.principal_handovers h
    join auth.users pu on pu.id = h.predecessor_user_id
    join auth.users su on su.id = h.successor_user_id
    where exists (
      select 1 from public.institution_staff p
      where p.institution_id = h.institution_id
        and p.user_id = auth.uid()
        and p.role = 'principal'
    )
    and public.institution_staff_has_current_standing(auth.uid(), h.institution_id)

    union all

    -- Temporary access grants.
    select
      t.id, 'temporary_access_grant'::text,
      coalesce(gb.raw_user_meta_data ->> 'full_name', gb.raw_app_meta_data ->> 'full_name')
        || ' granted '
        || coalesce(gt.raw_user_meta_data ->> 'full_name', gt.raw_app_meta_data ->> 'full_name')
        || ' temporary access to '
        || c.name
        || ' for ' || to_char(t.granted_for_date, 'DD Mon'),
      t.created_at,
      null::uuid, null::text, null::uuid, null::text
    from public.temporary_access t
    join public.classes c on c.id = t.class_id
    join auth.users gt on gt.id = t.granted_to
    join auth.users gb on gb.id = t.granted_by
    where exists (
      select 1 from public.institution_staff p
      where p.institution_id = t.institution_id
        and p.user_id = auth.uid()
        and p.role = 'principal'
    )
    and public.institution_staff_has_current_standing(auth.uid(), t.institution_id)

    union all

    -- Incidents, institution-wide.
    select
      ic.id, 'incident'::text,
      'An incident was recorded.'::text,
      i.occurred_at as created_at,
      ic.passport_id, p.child_name, i.id, null::text
    from public.incident_children ic
    join public.incidents i on i.id = ic.incident_id
    join public.passports p on p.id = ic.passport_id
    where i.status <> 'draft'
      and exists (
        select 1 from public.institution_staff pr
        where pr.institution_id = i.institution_id
          and pr.user_id = auth.uid()
          and pr.role = 'principal'
      )
      and public.institution_staff_has_current_standing(auth.uid(), i.institution_id)

    union all

    -- ABC logs, institution-wide.
    select
      al.id, 'abc_logged'::text,
      al.event_description,
      al.created_at,
      al.passport_id, p.child_name, null::uuid, null::text
    from public.activity_log al
    join public.passports p on p.id = al.passport_id
    join public.passport_institution_links pil on pil.passport_id = al.passport_id
    where al.event_type = 'abc_logged'
      and not exists (
        select 1 from public.clinicians c where c.user_id = al.actor_id
      )
      and exists (
        select 1 from public.institution_staff pr
        where pr.institution_id = pil.institution_id
          and pr.user_id = auth.uid()
          and pr.role = 'principal'
      )
      and public.institution_staff_has_current_standing(auth.uid(), pil.institution_id)
  ) combined
  order by created_at desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.get_principal_activity_feed(integer, integer) to authenticated;
