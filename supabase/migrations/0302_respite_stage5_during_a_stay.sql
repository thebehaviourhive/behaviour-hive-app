-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 11 STAGE 5 -- DURING A STAY. Section 6, all four pieces. Recon
-- reported and confirmed by Daniel in full before any code was written;
-- this migration is the build against those confirmed answers.
--
-- 1. HANDOVER -- a new message_categories row (applies_to 'child',
--    centre_manager/care_staff), a new sender-role branch in
--    send_message(), a matching new branch in can_view_message(), and a
--    new candidate branch in get_message_recipient_candidates() (needed
--    because send_message() resolves every child-scoped recipient's
--    OWN role by looking them up in that exact function -- confirmed by
--    reading its live body before writing anything; a respite recipient
--    with no matching branch there would insert a null recipient_role
--    and be refused with "not authorized participants," not silently
--    admitted). ACTIVATION-SCOPED for BOTH roles, deliberately unlike
--    every one of Stage 4's six gated targets -- a handover is written
--    and read inside the SAME live stay it's about, never report
--    material a manager needs placement-scoped reach into after the
--    fact. acknowledge_message() is untouched; it already does exactly
--    what "the record of who knew what" needs.
--
-- 2. THE ON-CALL INDICATOR -- respite_on_call_designations, a new,
--    small, append-only table. INSTITUTION-scoped, never stay- or
--    activation-scoped -- a care worker needs to know who's covering
--    tonight before any child's record is activated for them, so this
--    table's own read policy is the same "any current-standing staff
--    here, role-agnostic" posture respite_activations' own metadata
--    already uses. Manager writes (set_on_call()); "current" is simply
--    the latest row by set_at, read directly, no RPC needed for that --
--    matching how respite_activations/respite_stays are already read
--    raw, with no wrapper, throughout this PRD.
--
-- 3. CHECK-INS -- respite_stay_checkins, a NEW table, not an extension
--    of morning_checkins (that table is passport_id+user_id+"today"-
--    keyed, with no stay concept and no way to distinguish a morning
--    check-in from an end-of-day one; reusing it would conflate two
--    different audiences under one shape, the exact mistake session_
--    notes was built to avoid repeating for abc_logs). stay_id-keyed,
--    not date-keyed -- "day 2 of a 5-day stay" is just the second
--    'morning'-typed row for that stay_id, no special multi-day logic
--    needed. ACTIVATION-scoped write (real-time content, written during
--    the stay, matching handover) for both roles; read is the Stage 4
--    split -- activation for care_staff, placement for centre_manager,
--    since a check-in IS the kind of content a report assembles from.
--
-- 4. "SINCE LAST TIME" -- NO new schema at all. respite_stays' own
--    SELECT policy (0297) is already institution-wide to any current-
--    standing staff, role-agnostic, with no activation gate -- confirmed
--    by reading it directly before assuming a new RPC was needed. A
--    prior stay's own ends_at is already readable; the client computes
--    the diff against each of sections B/C/D/E's own updated_at (already
--    activation/placement-gated since Stage 4) with nothing new to grant.
--    Option (a) -- surfacing the PRIOR stay's own finalised report to
--    care_staff, which respite_post_stay_reports' current policy
--    (centre_manager-only) does not permit -- is recorded as a real,
--    deliberate enhancement for later, not built here.
--
-- THE FIRST FIVE MINUTES' OWN "WHO IS THIS CHILD" STEP NEEDED ONE
-- SMALL, GENUINELY NEW PIECE: Stage 4 never granted read on the bare
-- passports table itself (only the sections beneath it), so neither
-- role could read a child's own name or date of birth until now.
-- get_respite_child_summary() closes this the established way (PRD 8's
-- own get_child_name_for_linked_institution_staff() precedent) -- a
-- narrow RPC returning exactly two fields, never a raw grant on a
-- table this schema treats as sensitive everywhere else.
--
-- THE PRE-STAY SUMMARY (PRD 11 section 7a -- two written sections, one
-- from the parent, one from the clinical director, neither waiting on
-- the other, both visible to both) IS NOT BUILT HERE, per Daniel's own
-- explicit instruction -- recorded as its own deferred item.
--
-- THE FBA IS NOT TOUCHED BY ANY PART OF THIS MIGRATION.

-- =====================================================================
-- 1. HANDOVER
-- =====================================================================

