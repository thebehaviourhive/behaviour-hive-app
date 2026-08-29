-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 1, Stage 5, Step 1 -- the SQL groundwork for nullable
-- passports.user_id, driven directly by the six recon decisions. What
-- this migration does NOT do, deliberately, and why, is as important as
-- what it does -- read section 5 before running.
--
-- =====================================================================
-- 1. passports.user_id becomes nullable. A school can now create a
--    passport with no guardian at all, claimed later.
-- =====================================================================
alter table public.passports alter column user_id drop not null;

-- =====================================================================
-- 2. passport_guardians -- the new join table ownership actually lives
--    in from now on. Deliberately NOT unique(user_id): a parent may
--    guardian more than one passport (this migration also drops
--    passports' own unique(user_id), section 4, which was the
--    structural block on that). unique(passport_id, user_id) only, so
--    the same person can't be double-inserted as their own child's
--    guardian twice.
--
--    RLS: a guardian can see their own guardianship rows (their own
--    "which children am I linked to" signal). No insert/update/delete
--    policy for authenticated at all -- same posture as
--    code_lookup_attempts and clinician_government_id. Only SECURITY
--    DEFINER functions ever write this table: the dual-write trigger
--    below (section 3), and -- from Step 2 onward -- the claim-code RPC
--    and create_school_passport()'s own future companion for whoever
--    claims what it creates. Never a direct client insert.
-- =====================================================================
create table public.passport_guardians (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (passport_id, user_id)
);

create index passport_guardians_passport_id_idx on public.passport_guardians (passport_id);
create index passport_guardians_user_id_idx on public.passport_guardians (user_id);

alter table public.passport_guardians enable row level security;

create policy "Guardians can view their own guardianship links"
  on public.passport_guardians
  for select
  to authenticated
  using (user_id = auth.uid());

-- =====================================================================
-- 3. owns_passport() -- the rewrite. Every one of the ~32 live call
--    sites traced in Step 0's recon inherits this automatically: same
--    shape (a boolean gate), same NULL-safety property (no guardian row
--    -> exists() is false -> refused/empty exactly as before), now
--    correctly meaning "is a guardian of" instead of "is the recorded
--    owner of". This is the single predicate swap that makes group 1 of
--    Step 0's point 2 correct with no further changes -- get_parent_
--    incidents(), can_view_message(), send_message(), get_passport_
--    team(), and everything else that treats owns_passport() as an
--    opaque boolean gate now supports multiple guardians for free,
--    because "does at least one row in passport_guardians match" is
--    exactly what exists() already tests.
-- =====================================================================
create or replace function public.owns_passport(check_passport_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.passport_guardians g
    where g.passport_id = check_passport_id and g.user_id = auth.uid()
  );
$$;

