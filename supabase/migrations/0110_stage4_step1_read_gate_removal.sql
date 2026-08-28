-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 1, Stage 4, Step 1: institution-side passport_access and removing
-- approved_by_parent as an access precondition. (0104's own header
-- comment names this "Stage 3" -- written before temporary access
-- claimed that number in practice. This is the migration it meant.)
--
-- Four decisions from Step 0 recon, restated here so this file stands on
-- its own without the chat history:
--
-- 1. WRITE-SIDE, DELIBERATELY UNTOUCHED. passport_access's two
--    teacher-self policies ("...insert access for approved, matching
--    institutions", "...reactivate their own revoked access") are NOT
--    modified by this migration and still require passport_institution_
--    links.approved_by_parent = true. Reason: a parent's own revoke flow
--    (passport/dashboard's handleRevoke) depends on that check for
--    DURABILITY -- it flips approved_by_parent to false alongside
--    deactivating every passport_access row for that institution, and it
--    is these two write policies that currently stop staff from
--    immediately self-regranting or reactivating afterward. Dropping the
--    check here would make a parent's "remove this school" button
--    non-durable: staff could recreate the exact access the parent just
--    revoked, silently, with the parent never knowing. That is a
--    regression, not a simplification -- and no interim replacement was
--    designed for it, because anything invented now risks being thrown
--    away the moment Stage 6 (enrolment) lands anyway. These two
--    policies are Stage 6's to revisit, once institution membership plus
--    enrolment is a real, durable signal independent of a flag a parent
--    already uses for something else (their own "connected schools"
--    list, their own approve/revoke actions -- see
--    src/app/passport/dashboard/page.tsx and
--    src/components/parent/ShareBottomSheet.tsx, neither touched here).
--
-- 2. THE FOUR READ-SIDE "STRICTER" SITES (activity_log SELECT,
--    get_teacher_activity_feed, get_message_recipient_candidates,
--    send_message) lose ONLY the "= true" -- the institution-matched
--    join/exists to passport_institution_links stays, for three of the
--    four. These are the highest-exposure surfaces this schema has -- a
--    running activity history, and literally who can message about a
--    child -- so taking exactly these four straight to zero
--    institution-scoping, with nothing standing in for Stage 6's
--    enrolment, is a wider jump than the other fifteen sites already
--    took in Stage 2. Each site below carries its own comment.
--
--    ONE CORRECTION FROM THE RECON REPORT ITSELF: activity_log SELECT
--    was described there as sharing the other three's institution-
--    matched shape. Re-read fresh while writing this file (not from the
--    earlier read), it does not -- its own 0104 comment says so
--    explicitly: "the original has no institution-matching between the
--    grant and the approval link, just 'some approved link exists for
--    this passport'". There is no join to keep for this one site, so its
--    approved_by_parent condition is removed outright rather than
--    narrowed, and what's left collapses to exactly
--    has_class_teacher_access()'s own two branches, byte-for-byte --
--    simplified to call it directly rather than leave a duplicate copy
--    sitting beside it to drift out of sync later.
--
-- 3. get_fba_recipient_candidates() FOLDED IN, not filed separately.
--    Two fixes, not one: (a) same treatment as the four -- approved_by_
--    parent's "= true" drops, its own institution-matched join stays;
--    (b) the more important half -- this function was never touched by
--    Stage 2's sweep at all (FBA wasn't in scope then), so it has never
--    had a class-derived or assignment-derived branch. A class-derived
--    teacher or an assigned SNA already has has_child_access() to this
--    child's clinical content, ABC logs, and activity feed, but could
--    not appear as an FBA recipient candidate -- the clinician's own
--    questionnaire flow was silently dropping people with genuine,
--    already-adversarially-proven access. This is the sixth instance of
--    "WHEN ACCESS OR AUTHORITY IS GRANTED, TEST THE DESTINATION" this
--    build has hit, found the same way as the others: by asking what a
--    person who legitimately has access can actually reach, not by
--    anything failing first. Both new branches are role-blind on
--    purpose, matching the existing direct-grant branch's own role-
--    blindness (0065's own comment: "SNA candidacy was already correct
--    by omission") -- not a class_teacher-only restriction that was
--    never actually there.
--
-- 4. get_institution_child_roster() -- CONFIRMED, NOT CHANGED. Its
--    current definition (0100) has never checked approved_by_parent: any
--    child with a passport_institution_links row for an institution, at
--    all, approved or not, appears by name on that institution's roster.
--    Checked deliberately before building the Step 2 principal roster
--    page on top of it: 0074's own header names this as decisions 1 and
--    5 from the Incident Log's original approval round -- "stage-one
--    child selection draws from the INSTITUTION roster... no
--    approved_by_parent gate" -- intentional from the day it was
--    written, not an oversight this stage happens to be exposing.
--    Roster-tier visibility (a name appearing in a picker) and data-tier
--    access (has_child_access() gating the actual passport content) have
--    always been two different questions in this schema; this migration
--    doesn't change that relationship, only confirms it holds before
--    Step 2 relies on it for a new surface.

-- =====================================================================
-- 1. The four preserved-stricter sites. approved_by_parent's "= true"
--    removed; institution-matched joins kept (activity_log SELECT
--    excepted -- see decision 2 above).
-- =====================================================================

-- 1.1 activity_log SELECT -- no institution-match existed here to keep
-- (see decision 2). Collapses to has_class_teacher_access() exactly --
-- the same two branches, byte-for-byte, now called rather than
-- duplicated inline.
alter policy "Teachers can view activity for passports they access"
  on public.activity_log
  using (
    public.has_class_teacher_access(auth.uid(), activity_log.passport_id)
    and activity_log.event_type in (
      'passport_updated', 'abc_logged', 'team_linked', 'strategy_logged',
      'access_revoked', 'afternoon_update', 'clinical_content_added'
    )
    and (activity_log.event_type <> 'abc_logged' or activity_log.actor_id = auth.uid())
    and not exists (
      select 1 from public.clinicians c where c.user_id = activity_log.actor_id
    )
  );

-- 1.2 get_teacher_activity_feed -- institution-matched joins kept,
-- approved_by_parent's "= true" dropped from both branches (direct-grant
-- and class-derived). Stage 6 revisits this once enrolment exists.
create or replace function public.get_teacher_activity_feed(
  p_limit integer default 20, p_offset integer default 0
)
returns table (
  id uuid, passport_id uuid, child_name text, event_type text,
  event_description text, created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select al.id, al.passport_id, p.child_name, al.event_type, al.event_description, al.created_at
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
    )
    and al.event_type in (
      'passport_updated', 'abc_logged', 'team_linked', 'strategy_logged',
      'access_revoked', 'afternoon_update', 'clinical_content_added'
    )
    and (al.event_type <> 'abc_logged' or al.actor_id = auth.uid())
    and not exists (
      select 1 from public.clinicians c where c.user_id = al.actor_id
    )
  order by al.created_at desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.get_teacher_activity_feed(integer, integer) to authenticated;

-- 1.3 get_message_recipient_candidates -- same treatment, all four
-- occurrences (two in the "authorized" gate, two in the "candidates"
-- listing).
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
  ),
  candidates as (
    select p.user_id as recipient_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
           'parent'::text as role
    from authorized, public.passports p
    join auth.users u on u.id = p.user_id
    where p.id = p_passport_id

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
  )
  select recipient_id, full_name, role
  from candidates
  where recipient_id <> auth.uid();
