-- Stage 4, item 3: REVERSES a deliberate decision. See CLAUDE.md's own
-- updated "PRINCIPAL ACTIVITY FEED" entry for the full reasoning, both
-- the original exclusion and why it changed -- recorded there, not
-- just here, so a future reader who finds "deliberately excluded"
-- sees what moved and why.
--
-- Adds two new per-child branches (incidents, ABC logs), institution-
-- wide -- every child at the principal's own school, not staff-scoped.
-- passport_id/child_name/incident_id added to the return signature
-- (null for every existing staff-level branch, populated for these
-- two). incident_id matches get_teacher_activity_feed()'s own shape
-- exactly -- the row id (ic.id, an incident_children join row) and the
-- routable incident id (i.id) are different values, so both are
-- carried separately. The client links incident rows to
-- /teacher/incidents/[incidentId] -- the shared incident-detail route
-- principal/incidents/page.tsx already links to for the same reason
-- (can_view_incident() gates it for a principal too; there is no
-- separate /principal/incidents/[incidentId] route).
--
-- THE SAFEGUARD, unchanged and explicit here: no per-staff grouping,
-- no ranking, no sorting by who logged what. Incident rows use the
-- exact same generic description get_teacher_activity_feed() already
-- uses ("An incident was recorded.") -- no author named. ABC log rows
-- use activity_log's own stored event_description, which is role-
-- generic ("ABC incident logged by Teacher"/"...by SNA"), never a
-- named individual (confirmed by reading ABCLogger.tsx's own insert --
-- it stores a role label, not a name). Nothing in either new branch
-- can be grouped or sorted by staff identity because no staff identity
-- is carried in the row at all.
create or replace function public.get_principal_activity_feed(
  p_limit integer default 20, p_offset integer default 0
)
returns table (
  id uuid, event_type text, event_description text, created_at timestamptz,
  passport_id uuid, child_name text, incident_id uuid
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
      null::uuid, null::text, null::uuid
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
    -- Temporary-grant rows excluded -- those are covered, more
    -- precisely, by the temporary access grant branch below; a
    -- one-day supply cover showing up as "joined as SNA" would be
    -- misleading, not just redundant.
    select
      -- s.id salted per branch -- institution_staff.id is shared across
      -- up to three of these branches for the same row (a person who
      -- joined and was later deactivated), which would otherwise hand
      -- two feed rows the identical id -- a React key collision, found
      -- live: verification produced exactly this pair before the salt
      -- was added. rejected_at is mutually exclusive with approved_at/
      -- deactivated_at by this table's own check constraints, so that
      -- branch can never collide with the other two in practice -- but
      -- salted anyway, not left depending on that invariant holding.
      (md5(s.id::text || ':joined'))::uuid, 'staff_joined'::text,
      coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name')
        || ' joined as '
        || case s.role
             when 'class_teacher' then 'Class Teacher'
             when 'sna' then 'SNA'
             when 'principal' then 'Principal'
             when 'institution_admin' then 'Institution Admin'
             else s.role
           end,
      s.approved_at as created_at,
      null::uuid, null::text, null::uuid
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

    -- Staff deactivated. Reason deliberately not embedded here -- it's
    -- already visible on the Directory's own Staff detail pane; this
    -- row is the fact something changed, not a copy of the full record.
    select
      (md5(s.id::text || ':deactivated'))::uuid, 'staff_deactivated'::text,
      coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') || ' deactivated',
      s.deactivated_at as created_at,
      null::uuid, null::text, null::uuid
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
      null::uuid, null::text, null::uuid
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

    -- Principal handovers -- principal_handovers (0102) is the
    -- dedicated permanent record; this reads it, never institution_
    -- staff's own row churn for the transition.
    select
      h.id, 'principal_handover'::text,
      coalesce(pu.raw_user_meta_data ->> 'full_name', pu.raw_app_meta_data ->> 'full_name')
        || ' handed over the principal role to '
        || coalesce(su.raw_user_meta_data ->> 'full_name', su.raw_app_meta_data ->> 'full_name'),
      h.created_at,
      null::uuid, null::text, null::uuid
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

    -- Temporary access grants. Revocations deliberately not a separate
    -- branch here -- not asked for, and "granted" is the operational
    -- event that matters for this history; the grant's own current
    -- state (including any revocation) is already visible on the
    -- Directory's Temporary Access detail pane.
    select
      -- gb (granted_by) is the actual actor -- gt (granted_to) is the
      -- recipient. The first version of this branch made the recipient
      -- the grammatical subject of "granted", reading backwards ("X
      -- granted access to Y" implying X did the granting). Caught live,
      -- reading the fixture's own actual output text, not by inspection.
      t.id, 'temporary_access_grant'::text,
      coalesce(gb.raw_user_meta_data ->> 'full_name', gb.raw_app_meta_data ->> 'full_name')
        || ' granted '
        || coalesce(gt.raw_user_meta_data ->> 'full_name', gt.raw_app_meta_data ->> 'full_name')
        || ' temporary access to '
        || c.name
        || ' for ' || to_char(t.granted_for_date, 'DD Mon'),
      t.created_at,
      null::uuid, null::text, null::uuid
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

    -- NEW: incidents, institution-wide, every child at this principal's
    -- school. Generic description, no author -- exactly get_teacher_
    -- activity_feed()'s own incident-branch text, unchanged.
    select
      ic.id, 'incident'::text,
      'An incident was recorded.'::text,
      i.occurred_at as created_at,
      ic.passport_id, p.child_name, i.id
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

    -- NEW: ABC logs, institution-wide -- deliberately NOT has_child_
    -- access()-scoped (that's the teacher/SNA chokepoint; a principal's
    -- own visibility here is institution-wide by design, same as every
    -- other branch above). event_description is activity_log's own
    -- stored text, role-generic ("ABC incident logged by Teacher"),
    -- never a named individual. Clinician-authored entries excluded,
    -- matching get_teacher_activity_feed()'s own exclusion.
    select
      al.id, 'abc_logged'::text,
      al.event_description,
      al.created_at,
      al.passport_id, p.child_name, null::uuid
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
