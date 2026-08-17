-- MESSAGES (asynchronous ticketing) -- Stage 1 of 3: data model + core
-- ticket lifecycle. Stages 2 (per-track surfaces) and 3 (ABC + strategy-
-- layer integrations) come later; this migration lays clean foundations
-- only. A communication layer, not chat: default interaction is
-- [Acknowledge] -> closed, and when the sender hasn't set Response
-- Required there is NO reply path at all, structurally, not just hidden
-- in the UI.
--
-- Schema-collision check performed before writing this file: no table
-- named "messages" (or message_recipients/message_replies/
-- message_categories) exists in any prior migration. The old
-- src/app/messages, src/app/teacher/messages, src/app/clinician/messages
-- pages are UI-only ComingSoonPage placeholders with no backing table --
-- confirmed by reading all three.

-- =====================================================================
-- 1. message_categories -- data-driven presets (created first: messages
--    references it). Provisional: this seed list is a starting point,
--    not final -- real categories come from beta usage data. Editing
--    this set going forward is a DATA edit (UPDATE/INSERT rows), never
--    a code change.
-- =====================================================================
create table if not exists public.message_categories (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  description text,
  -- Which sender_role(s) may pick this category when composing (enforced
  -- server-side in send_message below, not just filtered client-side).
  allowed_sender_roles text[] not null,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

alter table public.message_categories enable row level security;

-- Read-only reference data for every authenticated user, same shape as
-- other data-driven preset tables in this app (e.g. fba_instruments).
-- No insert/update/delete policy for "authenticated" at all -- editing
-- categories is a Table Editor / service-role operation only.
create policy "Authenticated users can read active message categories"
  on public.message_categories for select
  to authenticated
  using (is_active);

-- =====================================================================
-- 2. messages -- the ticket itself.
-- =====================================================================
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  -- All scoping derives from this: who can see a message is a function
  -- of who can see this passport, plus who was actually sent it.
  passport_id uuid not null references public.passports (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  sender_role text not null check (sender_role in ('parent', 'class_teacher', 'clinician')),
  category_id uuid not null references public.message_categories (id),
  -- Nullable: a category chip alone ("Collection/drop-off") can be the
  -- whole message. 200-char hard cap enforced at the DB, not just the
  -- UI counter.
  body text,
  response_required boolean not null default false,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'in_discussion', 'closed')),
  -- Stage 3: ABC + strategy-layer integrations. Columns added now so the
  -- shape is stable; nothing in Stage 1 writes to them.
  abc_log_id uuid references public.abc_logs (id) on delete set null,
  strategy_update boolean not null default false,
  created_at timestamptz not null default now(),
  constraint messages_body_length check (body is null or char_length(body) <= 200)
);

create index if not exists messages_passport_id_idx on public.messages (passport_id);
create index if not exists messages_sender_id_idx on public.messages (sender_id);

alter table public.messages enable row level security;

-- =====================================================================
-- 3. message_recipients -- multiple recipients per message.
-- =====================================================================
create table if not exists public.message_recipients (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  recipient_role text not null check (recipient_role in ('parent', 'class_teacher', 'clinician')),
  acknowledged_at timestamptz,
  unique (message_id, recipient_id)
);

create index if not exists message_recipients_message_id_idx on public.message_recipients (message_id);
create index if not exists message_recipients_recipient_id_idx on public.message_recipients (recipient_id);

alter table public.message_recipients enable row level security;

-- =====================================================================
-- 4. message_replies -- only ever populated when response_required.
-- =====================================================================
create table if not exists public.message_replies (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint message_replies_body_length check (char_length(body) > 0 and char_length(body) <= 200)
);

create index if not exists message_replies_message_id_idx on public.message_replies (message_id);

alter table public.message_replies enable row level security;

