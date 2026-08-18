-- SNA ROLE -- PHASE 1: data & access. New role value 'sna', linking
-- mechanically identical to teachers (same tables, no fork), scoped to:
-- passport read (teacher-scoped), ABC log insert (own) + read (own +
-- shared-via-incident-message, the 0064 rule), morning check-in read,
-- get_passport_team appearance, get_fba_recipient_candidates candidacy,
-- and (per explicit decision) the school/shared "From your Clinical
-- Team" strategy content teachers already see. Everything else --
-- Messages, EOD/afternoon updates, the teacher activity feed, Progress/
-- trend data, strategy_ledger, strategy_feedback_prompts -- stays
-- explicitly denied.
--
-- THE CENTRAL MECHANISM: passport_access has never had a role column --
-- every "does this person have teacher access" check across the whole
-- schema tests row-EXISTENCE only, never role. Reusing it naively for
-- SNA would silently hand SNA every one of those role-blind grants,
-- including several explicitly excluded above. So this migration adds
-- passport_access.actor_role (default 'class_teacher' -- every existing
-- row gets this value automatically, zero behaviour change for current
-- teachers) and then explicitly narrows every consumer that must NOT
-- include SNA. Consumers that already correctly include SNA by being
-- role-blind (passport/section reads, morning_checkins, the abc_logs
-- SELECT policy itself) need no change at all -- noted inline as such
-- rather than touched for the sake of touching them.

-- =====================================================================
-- 1. institution_staff -- widen the role CHECK and the self-link policy
--    to admit 'sna'. This table already keys on role per (user,
--    institution) -- the "extend, don't fork" case.
-- =====================================================================
alter table public.institution_staff
  drop constraint if exists institution_staff_role_check;
alter table public.institution_staff
  add constraint institution_staff_role_check
  check (role in ('class_teacher', 'institution_admin', 'sna'));

alter policy "Institution admins and class teachers can self-link"
  on public.institution_staff
  with check (
    auth.uid() = user_id
    and public.current_user_role() in ('institution_admin', 'class_teacher', 'sna')
    and public.current_user_role() = role
  );

-- =====================================================================
-- 2. passport_access -- the new actor_role column. NOT NULL with a
--    default backfills every existing row as 'class_teacher' in the
--    same statement -- there is no separate UPDATE step, so there is no
--    window where an existing row is briefly unclassified.
-- =====================================================================
alter table public.passport_access
  add column actor_role text not null default 'class_teacher'
  check (actor_role in ('class_teacher', 'sna'));

-- =====================================================================
-- 3. abc_logs -- widen the CHECK, harden the existing teacher INSERT
--    policy (it never checked actor_role before this column existed --
--    without this, an SNA with any active passport_access row could
--    insert a log claiming logged_by_role='class_teacher'), and add the
--    SNA twin. The SELECT policy (0064) is left untouched: it's already
--    role-blind on passport_access, so it already grants SNA the exact
--    same "own + shared-via-message" read rule teachers have, the
--    moment SNA rows exist -- that's the intended behaviour, not a gap.
-- =====================================================================
alter table public.abc_logs
  drop constraint if exists abc_logs_logged_by_role_check;
alter table public.abc_logs
  add constraint abc_logs_logged_by_role_check
  check (logged_by_role in ('parent', 'class_teacher', 'clinician', 'sna'));

alter policy "Teachers can insert abc logs for passports they access"
  on public.abc_logs
  with check (
    auth.uid() = logged_by
    and logged_by_role = 'class_teacher'
    and exists (
      select 1 from public.passport_access pa
      where pa.passport_id = abc_logs.passport_id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
        and pa.actor_role = 'class_teacher'
    )
  );

create policy "SNAs can insert abc logs for passports they access"
  on public.abc_logs
  for insert
  to authenticated
  with check (
    auth.uid() = logged_by
    and logged_by_role = 'sna'
    and exists (
      select 1 from public.passport_access pa
      where pa.passport_id = abc_logs.passport_id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
        and pa.actor_role = 'sna'
    )
  );

