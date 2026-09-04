-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- get_principal_activity_feed() (0158) widened -- the staff half of the
-- widening decision, deliberately. 0158's own header called out staff
-- joins/leaves, handovers and temporary access grants as branches the
-- UNION shape was "ready for" but hadn't built. Building them now:
-- joins, leaves, rejections, principal handovers, temporary access
-- grants. Genuinely low-volume institutional history (checked against
-- production before writing this: 2 institutions, 0 leaves, 0
-- rejections, 0 temporary grants recorded yet -- a handful a term at a
-- real school), and nothing in this codebase's own history stands
-- against it.
--
-- THE CHILDREN HALF IS DELIBERATELY NOT HERE. Per-child events (ABC
-- logs, passport updates, strategy notes) stay excluded -- not only for
-- 0158's own child-name-privacy reasoning (which has since moved --
-- get_institution_incidents() now resolves real child names for
-- principals), but for a live, unresolved objection: an institution-
-- wide stream of individual staff members' per-child logging reads as
-- watching their work in real time, which the safeguarding literature
-- warns produces under-logging -- the failure that matters most in a
-- restraint-recording product. Recorded as an open decision, not a
-- closed one, in CLAUDE.md. Revisit only with a considered answer to
-- that objection, not as a drive-by widening once this migration exists
-- as precedent.
--
-- Every new branch repeats 0158's own two-part caller check verbatim --
-- an EXISTS membership check (any principal-role row for this user at
-- this institution) PLUS institution_staff_has_current_standing() for
-- the actual active/approved gate -- rather than hand-writing deactivated_
-- at/approved_at conditions inline, per CLAUDE.md's own standing rule.
--
-- Same function signature as 0158 (p_limit, p_offset unchanged) -- a
-- plain CREATE OR REPLACE is safe here; nothing about the parameter
-- list is changing, only the UNION's own row sources. (The send_message
-- overload gotcha this codebase already hit twice, 0062/0168, is about
-- parameter list changes specifically -- not applicable to this
-- migration.)

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
      sa.raised_at as created_at
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
      s.approved_at as created_at
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
      s.deactivated_at as created_at
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
      s.rejected_at as created_at
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
      h.created_at
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
      t.created_at
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
  ) combined
  order by created_at desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.get_principal_activity_feed(integer, integer) to authenticated;