-- Immutability, all three tables: permanent record, consistent with the
-- ratings/ABC/strategy_feedback precedent. RLS is default-deny, so
-- simply defining no UPDATE and no DELETE policy for "authenticated" on
-- messages, message_recipients, or message_replies makes every one of
-- those tables append-only for every role -- content can never be
-- edited or removed by anyone, including the sender. The only writes
-- that ever happen (status transitions, acknowledged_at stamps) go
-- through the SECURITY DEFINER RPCs below, which bypass RLS via table
-- ownership and touch only status-shaped columns, never content.

-- =====================================================================
-- 5. institutions.phone -- surfaced in the compose sheet's emergency
--    boundary footer ("phone the school"). Nullable; maintained via the
--    Table Editor, same manual-setup model as the rest of institutions.
-- =====================================================================
alter table public.institutions add column if not exists phone text;

-- =====================================================================
-- 6. can_view_message -- single shared visibility rule, referenced from
--    all three tables' SELECT policies (avoids re-deriving this logic
--    three times, and keeps it correct in exactly one place).
--
-- Visibility rules (from the brief, verbatim):
--  - sender + recipients read their own messages
--  - the child's PARENT reads ALL messages concerning their child, even
--    when not sender/recipient (data-subject principle) -- always, never
--    gated on an active-link check, since a parent is never "revoked"
--    from their own child's passport
--  - actively-linked VERIFIED CLINICIANS read (never write to) parent<->
--    teacher messages for their cases -- their own direct traffic (as
--    sender/recipient) is separate and covered by the first bullet
--  - teachers NEVER read messages they aren't participants in --
--    specifically never parent<->clinician traffic. There is no teacher-
--    specific branch here at all: a teacher's only path to visibility is
--    "sender or recipient", same as every role. RLS defaults to deny, so
--    omitting a broader teacher clause is what enforces this.
--
-- Revocation: every non-parent branch below re-checks is_active live
-- (passport_access / clinician_access), not just "were they once a
-- participant" -- so a revoked teacher or clinician loses access to
-- every message on that passport (including ones they already sent or
-- received) the instant they're revoked, not merely to future ones.
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

create policy "Participants, data-subject parent, and case clinicians can view messages"
  on public.messages for select
  to authenticated
  using (public.can_view_message(id));

create policy "Message recipients visible to whoever can view the message"
  on public.message_recipients for select
  to authenticated
  using (public.can_view_message(message_id));

create policy "Message replies visible to whoever can view the message"
  on public.message_replies for select
  to authenticated
  using (public.can_view_message(message_id));

-- Deliberately no INSERT/UPDATE/DELETE policy for "authenticated" on any
-- of messages / message_recipients / message_replies. Every write goes
-- through a SECURITY DEFINER RPC below, which bypasses RLS via table
-- ownership -- so the RPCs can freely write while a direct client-side
-- insert/update/delete is blocked outright. This is what makes the
-- Response Required cap and the participant checks below actually
-- unbypassable, not just a UI nicety.

