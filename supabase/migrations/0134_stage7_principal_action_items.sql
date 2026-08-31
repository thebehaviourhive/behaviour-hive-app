-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 2, Stage 7 -- the principal's two genuinely new sources. Five of
-- the dashboard's seven items already have one (get_institution_
-- incidents() covers awaiting-countersignature, outstanding debriefs,
-- and inherited incidents in one call; get_institution_staff_roster()
-- covers pending joins; get_institution_child_roster() covers
-- unassigned children) -- these two are the only ones that don't.
-- Both query LIVE state on the tables that actually hold it
-- (incident_children, incident_attestations), never school_notices --
-- an append-only event log with nothing keeping it in sync with either
-- table, so a resolved item would keep reading as outstanding.
--
-- Both gated by can_countersign_incident(), matching get_institution_
-- incidents()'s own existing gate exactly -- the same principal (or
-- delegated countersign authority) who sees the rest of the action-item
-- dashboard sees these two, not a narrower or wider audience.

-- 1. get_institution_restraints_needing_parent_call() -- incident_
-- children's own parent_call_required/parent_called_at columns,
-- institution-wide, joined for display exactly as get_institution_
-- incidents() already resolves location and owning_teacher_name.
-- Returns incident_children_id specifically (not just incident_id) --
-- mark_parent_called()'s own signature takes that id, so this feeds the
-- write action directly, no second lookup.

create function public.get_institution_restraints_needing_parent_call(p_institution_id uuid)
returns table (
  incident_children_id uuid,
  incident_id uuid,
  occurred_at timestamptz,
  location text,
  child_index text,
  child_name text,
  owning_teacher_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    ic.id as incident_children_id,
    i.id as incident_id,
    i.occurred_at,
    loc.value as location,
    ic.child_index,
    p.child_name,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as owning_teacher_name
  from public.incident_children ic
  join public.incidents i on i.id = ic.incident_id
  join public.incident_locations loc on loc.id = i.location_id
  join public.passports p on p.id = ic.passport_id
  left join auth.users u on u.id = i.owning_teacher_id
  where i.institution_id = p_institution_id
    and ic.parent_call_required = true
    and ic.parent_called_at is null
    and public.can_countersign_incident(auth.uid(), p_institution_id)
  order by i.occurred_at desc;
$$;

grant execute on function public.get_institution_restraints_needing_parent_call(uuid) to authenticated;

-- 2. get_institution_withdrawn_attestations() -- mirrors get_my_
-- incident_attestations()'s own "most recent action wins" logic
-- (get_attestation_status(), 0070), institution-wide instead of self-
-- scoped, computed inline against a lateral "latest row per incident_
-- staff_id" rather than calling get_attestation_status() once per
-- candidate row -- same reasoning get_institution_temporary_access()'s
-- own is_currently_active gave for computing inline: this is already
-- institution-scoped and gated, so N redundant per-row can_view_
-- incident() re-checks inside that function would be pure overhead.
-- Filtering the lateral latest row to action = 'withdrawn' is exactly
-- equivalent to get_attestation_status() returning 'withdrawn' -- same
-- "most recent row" definition, just derived once per candidate instead
-- of via a second function call. A subsequent re-attestation naturally
-- drops off this list the moment it's recorded, because the latest row
-- for that incident_staff_id is then 'attested', not 'withdrawn' -- this
-- is precisely the live-state property the school_notices alternative
-- doesn't have.

create function public.get_institution_withdrawn_attestations(p_institution_id uuid)
returns table (
  incident_id uuid,
  incident_staff_id uuid,
  occurred_at timestamptz,
  location text,
  staff_user_id uuid,
  staff_name text,
  withdrawn_at timestamptz,
  withdrawn_by uuid,
  withdrawn_by_name text,
  withdrawal_reason text,
  is_closed boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    i.id as incident_id,
    st.id as incident_staff_id,
    i.occurred_at,
    loc.value as location,
    st.user_id as staff_user_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as staff_name,
    latest.created_at as withdrawn_at,
    latest.created_by as withdrawn_by,
    coalesce(wb.raw_user_meta_data ->> 'full_name', wb.raw_app_meta_data ->> 'full_name') as withdrawn_by_name,
    latest.withdrawal_reason,
    i.teacher_signed_at is not null as is_closed
  from public.incident_staff st
  join public.incidents i on i.id = st.incident_id
  join public.incident_locations loc on loc.id = i.location_id
  left join auth.users u on u.id = st.user_id
  join lateral (
    select ia.action, ia.created_at, ia.created_by, ia.withdrawal_reason
    from public.incident_attestations ia
    where ia.incident_staff_id = st.id
    order by ia.created_at desc
    limit 1
  ) latest on true
  left join auth.users wb on wb.id = latest.created_by
  where i.institution_id = p_institution_id
    and latest.action = 'withdrawn'
    and public.can_countersign_incident(auth.uid(), p_institution_id)
  order by latest.created_at desc;
$$;

grant execute on function public.get_institution_withdrawn_attestations(uuid) to authenticated;