$$;

grant execute on function public.get_message_recipient_candidates(uuid) to authenticated;

-- 1.4 send_message -- same treatment, both occurrences in the teacher
-- elsif branch.
create or replace function public.send_message(
  p_passport_id uuid,
  p_category_id uuid,
  p_body text,
  p_response_required boolean,
  p_recipient_ids uuid[],
  p_abc_log_id uuid default null,
  p_strategy_update boolean default false
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
  elsif public.is_verified_clinician(v_uid) and exists (
    select 1 from public.clinician_access ca
    where ca.passport_id = p_passport_id
      and ca.clinician_id = v_uid
      and ca.is_active = true
  ) then
    v_sender_role := 'clinician';
  else
    raise exception 'You are not authorized to message about this child.';
  end if;

  select array_agg(role_value)
  into v_category_roles
  from (
    select jsonb_array_elements_text(to_jsonb(mc.allowed_sender_roles)) as role_value
    from public.message_categories mc
    where mc.id = p_category_id and mc.is_active = true
  ) roles;

  select label into v_category_label
  from public.message_categories
  where id = p_category_id and is_active = true;

  if v_category_label is null then
    raise exception 'Invalid or inactive category.';
  end if;
  if not (v_sender_role = any(v_category_roles)) then
    raise exception 'This category is not available to your role.';
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
    select count(*) into v_open_rr_count
    from public.messages
    where passport_id = p_passport_id
      and sender_id = v_uid
      and response_required = true
      and status <> 'closed';
    if v_open_rr_count >= 3 then
      raise exception 'You already have 3 open response-required conversations for this child. Close one before starting another.';
    end if;
  end if;

  insert into public.messages (
    passport_id, sender_id, sender_role, category_id, body,
    response_required, status, abc_log_id, strategy_update
  ) values (
    p_passport_id, v_uid, v_sender_role, p_category_id, p_body,
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
  where rid <> v_uid;

  if exists (
    select 1 from public.message_recipients where message_id = v_message_id and recipient_role is null
  ) then
    raise exception 'One or more recipients are not authorized participants for this child.';
  end if;

  return v_message_id;
end;
$$;

grant execute on function public.send_message(uuid, uuid, text, boolean, uuid[], uuid, boolean) to authenticated;

-- =====================================================================
-- 2. get_fba_recipient_candidates() -- folded in. approved_by_parent's
--    "= true" dropped (institution-matched join kept, same as the four
--    above), AND two new branches added: class-derived and assignment-
--    derived candidates -- the sixth "grant access, never test the
--    destination" gap this build has found. Role-blind on the
--    direct-grant branch already; the two new branches extend that same
--    role-blindness, not a class_teacher-only restriction that was never
--    actually there. Both deduplicated against the direct-grant branch,
--    matching the established pattern in get_message_recipient_
--    candidates() above.
-- =====================================================================

create or replace function public.get_fba_recipient_candidates(p_fba_id uuid)
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
  with authorized_fba as (
    select fr.id, fr.passport_id
    from public.fba_reports fr
    join public.clinician_access ca on ca.passport_id = fr.passport_id
    where fr.id = p_fba_id
      and fr.clinician_id = auth.uid()
      and ca.clinician_id = auth.uid()
      and ca.is_active = true
      and public.is_verified_clinician(auth.uid())
  )
  select
    p.user_id as recipient_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    'parent' as role
  from authorized_fba af
  join public.passports p on p.id = af.passport_id
  join auth.users u on u.id = p.user_id

  union all

  select
    pa.teacher_id as recipient_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    coalesce(s.role, 'class_teacher') as role
  from authorized_fba af
  join public.passport_access pa on pa.passport_id = af.passport_id
  join public.passport_institution_links pil
    on pil.passport_id = pa.passport_id and pil.institution_id = pa.institution_id
  join auth.users u on u.id = pa.teacher_id
  left join public.institution_staff s
    on s.user_id = pa.teacher_id and s.institution_id = pa.institution_id
  where pa.is_active = true

  union all

  -- Class-derived recipient candidates -- the real gap this fold-in
  -- closes. Institution-matched against passport_institution_links
  -- (existence only, no approval check -- same treatment as section 1
  -- above), deduplicated against the direct-grant branch.
  select
    ct.user_id as recipient_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    'class_teacher' as role
  from authorized_fba af
  join public.class_children cc on cc.passport_id = af.passport_id
  join public.classes c on c.id = cc.class_id
  join public.class_teachers ct on ct.class_id = c.id
  join public.institution_staff s on s.user_id = ct.user_id and s.institution_id = c.institution_id
  join public.passport_institution_links pil
    on pil.passport_id = cc.passport_id and pil.institution_id = c.institution_id
  join auth.users u on u.id = ct.user_id
  where cc.ended_at is null
    and ct.ended_at is null
    and s.deactivated_at is null
    and s.approved_at is not null
    and not exists (
      select 1 from public.passport_access pa2
      where pa2.passport_id = af.passport_id
        and pa2.teacher_id = ct.user_id
        and pa2.is_active = true
    )

  union all

  -- Assignment-derived (SNA) recipient candidates -- same gap, the
  -- assignment-derived half.
  select
    cha.user_id as recipient_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    'sna' as role
  from authorized_fba af
  join public.child_assignments cha on cha.passport_id = af.passport_id
  join public.institution_staff s on s.user_id = cha.user_id and s.institution_id = cha.institution_id
  join public.passport_institution_links pil
    on pil.passport_id = cha.passport_id and pil.institution_id = cha.institution_id
  join auth.users u on u.id = cha.user_id
  where cha.ended_at is null
    and s.deactivated_at is null
    and s.approved_at is not null
    and not exists (
      select 1 from public.passport_access pa2
      where pa2.passport_id = af.passport_id
        and pa2.teacher_id = cha.user_id
        and pa2.is_active = true
    );
$$;

grant execute on function public.get_fba_recipient_candidates(uuid) to authenticated;