insert into public.message_categories (label, description, allowed_sender_roles, applies_to, sort_order, is_active)
values (
  'Handover', 'What happened on shift, how the child is now, and what to watch for.',
  array['centre_manager', 'care_staff'], 'child', 40, true
)
on conflict do nothing;

-- get_message_recipient_candidates() -- widened, bare CREATE OR REPLACE
-- (signature unchanged). New authorization branch (activation-scoped,
-- either role) and a new candidates arm (every OTHER current-standing
-- centre_manager/care_staff at any actively-linked respite institution
-- for this passport).
create or replace function public.get_message_recipient_candidates(p_passport_id uuid)
returns table (
  recipient_id uuid,
  full_name text,
  role text
)
language sql
security definer
set search_path = public
stable
as $$
  with authorized as (
    select 1
    where
      public.owns_passport(p_passport_id)
      or exists (
        select 1 from public.passport_access pa
        join public.passport_institution_links pil
          on pil.passport_id = pa.passport_id and pil.institution_id = pa.institution_id
        where pa.passport_id = p_passport_id
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
        where cc.passport_id = p_passport_id
          and cc.ended_at is null
          and ct.user_id = auth.uid()
          and ct.ended_at is null
          and s.deactivated_at is null
          and s.approved_at is not null
      )
      or (
        public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = p_passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
      )
      or (
        exists (
          select 1 from public.passport_institution_links pil
          join public.institution_staff s on s.institution_id = pil.institution_id
          where pil.passport_id = p_passport_id
            and s.user_id = auth.uid()
            and s.role = 'principal'
            and s.deactivated_at is null
            and s.approved_at is not null
        )
      )
      or public.has_sna_access(auth.uid(), p_passport_id)
      -- NEW: a respite worker with an open activation for this child.
      or exists (
        select 1 from public.institution_staff s
        where s.user_id = auth.uid()
          and s.role in ('centre_manager', 'care_staff')
          and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
          and exists (
            select 1 from public.respite_activations a
            where a.passport_id = p_passport_id
              and a.institution_id = s.institution_id
              and a.closed_at is null
          )
      )
  ),
  candidates as (
    select g.user_id as recipient_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
           'parent'::text as role
    from authorized, public.passport_guardians g
    join auth.users u on u.id = g.user_id
    where g.passport_id = p_passport_id

    union all

    select pa.teacher_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           'class_teacher'
    from authorized, public.passport_access pa
    join public.passport_institution_links pil
      on pil.passport_id = pa.passport_id and pil.institution_id = pa.institution_id
    join auth.users u on u.id = pa.teacher_id
    where pa.passport_id = p_passport_id
      and pa.is_active = true
      and pa.actor_role = 'class_teacher'

    union all

    select ct.user_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           'class_teacher'
    from authorized, public.class_children cc
    join public.classes c on c.id = cc.class_id
    join public.class_teachers ct on ct.class_id = c.id
    join public.institution_staff s on s.user_id = ct.user_id and s.institution_id = c.institution_id
    join public.passport_institution_links pil
      on pil.passport_id = cc.passport_id and pil.institution_id = c.institution_id
    join auth.users u on u.id = ct.user_id
    where cc.passport_id = p_passport_id
      and cc.ended_at is null
      and ct.ended_at is null
      and s.deactivated_at is null
      and s.approved_at is not null
      and not exists (
        select 1 from public.passport_access pa2
        where pa2.passport_id = p_passport_id
          and pa2.teacher_id = ct.user_id
          and pa2.is_active = true
          and pa2.actor_role = 'class_teacher'
      )

    union all

    select ca.clinician_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           'clinician'
    from authorized, public.clinician_access ca
    join auth.users u on u.id = ca.clinician_id
    where ca.passport_id = p_passport_id
      and ca.is_active = true
      and public.is_verified_clinician(ca.clinician_id)

    union all

    select s.user_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           'principal'
    from authorized, public.passport_institution_links pil
    join public.institution_staff s on s.institution_id = pil.institution_id
    join auth.users u on u.id = s.user_id
    where pil.passport_id = p_passport_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null

    union all

    select s.user_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           'sna'
    from authorized, public.passport_institution_links pil
    join public.institution_staff s on s.institution_id = pil.institution_id
    join auth.users u on u.id = s.user_id
    where pil.passport_id = p_passport_id
      and s.role = 'sna'
      and s.deactivated_at is null
      and s.approved_at is not null
      and public.has_sna_access(s.user_id, p_passport_id)

    union all

    -- NEW: every OTHER current-standing centre_manager/care_staff at any
    -- respite institution with an ACTIVE placement (not activation --
    -- the candidate LIST is deliberately wider than who may currently
    -- read/send, matching every other candidate branch's own posture of
    -- "list who could plausibly be a recipient"; send_message()'s own
    -- sender-side check is what actually enforces activation).
    select s.user_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           s.role
    from authorized, public.episodes_of_care e
    join public.institution_staff s on s.institution_id = e.institution_id
    join auth.users u on u.id = s.user_id
    where e.passport_id = p_passport_id
      and e.ended_at is null
      and s.role in ('centre_manager', 'care_staff')
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  )
  select recipient_id, full_name, role
  from candidates
  where recipient_id <> auth.uid();