-- =====================================================================
-- 4. Dual-write trigger + one-time backfill (decision 1). This is the
--    entire reason 0/643 existing adversarial checks need to change:
--    every fixture in the suite still creates a passport the exact way
--    it always has -- admin.from("passports").insert({ user_id:
--    parentXId, ... }) -- and this trigger keeps passport_guardians in
--    sync underneath that, invisibly, so owns_passport()'s rewrite
--    (section 3) evaluates identically to before for every one of those
--    fixtures. Same mechanism covers the real production signup flow
--    (passport/welcome, passport/section-a), which also sets user_id =
--    auth.uid() directly and needs zero changes to keep working.
--
--    THIS TRIGGER IS A BRIDGE, NOT A PERMANENT FIXTURE. It exists only
--    to keep every user_id-setting write path (old fixtures, the
--    current signup flow, anything not yet updated) correct without
--    being rewritten immediately. It should be dropped once ALL of the
--    following are true -- tracked in CLAUDE.md's Deferred work so this
--    doesn't happen by accident:
--      a. Every write path that establishes a guardian relationship
--         (signup, the claim-code flow, any future "add a second
--         guardian" flow) inserts into passport_guardians directly,
--         not via passports.user_id.
--      b. No adversarial fixture sets passports.user_id as its way of
--         establishing test-guardian state; they all insert into
--         passport_guardians directly, or drive the real RPC.
--      c. passports.user_id itself is either fully retired as a
--         concept or kept purely as historical/display metadata that
--         nothing authorizes against.
--    Until then, every NEW write path built on top of this stage should
--    write passport_guardians directly and treat this trigger as a
--    safety net for old callers, not as the intended mechanism to rely
--    on going forward.
-- =====================================================================
create or replace function public.sync_passport_guardian_from_user_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null then
    insert into public.passport_guardians (passport_id, user_id)
    values (new.id, new.user_id)
    on conflict (passport_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_passport_guardian_on_passports_write on public.passports;
create trigger sync_passport_guardian_on_passports_write
  after insert or update of user_id on public.passports
  for each row
  execute function public.sync_passport_guardian_from_user_id();

-- One-time backfill: every passport that already has an owner today
-- gets a matching guardian row now, so owns_passport()'s rewrite is a
-- no-op in behavior for every passport that exists before this
-- migration runs.
insert into public.passport_guardians (passport_id, user_id)
select p.id, p.user_id
from public.passports p
where p.user_id is not null
on conflict (passport_id, user_id) do nothing;

-- =====================================================================
-- 5. WHAT THIS MIGRATION DELIBERATELY DOES NOT DO -- decisions 3 and 4
--    named DROPPING passports.user_id's unique(user_id), and RE-KEYING
--    passport_section_b/c/d off unique(user_id) entirely. Both of those
--    constraints are live ON CONFLICT targets for real, currently-
--    shipping client upserts:
--      - passports itself: src/app/passport/section-a/page.tsx and
--        src/app/passport/welcome/page.tsx, .upsert(..., { onConflict:
--        "user_id" }).
--      - passport_section_b/c/d: usePassportSectionB/C/D.ts, same
--        onConflict: "user_id" shape, three files.
--    Dropping either constraint in the same breath as this migration
--    running -- before the client that depends on it has redeployed --
--    guarantees a window where every one of those saves errors with
--    "no unique or exclusion constraint matching the ON CONFLICT
--    specification", for every parent mid-onboarding or editing a
--    section, the moment this SQL runs and before the next deploy
--    lands. That is not an acceptable trade for tidiness.
--
--    So this migration ADDS the new constraint passport_section_b/c/d
--    need (unique(passport_id) below) without touching the old
--    unique(user_id) yet -- purely additive, zero client dependency,
--    safe to run standalone. Section B/C/D's DROP of unique(user_id)
--    is Step 1b: a fast follow-up, right after the three hooks'
--    onConflict target moves to "passport_id" and that's confirmed
--    deployed. I'll bring that next, once this is confirmed run.
--
--    passports.user_id's own unique(user_id) is different in kind, not
--    just sequencing: section B/C/D have a natural replacement key
--    (passport_id, since they're 1:1 children of a passport already).
--    passports itself doesn't -- there's no natural "one row per X" key
--    to re-key onto, because dropping this constraint is what makes a
--    parent-with-two-children *possible*, and welcome/section-a's
--    current upsert-by-user_id logic was written on the assumption that
--    a returning parent is always resuming their ONE passport, never
--    starting a second one. Re-pointing that upsert at a different
--    column doesn't answer the real question underneath it: how does
--    the welcome flow tell "resume my in-progress passport" apart from
--    "start a second child's passport" once both are legitimately
--    possible? That's a real product decision, not a mechanical rekey,
--    and I'm not making it silently inside a groundwork migration.
--    Flagging it rather than dropping the constraint blind.
-- =====================================================================
alter table public.passport_section_b add constraint passport_section_b_passport_id_key unique (passport_id);
alter table public.passport_section_c add constraint passport_section_c_passport_id_key unique (passport_id);
alter table public.passport_section_d add constraint passport_section_d_passport_id_key unique (passport_id);

-- =====================================================================
-- 6. The two named mislabelling cases (decision 2 -- fixed in this
--    migration, not split out).
-- =====================================================================

-- 6a. get_fba_instrument_requests(): recipient_role was derived by
-- comparing r.recipient_id to passports.user_id directly -- under a
-- null user_id (or, before Stage 5 even applies, under a passport that
-- will soon have multiple guardians) that comparison silently mislabels
-- a real parent/guardian recipient as 'class_teacher'. Rewritten to
-- check passport_guardians membership instead. Byte-identical
-- otherwise to the live 0048 definition.
create or replace function public.get_fba_instrument_requests(p_fba_id uuid)
returns table (
  id uuid,
  instrument_type text,
  recipient_id uuid,
  recipient_name text,
  recipient_role text,
  status text,
  responses_data jsonb,
  instruction text,
  created_at timestamptz,
  completed_at timestamptz,
  last_reminded_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.id,
    r.instrument_type,
    r.recipient_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as recipient_name,
    case
      when exists (
        select 1 from public.passport_guardians pg
        where pg.passport_id = fr.passport_id and pg.user_id = r.recipient_id
      ) then 'parent'
      else 'class_teacher'
    end as recipient_role,
    r.status,
    r.responses_data,
    r.instruction,
    r.created_at,
    r.completed_at,
    r.last_reminded_at
  from public.fba_instrument_requests r
  join public.fba_reports fr on fr.id = r.fba_id
  join public.clinician_access ca on ca.passport_id = fr.passport_id
  join auth.users u on u.id = r.recipient_id
  where r.fba_id = p_fba_id
    and fr.clinician_id = auth.uid()
    and ca.clinician_id = auth.uid()
    and ca.is_active = true
    and public.is_verified_clinician(auth.uid())
  order by r.created_at desc;
$$;

-- 6b/6c. notify_parent_of_incident_stamp() and notify_parents_of_
-- incident_signoff(): both used to look up a single v_parent_id scalar
-- from passports.user_id, then treated "no matching auth.users row"
-- (which a null user_id guarantees) identically to "the account is
-- dormant" -- coalesce(v_dormant, true) can't tell "never existed" apart
-- from "exists but hasn't confirmed/signed in", and wrote the same
-- 'dormant_account' reason for both. That reason is now false for an
-- unclaimed passport: there IS no account, dormant or otherwise.
--
-- Rewritten around passport_guardians, and generalized to N guardians
-- at the same time (decision 2 folded in with decision covering point
-- 3 of the recon, since both triggers had the identical scalar-single-
-- parent assumption): notify if ANY guardian is reachable (not
-- dormant); one notice row is enough regardless of guardian count,
-- since parent_incident_notices' own SELECT policy is owns_passport()-
-- based and therefore already visible to every guardian, not just
-- whoever the row happened to be attributed to. Three distinguishable
-- outcomes now: notified (at least one reachable guardian), blocked as
-- 'dormant_account' (guardians exist, none reachable), or blocked as
-- the new 'no_guardian_claimed' (no guardian at all yet -- see the
-- check constraint added in section 7).
create or replace function public.notify_parent_of_incident_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_institution_id uuid;
  v_has_guardians boolean;
  v_has_reachable_guardian boolean;
begin
  select i.institution_id into v_institution_id from public.incidents i where i.id = new.incident_id;

  select
    count(*) > 0,
    coalesce(bool_or(not (u.email_confirmed_at is null or u.last_sign_in_at is null)), false)
  into v_has_guardians, v_has_reachable_guardian
  from public.passport_guardians g
  join auth.users u on u.id = g.user_id
  where g.passport_id = new.passport_id;

  if v_has_reachable_guardian then
    insert into public.parent_incident_notices (notice_type, incident_id, passport_id, institution_id)
    values ('incident_recorded', new.incident_id, new.passport_id, v_institution_id);

    update public.incident_children
    set parent_notified_at = now(), parent_notified_by = new.added_by, parent_notification_blocked_reason = null
    where id = new.id;
  elsif v_has_guardians then
    update public.incident_children
    set parent_notification_blocked_reason = 'dormant_account'
    where id = new.id;
  else
    update public.incident_children
    set parent_notification_blocked_reason = 'no_guardian_claimed'
    where id = new.id;
  end if;

  return new;
end;
$$;

create or replace function public.notify_parents_of_incident_signoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child record;
  v_has_guardians boolean;
  v_has_reachable_guardian boolean;
begin
  if new.teacher_signed_at is not null and old.teacher_signed_at is null then
    for v_child in
      select ic.id, ic.passport_id from public.incident_children ic where ic.incident_id = new.id
    loop
      select
        count(*) > 0,
        coalesce(bool_or(not (u.email_confirmed_at is null or u.last_sign_in_at is null)), false)
      into v_has_guardians, v_has_reachable_guardian
      from public.passport_guardians g
      join auth.users u on u.id = g.user_id
      where g.passport_id = v_child.passport_id;

      if v_has_reachable_guardian then
        insert into public.parent_incident_notices (notice_type, incident_id, passport_id, institution_id)
        values ('incident_summary_ready', new.id, v_child.passport_id, new.institution_id);

        update public.incident_children
        set parent_notified_at = now(), parent_notified_by = new.teacher_signed_by, parent_notification_blocked_reason = null
        where id = v_child.id;
      elsif v_has_guardians then
        update public.incident_children
        set parent_notification_blocked_reason = 'dormant_account'
        where id = v_child.id;
      else
        update public.incident_children
        set parent_notification_blocked_reason = 'no_guardian_claimed'
        where id = v_child.id;
      end if;
    end loop;
  end if;
  return new;
end;
$$;

-- =====================================================================
-- 7. incident_children.parent_notification_blocked_reason's check
-- constraint gains the new value. Not a reuse of 'dormant_account' --
-- decision 2 was explicit that this needs to be its own reason, since
-- it's a materially different, and materially less alarming, situation
-- for a teacher reading it (no account exists yet to be dormant, vs. an
-- account exists and has gone quiet).
-- =====================================================================
alter table public.incident_children drop constraint if exists incident_children_parent_notification_blocked_reason_check;
alter table public.incident_children
  add constraint incident_children_parent_notification_blocked_reason_check
  check (parent_notification_blocked_reason is null or parent_notification_blocked_reason in ('dormant_account', 'no_guardian_claimed'));

-- =====================================================================
-- 8. The two row-count-as-signal RPCs (decision 2's second half). Both
-- repurpose "zero rows" as a meaningful UI state, not just "no access"
-- -- get_child_clinical_document_status's own 0046 comment: "a row's
-- mere ABSENCE is the signal 'no FBA has ever been started'";
-- get_my_child_calm_cards' own 0053 comment: "zero rows = locked state,
-- any rows = live". Before Stage 5, owns_passport() failing was only
-- ever reachable by a caller probing a passport_id that genuinely isn't
-- theirs -- indistinguishable from "nothing started/locked", but also
-- never hit by a legitimate signed-in user, since every existing caller
-- of both RPCs resolves passport_id from the current user's own already-
-- established dashboard. Stage 5 doesn't change that for either of
-- today's four call sites (ClinicalSupportSection.tsx, CalmUnlockSheet.
-- tsx, useParentCalmAccess.ts) -- but it does make "signed in, not yet a
-- guardian of this specific passport" a real, non-adversarial state for
-- the first time (a claim-flow landing screen showing a preview before
-- redemption, Step 2/3), so both RPCs need to stop overloading zero rows
-- before anything is built on top of that assumption.
--
-- The two functions needed different fixes, not the same one, because
-- of how their existing clients consume the result shape:
--
--   get_child_clinical_document_status's two consumers both do
--   `(statusRows ?? [])[0] ?? null` -- a single optional row. Adding a
--   leading is_authorized boolean and returning exactly one row (null
--   fields but is_authorized: false) when unauthorized is safe for both
--   of today's callers, since neither is reachable with an
--   unauthorized passport_id today -- but it changes the CONTRACT, so
--   any future caller (the claim-preview screen) must check
--   is_authorized explicitly, not infer state from truthiness of the
--   row alone. Needs DROP + CREATE, not CREATE OR REPLACE -- Postgres
--   won't let a REPLACE add a column to an existing RETURNS TABLE.
--
--   get_my_child_calm_cards' one consumer (useParentCalmAccess.ts) does
--   `cardRows.map(row => ({ ...row.trigger_tags, ... }))` over EVERY
--   returned row, building a real calm-card object from each one --
--   there's no safe place to put a sentinel "not authorized" row in
--   that shape without it being mapped into a broken fake card. Used
--   raise exception instead, matching this schema's own established
--   idiom for a hard refusal (record_calm_episode, approve_fba_
--   strategies) -- authorized-but-nothing-published still correctly
--   returns zero real rows (unambiguous, unchanged), and "not
--   authorized" is now a distinct signal (an error) instead of being
--   silently absorbed into "locked". No client change required: the
--   hook's existing error branch already preserves last-known state on
--   any RPC error, which is exactly the right behavior for a case that
--   was never reachable from its own call site anyway.
-- =====================================================================
drop function if exists public.get_child_clinical_document_status(uuid);

create function public.get_child_clinical_document_status(p_passport_id uuid)
returns table (
  is_authorized boolean,
  document_type text,
  status text,
  fba_id uuid,
  started_at timestamptz,
  completed_at timestamptz,
  is_approved boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_authorized boolean := public.owns_passport(p_passport_id);
  v_document_type text;
  v_status text;
  v_fba_id uuid;
  v_started_at timestamptz;
  v_completed_at timestamptz;
  v_is_approved boolean;
begin
  if v_authorized then
    select
      'fba'::text,
      case when fr.status = 'completed' then 'completed' else 'in_progress' end,
      fr.id,
      fr.created_at,
      fr.completed_at,
      exists (
        select 1 from public.passport_clinical_content pcc
        where pcc.source_document_type = 'fba_report' and pcc.source_document_id = fr.id
      )
    into v_document_type, v_status, v_fba_id, v_started_at, v_completed_at, v_is_approved
    from public.fba_reports fr
    where fr.passport_id = p_passport_id
    order by fr.updated_at desc
    limit 1;
  end if;

  return query select v_authorized, v_document_type, v_status, v_fba_id, v_started_at, v_completed_at, v_is_approved;
end;
$$;

grant execute on function public.get_child_clinical_document_status(uuid) to authenticated;

create or replace function public.get_my_child_calm_cards(p_passport_id uuid)
returns table (
  id uuid,
  title text,
  steps jsonb,
  door_type text,
  trigger_tags text[]
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.owns_passport(p_passport_id) then
    raise exception 'Not authorized for this passport.';
  end if;

  return query
  select c.id, c.title, c.steps, c.door_type, c.trigger_tags
  from public.fba_calm_cards c
  join public.fba_reports fr on fr.id = c.fba_id
  where fr.passport_id = p_passport_id
    and fr.status = 'completed'
    and c.is_published = true
  order by c.door_type, c.created_at asc;
end;
$$;

grant execute on function public.get_my_child_calm_cards(uuid) to authenticated;

-- =====================================================================
-- 9. Multiple-guardian fan-out for the two message-recipient-candidate
-- RPCs (recon point 3): both had a "parent" candidate branch built as a
-- single join against passports.user_id, so under multiple guardians
-- only one of them could ever appear as messageable, arbitrarily.
-- Rewritten as a join against passport_guardians instead, which
-- naturally returns one candidate row per guardian -- 0, 1, or many.
-- Everything else in both functions (teacher/clinician/SNA branches,
-- the authorized/authorized_fba gates) is untouched.
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
  )
  select recipient_id, full_name, role
  from candidates
  where recipient_id <> auth.uid();
$$;

grant execute on function public.get_message_recipient_candidates(uuid) to authenticated;

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
    g.user_id as recipient_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    'parent' as role
  from authorized_fba af
  join public.passport_guardians g on g.passport_id = af.passport_id
  join auth.users u on u.id = g.user_id

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

-- =====================================================================
-- 10. create_school_passport() -- decision 6, the atomic creation RPC.
-- Inserts the passports row AND its passport_institution_links row in
-- one transaction, auto-approved -- there is no parent to approve it,
-- and get_institution_child_roster() (source for /principal/passports,
-- /principal/classes, every institution-side roster screen) INNER
-- JOINs passport_institution_links, so a passport created without this
-- link in the same transaction would be invisible on every one of those
-- screens the moment it was created, to the very principal who just
-- created it. Found before it shipped, not after.
--
-- approved_by_parent = true here doesn't mean a parent approved
-- anything -- it means the institution itself is the origin, the same
-- authority a parent's own approval would carry. parent_approved_at is
-- left null rather than backdated to now(), since that column
-- specifically means "a parent did this at this time" and nobody did.
-- The distinction that actually matters going forward -- institution-
-- created vs. parent-approved -- is which RPC wrote the row, not
-- anything encoded on the row itself; not reopening that column's
-- meaning further in this migration.
--
-- Restricted to an active, approved principal of the target
-- institution -- same authorization shape as grant_passport_access()
-- (0111). Minimal payload (child_name only) -- Step 2/3's client screen
-- can extend what's collected before creation without this function's
-- shape needing to change.
-- =====================================================================
create or replace function public.create_school_passport(p_institution_id uuid, p_child_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_passport_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if coalesce(trim(p_child_name), '') = '' then
    raise exception 'A child name is required.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) then
    raise exception 'Only an active, verified principal can create a passport for their school.';
  end if;

  insert into public.passports (child_name, passport_status)
  values (trim(p_child_name), 'not_started')
  returning id into v_passport_id;

  insert into public.passport_institution_links (passport_id, institution_id, approved_by_parent, parent_approved_at)
  values (v_passport_id, p_institution_id, true, null);

  return v_passport_id;
end;
$$;

grant execute on function public.create_school_passport(uuid, text) to authenticated;