-- =====================================================================
-- 7. get_message_recipient_candidates -- who a sender can pick from.
--    Mirrors get_fba_recipient_candidates' STRICT actively-linked-
--    teacher pattern (is_active + parent-approved institution link),
--    broadened to also gate the caller's own authorization (any of the
--    3 roles may compose, not just a clinician). Self-excludes the
--    caller (you can't message yourself).
-- =====================================================================
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

-- =====================================================================
-- 8. send_message -- the ONLY insertion path for messages +
--    message_recipients. Validates the sender is a genuine participant,
--    validates the category is active and allowed for that role,
--    enforces the Response Required cap, then inserts -- all inside one
--    function so nothing can be raced or bypassed via a direct RPC call.
-- =====================================================================
create or replace function public.send_message(
  p_passport_id uuid,
  p_category_id uuid,
  p_body text,
  p_response_required boolean,
  p_recipient_ids uuid[]
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

  -- Same authorization shape as get_message_recipient_candidates: a
  -- sender must be a genuine, currently-active participant.
  if public.owns_passport(p_passport_id) then
    v_sender_role := 'parent';
  elsif exists (
    select 1 from public.passport_access pa
    join public.passport_institution_links pil
      on pil.passport_id = pa.passport_id and pil.institution_id = pa.institution_id
    where pa.passport_id = p_passport_id
      and pa.teacher_id = v_uid
      and pa.is_active = true
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

  -- Category must be active and available to this sender role -- the
  -- compose sheet's own chip filtering is a nicety, this is the
  -- guarantee.
  select allowed_sender_roles into v_category_roles
  from public.message_categories
  where id = p_category_id and is_active = true;

  if v_category_roles is null then
    raise exception 'Invalid or inactive category.';
  end if;
  if not (v_sender_role = any(v_category_roles)) then
    raise exception 'This category is not available to your role.';
  end if;

  -- Response Required cap: max 3 concurrent open response_required
  -- messages per sender per child, checked here so it holds even
  -- against a direct RPC call, not just the compose sheet's UI state.
  if p_response_required then
    select count(*) into v_open_rr_count
    from public.messages m
    where m.passport_id = p_passport_id
      and m.sender_id = v_uid
      and m.response_required = true
      and m.status <> 'closed';

    if v_open_rr_count >= 3 then
      raise exception 'You already have 3 open response-required messages for this child. Close one before sending another.';
    end if;
  end if;

  insert into public.messages (passport_id, sender_id, sender_role, category_id, body, response_required, status)
  values (p_passport_id, v_uid, v_sender_role, p_category_id, p_body, p_response_required, 'open')
  returning id into v_message_id;

  -- Recipients are validated by construction: only ids that appear in
  -- get_message_recipient_candidates' own result for this passport (the
  -- exact same set the compose sheet offered) can become a recipient
  -- row. A mismatch after the insert means the caller passed an id that
  -- isn't a genuine, currently-active participant -- reject outright
  -- rather than silently dropping it.
  insert into public.message_recipients (message_id, recipient_id, recipient_role)
  select v_message_id, c.recipient_id, c.role
  from public.get_message_recipient_candidates(p_passport_id) c
  where c.recipient_id = any(p_recipient_ids);

  select count(*) into v_recipient_count
  from public.message_recipients
  where message_id = v_message_id;

  if v_recipient_count <> array_length(p_recipient_ids, 1) then
    raise exception 'One or more recipients are not valid participants for this child.';
  end if;

  return v_message_id;
end;
$$;

grant execute on function public.send_message(uuid, uuid, text, boolean, uuid[]) to authenticated;

-- =====================================================================
-- 9. acknowledge_message -- recipients only, idempotent (safe to retry
--    from the offline-retry queue without a spurious failure on the
--    second attempt).
-- =====================================================================
create or replace function public.acknowledge_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_response_required boolean;
  v_total_recipients integer;
  v_acknowledged_count integer;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  -- The WHERE clause IS the authorization: only a row where this caller
  -- is genuinely the recipient can ever be touched.
  update public.message_recipients
  set acknowledged_at = now()
  where message_id = p_message_id
    and recipient_id = v_uid
    and acknowledged_at is null;

  if not found then
    -- Not a recipient of this message, or already acknowledged -- both
    -- are safe no-ops. A retried optimistic write must never surface a
    -- spurious failure just because it already succeeded once.
    return;
  end if;

  select response_required into v_response_required
  from public.messages
  where id = p_message_id;

  if v_response_required then
    -- Response-required messages' status is driven by reply/close, not
    -- by acknowledge -- this just records "seen".
    return;
  end if;

  select count(*), count(*) filter (where acknowledged_at is not null)
  into v_total_recipients, v_acknowledged_count
  from public.message_recipients
  where message_id = p_message_id;

  if v_total_recipients > 0 and v_total_recipients = v_acknowledged_count then
    update public.messages
    set status = 'acknowledged'
    where id = p_message_id and status = 'open';
  end if;
end;
$$;

grant execute on function public.acknowledge_message(uuid) to authenticated;

-- =====================================================================
-- 10. reply_to_message -- participants only, only while response_
--     required and not yet closed. First reply flips status to
--     'in_discussion'.
-- =====================================================================
create or replace function public.reply_to_message(p_message_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_reply_id uuid;
  v_is_participant boolean;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  if p_body is null or char_length(trim(p_body)) = 0 then
    raise exception 'Reply cannot be empty.';
  end if;
  if char_length(p_body) > 200 then
    raise exception 'Reply must be 200 characters or fewer.';
  end if;

  select exists (
    select 1 from public.messages m
    where m.id = p_message_id
      and m.response_required = true
      and m.status <> 'closed'
      and (
        m.sender_id = v_uid
        or exists (
          select 1 from public.message_recipients mr
          where mr.message_id = m.id and mr.recipient_id = v_uid
        )
      )
  ) into v_is_participant;

  if not v_is_participant then
    raise exception 'You cannot reply to this message.';
  end if;

  insert into public.message_replies (message_id, author_id, body)
  values (p_message_id, v_uid, p_body)
  returning id into v_reply_id;

  update public.messages
  set status = 'in_discussion'
  where id = p_message_id and status <> 'closed';

  return v_reply_id;
end;
$$;

grant execute on function public.reply_to_message(uuid, text) to authenticated;

-- =====================================================================
-- 11. close_message -- participants only, response_required messages
--     only. A deliberate user action, so unlike acknowledge this raises
--     rather than silently no-op-ing when it can't proceed.
-- =====================================================================
create or replace function public.close_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  update public.messages
  set status = 'closed'
  where id = p_message_id
    and response_required = true
    and status <> 'closed'
    and (
      sender_id = v_uid
      or exists (
        select 1 from public.message_recipients mr
        where mr.message_id = messages.id and mr.recipient_id = v_uid
      )
    );

  if not found then
    raise exception 'This message cannot be closed (not found, not response-required, already closed, or you are not a participant).';
  end if;
end;
$$;

grant execute on function public.close_message(uuid) to authenticated;

-- =====================================================================
-- 12. Seed data -- provisional category set (verbatim brief list).
--     Marked provisional: final categories come from beta usage data;
--     changing this set is a data edit (Table Editor), never a code
--     change. allowed_sender_roles below is my own judgment call on a
--     sensible default split -- "Strategy update" locked to clinician
--     only is the one explicitly specified in the brief; the rest I've
--     opened to whichever roles plausibly originate that kind of note
--     in real use. Easy to tighten/loosen later without touching code.
-- =====================================================================
insert into public.message_categories (label, description, allowed_sender_roles, sort_order, is_active)
values
  ('Schedule change', 'A change to pickup/drop-off times, sessions, or the day''s plan.', array['parent', 'class_teacher'], 10, true),
  ('Collection/drop-off', 'Who''s collecting, or a change to the usual routine.', array['parent', 'class_teacher'], 20, true),
  ('Forgotten item', 'Something left at home or at school.', array['parent', 'class_teacher'], 30, true),
  ('Medication note', 'A note about medication given, missed, or changed.', array['parent', 'class_teacher'], 40, true),
  ('Sleep/morning heads-up', 'How the morning or the night before went.', array['parent'], 50, true),
  ('Wellbeing note', 'A general wellbeing update worth flagging.', array['parent', 'class_teacher', 'clinician'], 60, true),
  ('School supplies', 'Something needed for school.', array['parent', 'class_teacher'], 70, true),
  ('Contact me when you can', 'Nothing urgent -- just flag that a conversation would help.', array['parent', 'class_teacher', 'clinician'], 80, true),
  ('Strategy update', 'A change to an agreed strategy or approach.', array['clinician'], 90, true),
  ('Other', 'Anything else.', array['parent', 'class_teacher', 'clinician'], 100, true)
on conflict do nothing;