$$;

grant execute on function public.get_message_recipient_candidates(uuid) to authenticated;

-- can_view_message() -- widened, same signature. New branch: activation-
-- scoped, either role, sender-or-recipient -- matching every existing
-- branch's own "real access AND actually a participant" shape exactly.
create or replace function public.can_view_message(p_message_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.messages m
    where m.id = p_message_id
      and (
        public.owns_passport(m.passport_id)

        or (
          public.has_class_teacher_access(auth.uid(), m.passport_id)
          and (
            m.sender_id = auth.uid()
            or exists (
              select 1 from public.message_recipients mr
              where mr.message_id = m.id and mr.recipient_id = auth.uid()
            )
          )
        )

        or (
          public.is_verified_clinician(auth.uid())
          and exists (
            select 1 from public.clinician_access ca
            where ca.passport_id = m.passport_id
              and ca.clinician_id = auth.uid()
              and ca.is_active = true
          )
          and (
            m.sender_id = auth.uid()
            or exists (
              select 1 from public.message_recipients mr
              where mr.message_id = m.id and mr.recipient_id = auth.uid()
            )
          )
        )

        or (
          public.is_verified_clinician(auth.uid())
          and exists (
            select 1 from public.clinician_access ca
            where ca.passport_id = m.passport_id
              and ca.clinician_id = auth.uid()
              and ca.is_active = true
          )
          and m.sender_role in ('parent', 'class_teacher')
          and not exists (
            select 1 from public.message_recipients mr2
            where mr2.message_id = m.id and mr2.recipient_role = 'clinician'
          )
        )

        or (
          exists (
            select 1 from public.passport_institution_links pil
            join public.institution_staff s on s.institution_id = pil.institution_id
            where pil.passport_id = m.passport_id
              and s.user_id = auth.uid()
              and s.role = 'principal'
              and s.deactivated_at is null
              and s.approved_at is not null
          )
          and (
            m.sender_id = auth.uid()
            or exists (
              select 1 from public.message_recipients mr
              where mr.message_id = m.id and mr.recipient_id = auth.uid()
            )
          )
        )

        or (
          m.passport_id is not null
          and public.has_sna_access(auth.uid(), m.passport_id)
          and (
            m.sender_id = auth.uid()
            or exists (
              select 1 from public.message_recipients mr
              where mr.message_id = m.id and mr.recipient_id = auth.uid()
            )
          )
        )

        -- NEW: a respite worker (either role) with an open activation
        -- for this child -- handover is inside-the-stay content, so
        -- this deliberately does NOT match Stage 4's placement-scoped
        -- manager reach; both roles read it the same, narrower way.
        or (
          m.passport_id is not null
          and exists (
            select 1 from public.institution_staff s
            where s.user_id = auth.uid()
              and s.role in ('centre_manager', 'care_staff')
              and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
              and exists (
                select 1 from public.respite_activations a
                where a.passport_id = m.passport_id
                  and a.institution_id = s.institution_id
                  and a.closed_at is null
              )
          )
          and (
            m.sender_id = auth.uid()
            or exists (
              select 1 from public.message_recipients mr
              where mr.message_id = m.id and mr.recipient_id = auth.uid()
            )
          )
        )

        or (
          m.institution_id is not null
          and public.institution_staff_has_current_standing(auth.uid(), m.institution_id)
          and (
            m.sender_id = auth.uid()
            or exists (
              select 1 from public.message_recipients mr
              where mr.message_id = m.id and mr.recipient_id = auth.uid()
            )
          )
        )
      )
  );