-- =====================================================================
-- 4. get_abc_trend_data -- Progress/trend data is explicitly excluded.
--    Was role-blind; harden with the actor_role filter or SNA leaks in
--    the moment they have a passport_access row. get_abc_logs itself
--    needs NO change -- same role-blind shape as the SELECT policy in
--    §3, already correctly inclusive by the same reasoning.
-- =====================================================================
create or replace function public.get_abc_trend_data(p_passport_id uuid)
returns table (
  id uuid,
  incident_date date,
  incident_time time,
  logged_by_role text,
  duration_minutes integer,
  intensity integer,
  antecedents text[],
  behaviours text[],
  consequences text[]
)
language sql
security definer
set search_path = public
stable
as $$
  select
    a.id, a.incident_date, a.incident_time, a.logged_by_role,
    a.duration_minutes, a.intensity, a.antecedents, a.behaviours, a.consequences
  from public.abc_logs a
  where a.passport_id = p_passport_id
    and (
      public.owns_passport(p_passport_id)
      or (
        exists (
          select 1 from public.passport_access pa
          where pa.passport_id = p_passport_id
            and pa.teacher_id = auth.uid()
            and pa.is_active = true
            and pa.actor_role = 'class_teacher'
        )
        and (
          a.logged_by = auth.uid()
          or exists (
            select 1 from public.messages m
            join public.message_recipients mr on mr.message_id = m.id
            where m.abc_log_id = a.id
              and mr.recipient_id = auth.uid()
          )
        )
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
    )
  order by a.incident_date asc, a.incident_time asc;
$$;

grant execute on function public.get_abc_trend_data(uuid) to authenticated;

-- =====================================================================
-- 5. get_teacher_activity_feed + the activity_log SELECT policy --
--    explicitly excluded per the brief ("SNA gets NO activity feed in
--    v1"). Both were role-blind; harden. The activity_log INSERT policy
--    is left untouched -- it's role-blind and that's correct: an SNA's
--    own ABC log must still generate the same abc_logged event everyone
--    else already sees (parent's feed, etc.) -- this is write access,
--    not read-back of the feed itself.
-- =====================================================================
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
  join public.passport_access pa
    on pa.passport_id = al.passport_id
    and pa.teacher_id = auth.uid()
    and pa.is_active = true
    and pa.actor_role = 'class_teacher'
  join public.passport_institution_links pil
    on pil.passport_id = pa.passport_id
    and pil.institution_id = pa.institution_id
    and pil.approved_by_parent = true
  where al.event_type in (
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

alter policy "Teachers can view activity for passports they access"
  on public.activity_log
  using (
    exists (
      select 1 from public.passport_access pa
      where pa.passport_id = activity_log.passport_id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
        and pa.actor_role = 'class_teacher'
    )
    and exists (
      select 1 from public.passport_institution_links pil
      where pil.passport_id = activity_log.passport_id
        and pil.approved_by_parent = true
    )
    and activity_log.event_type in (
      'passport_updated', 'abc_logged', 'team_linked', 'strategy_logged',
      'access_revoked', 'afternoon_update', 'clinical_content_added'
    )
    and (activity_log.event_type <> 'abc_logged' or activity_log.actor_id = auth.uid())
    and not exists (
      select 1 from public.clinicians c where c.user_id = activity_log.actor_id
    )
  );

-- =====================================================================
-- 6. teacher_updates (EOD) -- explicitly excluded. Was role-blind;
--    harden the one INSERT policy on this table.
-- =====================================================================
alter policy "Teachers can insert updates for passports they can access"
  on public.teacher_updates
  with check (
    auth.uid() = teacher_id
    and exists (
      select 1 from public.passport_access pa
      where pa.passport_id = teacher_updates.passport_id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
        and pa.actor_role = 'class_teacher'
    )
  );

-- =====================================================================
-- 7. strategy_ledger -- not named in the SNA v1 grant list; explicitly
--    excluded, both policies hardened (INSERT and SELECT's third
--    branch -- the other two SELECT branches, "own submissions" and
--    "the parent who owns the passport", are unaffected by SNA either
--    way and left exactly as they are).
-- =====================================================================
alter policy "Teachers can insert ledger entries for passports they can access"
  on public.strategy_ledger
  with check (
    auth.uid() = submitted_by
    and exists (
      select 1 from public.passport_access pa
      where pa.passport_id = strategy_ledger.passport_id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
        and pa.actor_role = 'class_teacher'
    )
  );

alter policy "Teachers and the child's parent can view ledger entries"
  on public.strategy_ledger
  using (
    auth.uid() = submitted_by
    or exists (
      select 1 from public.passports p
      where p.id = strategy_ledger.passport_id
        and p.user_id = auth.uid()
    )
    or exists (
      select 1 from public.passport_access pa
      where pa.passport_id = strategy_ledger.passport_id
        and pa.teacher_id = auth.uid()
        and pa.actor_role = 'class_teacher'
    )
  );

-- =====================================================================
-- 8. strategy_feedback_prompts -- not named in the SNA v1 grant list;
--    explicitly excluded. Only the INSERT policy references
--    passport_access (the SELECT policy is already self-scoped to
--    `teacher_id = auth.uid()`, and once INSERT is hardened an SNA can
--    never acquire a row here at all, so SELECT needs no separate
--    change).
-- =====================================================================
alter policy "Teachers can log their own strategy-feedback prompts"
  on public.strategy_feedback_prompts
  with check (
    teacher_id = auth.uid()
    and exists (
      select 1 from public.passport_access pa
      where pa.passport_id = strategy_feedback_prompts.passport_id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
        and pa.actor_role = 'class_teacher'
    )
  );

-- =====================================================================
-- 9. get_passport_clinical_content -- EXPLICIT INCLUDE, per decision.
--    SNA's scoped passport view must show the same "From your Clinical
--    Team" school/shared strategies teachers see (Q1 decision) -- this
--    IS that data path. Only this one item_type-filtered branch widens;
--    the clinician branch and the parent (owns_passport) branch are
--    completely untouched, so SNA still gets zero clinical/FBA content
--    beyond exactly these four item types.
-- =====================================================================
create or replace function public.get_passport_clinical_content(p_passport_id uuid)
returns table (
  id uuid,
  item_type text,
  content jsonb,
  author_role text,
  author_name text,
  author_specialty text,
  source_document_type text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    pcc.id,
    pcc.item_type,
    pcc.content,
    pcc.author_role,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as author_name,
    c.specialty as author_specialty,
    pcc.source_document_type,
    pcc.created_at
  from public.passport_clinical_content pcc
  join auth.users u on u.id = pcc.author_id
  left join public.clinicians c on c.user_id = pcc.author_id
  where pcc.passport_id = p_passport_id
    and (
      public.owns_passport(p_passport_id)
      or (
        exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = p_passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
        and public.is_verified_clinician(auth.uid())
      )
      or (
        pcc.item_type in ('strategy_school', 'strategy_shared', 'trigger', 'setting_event')
        and exists (
          select 1 from public.passport_access pa
          where pa.passport_id = p_passport_id
            and pa.teacher_id = auth.uid()
            and pa.is_active = true
            and pa.actor_role in ('class_teacher', 'sna')
        )
      )
    )
  order by pcc.created_at asc;
$$;

grant execute on function public.get_passport_clinical_content(uuid) to authenticated;

-- =====================================================================
-- 10. get_fba_recipient_candidates -- the teacher branch was already
--     role-blind on passport_access (no actor_role filter existed to
--     narrow), so it already includes SNA rows once they exist -- the
--     ONLY bug is the hardcoded literal 'class_teacher' label, which
--     would mislabel every SNA candidate. Fixed by resolving the label
--     from institution_staff, exactly like get_passport_team already
--     does. No filtering change -- SNA candidacy was already correct by
--     omission, per the brief's own instruction to reuse this RPC as-is.
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
    and pil.approved_by_parent = true;
$$;

grant execute on function public.get_fba_recipient_candidates(uuid) to authenticated;

-- =====================================================================
-- 11. Messages -- can_view_message, send_message, and
--     get_message_recipient_candidates are ALL role-blind on
--     passport_access today. This is the single highest-severity item
--     in the whole migration: without hardening, the moment SNA
--     occupies passport_access, SNA would be silently classified
--     sender_role='class_teacher' inside send_message, appear as a
--     'class_teacher' candidate, and pass can_view_message's teacher
--     branch -- i.e. full Messages read/write, directly contradicting
--     the brief. close_message and get_messages_awaiting_action_count
--     were checked and need NO change -- both operate purely on
--     messages/message_recipients rows a caller already sent or
--     received, with no passport_access reference at all, so they stay
--     correctly empty for SNA by construction (SNA can never become a
--     sender or recipient in the first place once the three functions
--     below are hardened).
-- =====================================================================
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
        -- Parent: data-subject, always.
        public.owns_passport(m.passport_id)

        -- Actively-linked teacher, sender or recipient of THIS message.
        or (
          exists (
            select 1 from public.passport_access pa
            where pa.passport_id = m.passport_id
              and pa.teacher_id = auth.uid()
              and pa.is_active = true
              and pa.actor_role = 'class_teacher'
          )
          and (
            m.sender_id = auth.uid()
            or exists (
              select 1 from public.message_recipients mr
              where mr.message_id = m.id and mr.recipient_id = auth.uid()
            )
          )
        )

        -- Actively-linked verified clinician, sender or recipient of
        -- THIS message (their own direct traffic).
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

        -- Actively-linked verified clinician's read-only mid-day signal:
        -- pure parent<->teacher traffic on their own case (never a
        -- message a clinician is themselves sender/recipient of --
        -- that's the branch above -- and never another clinician's
        -- traffic).
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
      )
  );
$$;

grant execute on function public.can_view_message(uuid) to authenticated;

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
          and pil.approved_by_parent = true
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
      and pil.approved_by_parent = true

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

-- send_message: harden the sender-role resolution's teacher branch.
-- Return type/signature unchanged, so create or replace is safe here
-- (unlike Stage 3's 0062, which had to drop first because it added
-- parameters).
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
      and pil.approved_by_parent = true
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
-- 12. passport_access's OWN insert/reactivate policies -- the gap this
--     closes: everything above assumes actor_role correctly records
--     who linked the row, but neither policy that lets a "teacher" link
--     themselves to a passport (0014's INSERT, 0025's reactivate
--     UPDATE) says anything about actor_role. It's a plain column with
--     a default, not something either WITH CHECK verifies -- so on its
--     own, an SNA linking to a child would silently get
--     actor_role='class_teacher' from the column default (since
--     AddChildSheet.tsx's insert doesn't set it), which would hand them
--     every hardened grant above by defaulting straight past the
--     hardening. This is exactly the 0033 lesson (institution_staff's
--     self-link policy requires current_user_role() = role) applied to
--     the one place it was missing: actor_role must be proven to match
--     the caller's real, server-set role, not merely accepted from
--     whatever the client sends or the column defaults to.
--
--     Practical effect: existing class_teachers are unaffected --
--     AddChildSheet.tsx's insert doesn't set actor_role today, so it
--     falls back to the column default 'class_teacher', which now
--     matches current_user_role() for every real class_teacher exactly
--     as before. An SNA using this same unmodified insert call would
--     fail this check (default 'class_teacher' <> current_user_role()
--     'sna') and get a clear RLS error rather than silently acquiring
--     class_teacher-level access -- fails closed. Phase 2/3 app code
--     will need AddChildSheet.tsx's insert to explicitly pass
--     actor_role: <the caller's own role> so SNA linking succeeds; that
--     is flagged here for Phase 3, not fixed in this SQL-only phase.
-- =====================================================================
alter policy "Teachers can insert access for approved, matching institutions"
  on public.passport_access
  with check (
    auth.uid() = teacher_id
    and passport_access.actor_role = public.current_user_role()
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = passport_access.institution_id
        and s.user_id = auth.uid()
    )
    and exists (
      select 1 from public.passport_institution_links pil
      where pil.passport_id = passport_access.passport_id
        and pil.institution_id = passport_access.institution_id
        and pil.approved_by_parent = true
    )
  );

alter policy "Teachers can reactivate their own revoked access"
  on public.passport_access
  using (
    teacher_id = auth.uid()
    and is_active = false
  )
  with check (
    teacher_id = auth.uid()
    and is_active = true
    and passport_access.actor_role = public.current_user_role()
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = passport_access.institution_id
        and s.user_id = auth.uid()
    )
    and exists (
      select 1 from public.passport_institution_links pil
      where pil.passport_id = passport_access.passport_id
        and pil.institution_id = passport_access.institution_id
        and pil.approved_by_parent = true
    )
  );
