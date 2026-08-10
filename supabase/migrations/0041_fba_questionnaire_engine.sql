-- FBA MODULE -- STAGE 2 schema additions: the questionnaire engine.
--
-- Everything else Stage 2 needs (assessment date range, ABC function
-- tags, sent-instrument summaries for completeness) lives in
-- fba_reports.content_data, which already exists -- no table changes
-- needed for Part B (ABC integration) at all.
--
-- This migration adds exactly what Part A (questionnaire engine) needs
-- beyond Stage 1's fba_instrument_requests/fba_instruments, plus three
-- read RPCs so the clinical boundary holds: a recipient must never be
-- able to read fba_reports, passports, or clinicians directly (Stage 1
-- gives them none of those), yet still needs a child's display name and
-- the requesting clinician's name to render the dashboard prompt card
-- and the completion flow. Every RPC below is SECURITY DEFINER and
-- re-implements its own authorization check for exactly that reason --
-- SECURITY DEFINER bypasses the underlying tables' RLS, so the function
-- body is the only thing standing between "authorized" and "everyone".
--
-- Judgment calls, spelled out:
--
--   1. last_reminded_at is a new column, not a side-table or a
--      content_data field -- a clinician's "Send reminder" tap needs
--      to be visible to the SAME recipient row's own SELECT policy
--      (recipient_id = auth.uid(), already unconditional from Stage 1)
--      so the recipient's dashboard card can show it, and recipients
--      have zero access to fba_reports.content_data by design. Column-
--      scoped GRANT (matching the responses_data/status pattern from
--      Stage 1) plus a brand-new clinician UPDATE policy -- clinicians
--      had no UPDATE policy on this table at all before now, since
--      Stage 1 only needed clinician INSERT + SELECT.
--
--      Caveat carried over from Stage 1's own column-grant pattern:
--      Postgres grants are per-role (authenticated), not per-policy, so
--      granting UPDATE (last_reminded_at) to authenticated technically
--      lets a recipient attempt to write their own row's
--      last_reminded_at too (no UI path ever does this, and it's inert
--      -- a timestamp the clinician reads for their own reminder
--      tracking, not a security boundary). Precisely the same caveat
--      Stage 1 already accepted for review_cadence_days.
--
--   2. A partial unique index blocks a second concurrent (sent/
--      in_progress) request for the same instrument+recipient+FBA at
--      the database level, mirroring fba_reports_one_active_per_passport
--      -- the brief's "disabled with a message" is a UI nicety on top
--      of this, not the actual guarantee.
--
--   3. completed_at is stamped by a trigger (mirroring
--      set_fba_completed_at), not by the recipient's own UPDATE --
--      completed_at was never in the recipient's column grant and
--      shouldn't be; trusting a client timestamp for a clinical record
--      is exactly the kind of thing Stage 1 avoided everywhere else.
--
--   4. get_fba_recipient_candidates() teacher branch uses the STRICTER
--      of the two "actively linked teacher" definitions that already
--      coexist in this codebase: passport_access.is_active = true AND
--      passport_institution_links.approved_by_parent = true (the
--      useTeacherPassports.ts rule), not get_passport_team()'s looser
--      is_active-only check. This RPC is granting a teacher visibility
--      into clinical questionnaire activity, so the stricter definition
--      is the defensible one.
--
--   5. get_my_instrument_requests() and get_fba_instrument_requests()
--      only ever resolve names via auth.users.raw_user_meta_data /
--      raw_app_meta_data (the same coalesce idiom get_teacher_name /
--      get_passport_team / get_abc_logs already use) -- never expose
--      clinicians.specialty, verification_status, or any other column a
--      recipient has no business seeing.
--
--   6. No new activity_log event types. A questionnaire_sent/
--      questionnaire_completed event would need touching FOUR places
--      (the CHECK constraint, get_clinician_activity_feed's allow-list,
--      the parent's activity_log deny-list, and get_teacher_activity_feed
--      for a teacher-authored completion) to avoid leaking "a
--      questionnaire is out" to the parent before Stage 3's completion
--      flow says they should know anything changed. The brief allows
--      skipping this ("otherwise skip"), and Section 7's chips are a
--      strictly better signal for the clinician anyway.
--
--   7. Completed = locked for the recipient too, same reasoning as
--      fba_reports (Stage 1, judgment call #3). Stage 1's recipient
--      UPDATE policy only checked recipient_id = auth.uid(), with no
--      status guard -- so a recipient could otherwise flip a completed
--      request back to in_progress and edit responses_data after the
--      clinician has already scored and interpreted it, silently
--      invalidating Section 7's charts with no signal that happened.
--      Narrowed below via ALTER POLICY (the row was created in
--      migration 0040; this is the same minimal-diff mechanism Stage 1
--      used to narrow the parent's activity_log policy without
--      restructuring it) -- USING is evaluated against the OLD row, so
--      it blocks every update attempt once OLD.status = 'completed'
--      while still allowing the one legitimate transition into
--      'completed', since the OLD row isn't completed yet at that
--      point. The new clinician reminder policy below is deliberately
--      NOT given the same guard -- last_reminded_at doesn't affect
--      responses_data/status/scoring, so there's nothing to invalidate
--      by touching it after completion (the UI simply won't offer the
--      button on a completed chip).

-- ============================================================
-- 1. fba_instrument_requests -- last_reminded_at + completed_at trigger
--    + duplicate-request guard
-- ============================================================

alter table public.fba_instrument_requests
  add column last_reminded_at timestamptz;

create unique index fba_instrument_requests_one_active_per_recipient
  on public.fba_instrument_requests (fba_id, instrument_type, recipient_id)
  where status in ('sent', 'in_progress');

-- Judgment call #7: completed = locked for the recipient too, mirroring
-- fba_reports' own completed-lock exactly. Narrows the existing policy
-- from migration 0040 (recipient_id = auth.uid() only, no status guard)
-- rather than dropping/recreating it.
alter policy "Recipients can update their own responses"
  on public.fba_instrument_requests
  using (recipient_id = auth.uid() and status <> 'completed')
  with check (recipient_id = auth.uid());

create or replace function public.set_instrument_request_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists set_instrument_requests_completed_at on public.fba_instrument_requests;
create trigger set_instrument_requests_completed_at
  before update on public.fba_instrument_requests
  for each row
  execute function public.set_instrument_request_completed_at();

-- Clinicians had no UPDATE policy on this table at all before Stage 2
-- (INSERT + SELECT only). This adds exactly enough to send a reminder,
-- authorized identically to their existing INSERT/SELECT policies.
grant update (last_reminded_at) on public.fba_instrument_requests to authenticated;

create policy "Clinicians can send reminders on their own FBA's requests"
  on public.fba_instrument_requests
  for update
  to authenticated
  using (
    exists (
      select 1 from public.fba_reports fr
      join public.clinician_access ca on ca.passport_id = fr.passport_id
      where fr.id = fba_instrument_requests.fba_id
        and fr.clinician_id = auth.uid()
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
        and public.is_verified_clinician(auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.fba_reports fr
      join public.clinician_access ca on ca.passport_id = fr.passport_id
      where fr.id = fba_instrument_requests.fba_id
        and fr.clinician_id = auth.uid()
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
        and public.is_verified_clinician(auth.uid())
    )
  );

-- ============================================================
-- 2. get_fba_recipient_candidates() -- the Send Questionnaire picker:
--    the parent (passport owner) + actively-linked, parent-approved
--    teachers. Clinician-authorization-checked like every other
--    SECURITY DEFINER convenience function in this schema.
-- ============================================================

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
    'class_teacher' as role
  from authorized_fba af
  join public.passport_access pa on pa.passport_id = af.passport_id
  join public.passport_institution_links pil
    on pil.passport_id = pa.passport_id and pil.institution_id = pa.institution_id
  join auth.users u on u.id = pa.teacher_id
  where pa.is_active = true
    and pil.approved_by_parent = true;
$$;

grant execute on function public.get_fba_recipient_candidates(uuid) to authenticated;

-- ============================================================
-- 3. get_fba_instrument_requests() -- Section 7's tracking chips +
--    results/scoring source. Recipient names resolved server-side so
--    the client never needs a second round-trip through
--    get_fba_recipient_candidates to label a chip.
-- ============================================================

create or replace function public.get_fba_instrument_requests(p_fba_id uuid)
returns table (
  id uuid,
  instrument_type text,
  recipient_id uuid,
  recipient_name text,
  recipient_role text,
  status text,
  responses_data jsonb,
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
    case when p.user_id = r.recipient_id then 'parent' else 'class_teacher' end as recipient_role,
    r.status,
    r.responses_data,
    r.created_at,
    r.completed_at,
    r.last_reminded_at
  from public.fba_instrument_requests r
  join public.fba_reports fr on fr.id = r.fba_id
  join public.clinician_access ca on ca.passport_id = fr.passport_id
  join public.passports p on p.id = fr.passport_id
  join auth.users u on u.id = r.recipient_id
  where r.fba_id = p_fba_id
    and fr.clinician_id = auth.uid()
    and ca.clinician_id = auth.uid()
    and ca.is_active = true
    and public.is_verified_clinician(auth.uid())
  order by r.created_at desc;
$$;

grant execute on function public.get_fba_instrument_requests(uuid) to authenticated;

-- ============================================================
-- 4. get_my_instrument_requests() -- the recipient's own dashboard
--    prompt card. Scoped to recipient_id = auth.uid() only -- this is
--    the one RPC a parent or teacher can call, and it can only ever
--    return that caller's own requests, with just enough display data
--    (child's name, clinician's name) to render the card and completion
--    flow -- never scores, never anything from content_data.
-- ============================================================

create or replace function public.get_my_instrument_requests()
returns table (
  id uuid,
  fba_id uuid,
  instrument_type text,
  status text,
  child_name text,
  clinician_name text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.id,
    r.fba_id,
    r.instrument_type,
    r.status,
    p.child_name,
    coalesce(cu.raw_user_meta_data ->> 'full_name', cu.raw_app_meta_data ->> 'full_name') as clinician_name,
    r.created_at
  from public.fba_instrument_requests r
  join public.fba_reports fr on fr.id = r.fba_id
  join public.passports p on p.id = r.passport_id
  join auth.users cu on cu.id = fr.clinician_id
  where r.recipient_id = auth.uid()
    and r.status in ('sent', 'in_progress')
  order by r.created_at asc;
$$;

grant execute on function public.get_my_instrument_requests() to authenticated;