$$;

grant execute on function public.can_view_message(uuid) to authenticated;

-- send_message()'s own child-scoped v_sender_role resolution -- two new,
-- deliberately SEPARATE elsif branches (never a combined lookup with a
-- LIMIT 1) so this can never hit the "unordered SELECT INTO" trap this
-- schema has already been burned by four times -- each branch resolves
-- to a fixed literal role, nothing selected off an arbitrary row.
create or replace function public.send_message(
  p_passport_id uuid,
  p_category_id uuid,
  p_body text,
  p_response_required boolean,
  p_recipient_ids uuid[],
  p_abc_log_id uuid default null,
  p_strategy_update boolean default false,
  p_institution_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sender_role text;
  v_category_roles text[];
  v_category_label text;
  v_category_applies_to text;
  v_open_rr_count integer;
  v_message_id uuid;
  v_recipient_count integer;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  if p_body is not null and char_length(p_body) > 200 then
    raise exception 'Message body must be 200 characters or fewer.';
  end if;

  if p_recipient_ids is null or array_length(p_recipient_ids, 1) is null or array_length(p_recipient_ids, 1) = 0 then
    raise exception 'At least one recipient is required.';
  end if;

  if (p_passport_id is null) = (p_institution_id is null) then
    raise exception 'Exactly one of a child or a staff conversation must be specified.';
  end if;

  if p_institution_id is not null then
    if p_abc_log_id is not null then
      raise exception 'A staff conversation cannot reference an incident log.';
    end if;
    if p_strategy_update then
      raise exception 'A staff conversation cannot be a strategy update.';
    end if;

    if not public.institution_staff_has_current_standing(v_uid, p_institution_id) then
      raise exception 'You are not authorized to message staff at this institution.';
    end if;

    select role into v_sender_role
    from public.institution_staff
    where user_id = v_uid and institution_id = p_institution_id
      and deactivated_at is null and approved_at is not null;

    if v_sender_role not in (
      'class_teacher', 'sna', 'principal', 'clinician', 'clinical_lead',
      'clinic_admin', 'centre_manager', 'care_staff'
    ) then
      raise exception 'You are not authorized to message staff at this institution.';
    end if;
  else
    if public.owns_passport(p_passport_id) then
      v_sender_role := 'parent';
    elsif exists (
      select 1 from public.passport_access pa
      join public.passport_institution_links pil
        on pil.passport_id = pa.passport_id and pil.institution_id = pa.institution_id
      where pa.passport_id = p_passport_id
        and pa.teacher_id = v_uid
        and pa.is_active = true
        and pa.actor_role = 'class_teacher'
    ) or exists (
      select 1
      from public.class_children cc
      join public.classes c on c.id = cc.class_id
      join public.class_teachers ct on ct.class_id = c.id
      join public.institution_staff s on s.user_id = ct.user_id and s.institution_id = c.institution_id
      join public.passport_institution_links pil
        on pil.passport_id = cc.passport_id and pil.institution_id = c.institution_id
      where cc.passport_id = p_passport_id
        and cc.ended_at is null
        and ct.user_id = v_uid
        and ct.ended_at is null
        and s.deactivated_at is null
        and s.approved_at is not null
    ) then
      v_sender_role := 'class_teacher';
    elsif public.has_sna_access(v_uid, p_passport_id) then
      v_sender_role := 'sna';
    elsif public.is_verified_clinician(v_uid) and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = p_passport_id
        and ca.clinician_id = v_uid
        and ca.is_active = true
    ) then
      v_sender_role := 'clinician';
    elsif exists (
      select 1 from public.passport_institution_links pil
      join public.institution_staff s on s.institution_id = pil.institution_id
      where pil.passport_id = p_passport_id
        and s.user_id = v_uid
        and s.role = 'principal'
        and s.deactivated_at is null
        and s.approved_at is not null
    ) then
      v_sender_role := 'principal';
    -- NEW: a respite centre_manager with an open activation for this child.
    elsif exists (
      select 1 from public.institution_staff s
      where s.user_id = v_uid
        and s.role = 'centre_manager'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
        and exists (
          select 1 from public.respite_activations a
          where a.passport_id = p_passport_id
            and a.institution_id = s.institution_id
            and a.closed_at is null
        )
    ) then
      v_sender_role := 'centre_manager';
    -- NEW: a respite care_staff with an open activation for this child.
    elsif exists (
      select 1 from public.institution_staff s
      where s.user_id = v_uid
        and s.role = 'care_staff'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
        and exists (
          select 1 from public.respite_activations a
          where a.passport_id = p_passport_id
            and a.institution_id = s.institution_id
            and a.closed_at is null
        )
    ) then
      v_sender_role := 'care_staff';
    else
      raise exception 'You are not authorized to message about this child.';
    end if;
  end if;

  select array_agg(role_value)
  into v_category_roles
  from (
    select jsonb_array_elements_text(to_jsonb(mc.allowed_sender_roles)) as role_value
    from public.message_categories mc
    where mc.id = p_category_id and mc.is_active = true
  ) roles;

  select label, applies_to into v_category_label, v_category_applies_to
  from public.message_categories
  where id = p_category_id and is_active = true;

  if v_category_label is null then
    raise exception 'Invalid or inactive category.';
  end if;
  if not (v_sender_role = any(v_category_roles)) then
    raise exception 'This category is not available to your role.';
  end if;
  if p_institution_id is not null and v_category_applies_to <> 'staff' then
    raise exception 'This category is not available on a staff conversation.';
  end if;
  if p_passport_id is not null and v_category_applies_to <> 'child' then
    raise exception 'This category is not available on a child conversation.';
  end if;

  if p_abc_log_id is not null and not exists (
    select 1 from public.abc_logs where id = p_abc_log_id and passport_id = p_passport_id
  ) then
    raise exception 'That incident log does not belong to this child.';
  end if;

  if p_strategy_update and v_category_label is distinct from 'Strategy update' then
    raise exception 'strategy_update can only be set on a Strategy update message.';
  end if;

  if p_response_required then
    if p_institution_id is not null then
      select count(*) into v_open_rr_count
      from public.messages
      where institution_id = p_institution_id
        and sender_id = v_uid
        and response_required = true
        and status <> 'closed';
    else
      select count(*) into v_open_rr_count
      from public.messages
      where passport_id = p_passport_id
        and sender_id = v_uid
        and response_required = true
        and status <> 'closed';
    end if;
    if v_open_rr_count >= 3 then
      raise exception 'You already have 3 open response-required conversations here. Close one before starting another.';
    end if;
  end if;

  insert into public.messages (
    passport_id, institution_id, sender_id, sender_role, category_id, body,
    response_required, status, abc_log_id, strategy_update
  ) values (
    p_passport_id, p_institution_id, v_uid, v_sender_role, p_category_id, p_body,
    p_response_required, 'open', p_abc_log_id, p_strategy_update
  )
  returning id into v_message_id;

  select count(*) into v_recipient_count
  from unnest(p_recipient_ids) as rid
  where rid <> v_uid;

  if v_recipient_count = 0 then
    raise exception 'At least one valid recipient is required.';
  end if;

  insert into public.message_recipients (message_id, recipient_id, recipient_role)
  select v_message_id, rid, (
    select role from public.get_message_recipient_candidates(p_passport_id) c
    where c.recipient_id = rid
  )
  from unnest(p_recipient_ids) as rid
  where rid <> v_uid and p_passport_id is not null

  union all

  select v_message_id, rid, (
    select role from public.get_institution_staff_candidates(p_institution_id) c
    where c.recipient_id = rid
  )
  from unnest(p_recipient_ids) as rid
  where rid <> v_uid and p_institution_id is not null;

  if exists (
    select 1 from public.message_recipients where message_id = v_message_id and recipient_role is null
  ) then
    raise exception 'One or more recipients are not authorized participants for this conversation.';
  end if;

  return v_message_id;
end;
$$;

grant execute on function public.send_message(uuid, uuid, text, boolean, uuid[], uuid, boolean, uuid) to authenticated;

-- =====================================================================
-- 2. THE ON-CALL INDICATOR
-- =====================================================================

create table public.respite_on_call_designations (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  name text not null,
  phone text not null,
  on_call_until timestamptz not null,
  set_by uuid not null references auth.users (id),
  set_at timestamptz not null default now()
);

comment on table public.respite_on_call_designations is
  'Append-only, matching morning_checkins''/consents'' own established shape -- the "current" designation is simply the latest row by set_at, read directly, no derived status column. Institution-scoped, never stay- or activation-scoped -- staffing/escalation is a centre-wide fact, not tied to any one child''s clinical record, and must be readable before any activation exists.';

create index respite_on_call_designations_institution_id_idx on public.respite_on_call_designations (institution_id);

alter table public.respite_on_call_designations enable row level security;

create policy "Institution staff can view their own centre's on-call designations"
  on public.respite_on_call_designations
  for select
  to authenticated
  using (
    public.institution_staff_has_current_standing(auth.uid(), respite_on_call_designations.institution_id)
  );

-- No client INSERT policy -- set_on_call() below is the only write path.

create or replace function public.set_on_call(
  p_institution_id uuid,
  p_name text,
  p_phone text,
  p_until timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.institution_staff s
    where s.user_id = auth.uid()
      and s.institution_id = p_institution_id
      and s.role = 'centre_manager'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'Only a centre manager can set the on-call contact.';
  end if;

  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'A name is required.';
  end if;
  if p_phone is null or char_length(trim(p_phone)) = 0 then
    raise exception 'A phone number is required.';
  end if;
  if p_until <= now() then
    raise exception 'The on-call window must end in the future.';
  end if;

  insert into public.respite_on_call_designations (institution_id, name, phone, on_call_until, set_by)
  values (p_institution_id, trim(p_name), trim(p_phone), p_until, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.set_on_call(uuid, text, text, timestamptz) to authenticated;

-- =====================================================================
-- 3. CHECK-INS
-- =====================================================================

create table public.respite_stay_checkins (
  id uuid primary key default gen_random_uuid(),
  stay_id uuid not null references public.respite_stays (id) on delete cascade,
  institution_id uuid not null references public.institutions (id) on delete cascade,
  passport_id uuid not null references public.passports (id) on delete cascade,
  check_in_type text not null check (check_in_type in ('morning', 'end_of_day')),
  check_in_date date not null default current_date,
  checked_in_at timestamptz not null default now(),
  checked_in_by uuid not null references auth.users (id),
  note text,
  unique (stay_id, check_in_date, check_in_type)
);

comment on table public.respite_stay_checkins is
  'stay_id-keyed, not "today"-keyed like morning_checkins -- a multi-day stay''s own day 2 morning check-in is just the second morning-typed row for that stay_id, needing no separate multi-day logic. Read matches Stage 4''s own split exactly: activation-scoped for care_staff, placement-scoped for centre_manager, since this is content a post-stay report assembles from.';

create index respite_stay_checkins_stay_id_idx on public.respite_stay_checkins (stay_id);
create index respite_stay_checkins_institution_id_idx on public.respite_stay_checkins (institution_id);
create index respite_stay_checkins_passport_id_idx on public.respite_stay_checkins (passport_id);

alter table public.respite_stay_checkins enable row level security;

create policy "Centre managers can view check-ins for a child active at their centre"
  on public.respite_stay_checkins for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.role = 'centre_manager'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
        and exists (
          select 1 from public.episodes_of_care e
          where e.passport_id = respite_stay_checkins.passport_id
            and e.institution_id = s.institution_id
            and e.ended_at is null
        )
    )
  );

create policy "Care staff can view check-ins for a child active at their centre"
  on public.respite_stay_checkins for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.user_id = auth.uid()
        and s.role = 'care_staff'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
        and exists (
          select 1 from public.respite_activations a
          where a.passport_id = respite_stay_checkins.passport_id
            and a.institution_id = s.institution_id
            and a.closed_at is null
        )
        and exists (
          select 1 from public.episodes_of_care e
          where e.passport_id = respite_stay_checkins.passport_id
            and e.institution_id = s.institution_id
            and e.ended_at is null
        )
    )
  );

-- No client INSERT policy -- record_respite_stay_checkin() below is the
-- only write path.

create or replace function public.record_respite_stay_checkin(
  p_stay_id uuid,
  p_check_in_type text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stay public.respite_stays;
  v_id uuid;
begin
  if p_check_in_type not in ('morning', 'end_of_day') then
    raise exception 'Invalid check-in type.';
  end if;

  select * into v_stay from public.respite_stays where id = p_stay_id;
  if not found then
    raise exception 'Stay not found.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    where s.user_id = auth.uid()
      and s.role in ('centre_manager', 'care_staff')
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
      and s.institution_id = v_stay.institution_id
      and exists (
        select 1 from public.respite_activations a
        where a.passport_id = v_stay.passport_id
          and a.institution_id = s.institution_id
          and a.closed_at is null
      )
  ) then
    raise exception 'Only staff with an active record for this child can record a check-in.';
  end if;

  if exists (
    select 1 from public.respite_stay_checkins
    where stay_id = p_stay_id and check_in_date = current_date and check_in_type = p_check_in_type
  ) then
    raise exception 'A % check-in has already been recorded today for this stay.', p_check_in_type;
  end if;

  insert into public.respite_stay_checkins (stay_id, institution_id, passport_id, check_in_type, checked_in_by, note)
  values (p_stay_id, v_stay.institution_id, v_stay.passport_id, p_check_in_type, auth.uid(), p_note)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.record_respite_stay_checkin(uuid, text, text) to authenticated;

-- =====================================================================
-- Supporting infrastructure for the first-five-minutes screen.
-- =====================================================================

-- get_respite_child_summary() -- the "who is this child" step needs a
-- name and a date of birth; Stage 4 never granted read on the bare
-- passports table (deliberately -- only the sections beneath it), and
-- this schema's own standing rule is a narrow RPC for exactly this
-- shape, never a raw grant on passports (matching PRD 8's own
-- get_child_name_for_linked_institution_staff()). Same Stage 4 split:
-- activation for care_staff, placement for centre_manager.
create or replace function public.get_respite_child_summary(p_passport_id uuid)
returns table (
  child_name text,
  date_of_birth date
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not exists (
    select 1 from public.institution_staff s
    where s.user_id = auth.uid()
      and (
        (
          s.role = 'centre_manager'
          and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
          and exists (
            select 1 from public.episodes_of_care e
            where e.passport_id = p_passport_id
              and e.institution_id = s.institution_id
              and e.ended_at is null
          )
        )
        or (
          s.role = 'care_staff'
          and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
          and exists (
            select 1 from public.respite_activations a
            where a.passport_id = p_passport_id
              and a.institution_id = s.institution_id
              and a.closed_at is null
          )
          and exists (
            select 1 from public.episodes_of_care e
            where e.passport_id = p_passport_id
              and e.institution_id = s.institution_id
              and e.ended_at is null
          )
        )
      )
  ) then
    raise exception 'Not authorized for this child.';
  end if;

  return query
  select p.child_name, p.date_of_birth
  from public.passports p
  where p.id = p_passport_id;
end;
$$;

grant execute on function public.get_respite_child_summary(uuid) to authenticated;

-- get_my_centre_active_children() -- role-branched: a care_staff caller
-- sees children with an OPEN ACTIVATION for them right now (the whole
-- point of activation); a centre_manager sees every child with an
-- ACTIVE PLACEMENT, whether or not anyone's activated it yet, matching
-- their own placement-scoped reach everywhere else.
create or replace function public.get_my_centre_active_children(p_institution_id uuid)
returns table (
  passport_id uuid,
  child_name text,
  stay_id uuid
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text;
begin
  select s.role into v_role
  from public.institution_staff s
  where s.user_id = auth.uid()
    and s.institution_id = p_institution_id
    and s.role in ('centre_manager', 'care_staff')
    and public.institution_staff_has_current_standing(s.user_id, p_institution_id);

  if v_role is null then
    raise exception 'Not authorized for this institution.';
  end if;

  if v_role = 'centre_manager' then
    return query
    select distinct e.passport_id, p.child_name,
      (select rs.id from public.respite_stays rs
       where rs.episode_id = e.id
       order by rs.starts_at desc limit 1) as stay_id
    from public.episodes_of_care e
    join public.passports p on p.id = e.passport_id
    where e.institution_id = p_institution_id
      and e.ended_at is null;
  else
    return query
    select distinct a.passport_id, p.child_name,
      (select rs.id from public.respite_stays rs
       where rs.passport_id = a.passport_id and rs.institution_id = a.institution_id
       order by rs.starts_at desc limit 1) as stay_id
    from public.respite_activations a
    join public.passports p on p.id = a.passport_id
    where a.institution_id = p_institution_id
      and a.closed_at is null;
  end if;
end;
$$;

grant execute on function public.get_my_centre_active_children(uuid) to authenticated;
