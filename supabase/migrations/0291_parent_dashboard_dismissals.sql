-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Two real bugs, plus a standing rule: everything on the parent
-- dashboard is dismissible. Daniel's own report, 22 Sept 2026.
--
-- ===========================================================================
-- BUG 1 -- a cancelled FBA questionnaire request stayed on the parent
-- dashboard forever. finalize_fba_report() (0199) already sets
-- fba_instrument_requests.status = 'cancelled' correctly, in the same
-- transaction as finalizing -- the auto-cancel was never the problem.
-- The actual defect: get_my_instrument_requests() (0199) was widened to
-- ALSO return 'cancelled' rows, forever, with no dismiss control
-- anywhere. Reverted here to match its own newer sibling mechanism
-- (assessments.assigned_respondent_id, PRD 7) which already does the
-- simple thing on resolution: the item just stops being returned, no
-- lingering banner to explain or dismiss. "A cancelled request must
-- leave the dashboard on its own" -- this is that, at the root, not a
-- dismiss button.
--
-- Deliberately NOT extending dismissal to a still-pending (sent/
-- in_progress) fba_instrument_requests row -- the only place a
-- clinician would see "dismissed by parent" for one is
-- InstrumentRequestChip.tsx / useFbaInstrumentRequests.ts, both the
-- FBA's own indirect-assessment section and its data hook. Confirmed
-- with Daniel: hold this out. THE FBA IS NOT TO BE TOUCHED.
-- ===========================================================================

drop function if exists public.get_my_instrument_requests();

create function public.get_my_instrument_requests()
returns table (
  id uuid,
  fba_id uuid,
  instrument_type text,
  status text,
  child_name text,
  clinician_name text,
  instruction text,
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
    r.instruction,
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

-- ===========================================================================
-- BUG 2 -- cancelled AND past sessions stay on the parent dashboard
-- permanently. Checked live, real RPC call, real session: the "past"
-- half is already correct -- get_my_upcoming_bookings()'s own
-- `session_end_at > now()` filter (0286) already excludes a booking,
-- cancelled or not, once its original scheduled time passes; it
-- correctly surfaces in get_my_booking_history() instead. Nothing to
-- fix there.
--
-- What's real: a cancelled booking has no dismiss at all today, so it
-- sits under "Upcoming Sessions" -- cluttering the one thing a parent
-- actually needs to see -- until its own original time happens to pass,
-- which can be days away. A dead item, per Daniel's own rule: dismiss
-- simply hides it, no warning.
--
-- Per-guardian, not a column on bookings -- a booking has no single
-- "recipient", it's shared by every guardian on the passport
-- (unlike fba_instrument_requests/passport_completion_requests/
-- assessments, which target exactly one person per row and are
-- already correctly per-parent by construction). One small join
-- table, matching this schema's own established shape for "who has
-- acted on this shared thing" (passport_guardians' own precedent).
-- ===========================================================================

create table public.booking_dismissals (
  booking_id uuid not null references public.bookings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (booking_id, user_id)
);

alter table public.booking_dismissals enable row level security;

-- No client-facing SELECT/INSERT/DELETE policy at all -- matching this
-- schema's own established "no client policy, RPC only" posture for a
-- table whose entire job is backing a single write path
-- (bsp/clinical_lead_scope's own precedent). Both reads (the exclusion
-- inside get_my_upcoming_bookings()) and the one write
-- (dismiss_upcoming_booking_notice()) go through SECURITY DEFINER
-- functions.

create function public.dismiss_upcoming_booking_notice(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_passport_id uuid;
  v_cancelled_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select passport_id, cancelled_at into v_passport_id, v_cancelled_at
  from public.bookings
  where id = p_booking_id;

  if v_passport_id is null then
    raise exception 'Booking not found.';
  end if;

  if not public.owns_passport(v_passport_id) then
    raise exception 'Only this child''s own parent or guardian can dismiss this.';
  end if;

  if v_cancelled_at is null then
    raise exception 'Only a cancelled session can be dismissed.';
  end if;

  insert into public.booking_dismissals (booking_id, user_id)
  values (p_booking_id, auth.uid())
  on conflict (booking_id, user_id) do nothing;
end;
$$;

grant execute on function public.dismiss_upcoming_booking_notice(uuid) to authenticated;

drop function if exists public.get_my_upcoming_bookings(uuid);

create function public.get_my_upcoming_bookings(p_passport_id uuid)
returns table (
  booking_id uuid,
  clinician_id uuid,
  clinician_name text,
  session_type_name text,
  session_type_mode text,
  session_type_location_details text,
  session_start_at timestamptz,
  session_end_at timestamptz,
  google_sync_status text,
  google_meet_link text,
  cancelled_at timestamptz,
  cancelled_via text,
  cancellation_reason text
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.owns_passport(p_passport_id) then
    raise exception 'Only this child''s own parent or guardian can view their bookings.';
  end if;

  return query
  select b.id, b.clinician_id,
    coalesce(c.full_name, u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
    b.session_type_name, b.session_type_mode, b.session_type_location_details, b.session_start_at, b.session_end_at, b.google_sync_status, b.google_meet_link,
    b.cancelled_at, b.cancelled_via, b.cancellation_reason
  from public.bookings b
  join auth.users u on u.id = b.clinician_id
  left join public.clinicians c on c.user_id = b.clinician_id
  where b.passport_id = p_passport_id
    and b.session_end_at > now()
    and not exists (
      select 1 from public.booking_dismissals bd
      where bd.booking_id = b.id and bd.user_id = auth.uid()
    )
  order by b.session_start_at asc;
end;
$$;

grant execute on function public.get_my_upcoming_bookings(uuid) to authenticated;

-- ===========================================================================
-- THE STANDING RULE -- everything on the parent dashboard is
-- dismissible. Two more real item types, both LIVE REQUESTS (dismiss
-- with a warning, and the requester must see it was dismissed) --
-- both already correctly per-parent by construction (one row per
-- recipient), so a flat dismissed_at column is enough, no join table.
--
-- A dismissed passport-completion or assessment request does not
-- delete anything or unassign anyone -- the requester (teacher/
-- principal, or the assessment's own clinician) keeps full context and
-- can re-ask, which clears the dismissal. Re-asking the SAME person is
-- therefore never a silent duplicate-key failure -- see the
-- request_passport_completion() rewrite below, and
-- remind_assessment_respondent()'s own added clear.
-- ===========================================================================

alter table public.passport_completion_requests add column if not exists dismissed_at timestamptz;

create function public.dismiss_passport_completion_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  update public.passport_completion_requests
  set dismissed_at = now()
  where id = p_request_id
    and recipient_id = auth.uid();

  if not found then
    raise exception 'Request not found.';
  end if;
end;
$$;

grant execute on function public.dismiss_passport_completion_request(uuid) to authenticated;

drop function if exists public.get_my_passport_completion_requests();

create function public.get_my_passport_completion_requests()
returns table (
  id uuid,
  passport_id uuid,
  child_name text,
  institution_name text,
  target_section text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.id,
    r.passport_id,
    p.child_name,
    i.name as institution_name,
    r.target_section,
    r.created_at
  from public.passport_completion_requests r
  join public.passports p on p.id = r.passport_id
  join public.institutions i on i.id = r.institution_id
  left join public.passport_section_e se on se.passport_id = r.passport_id
  where r.recipient_id = auth.uid()
    and r.dismissed_at is null
    and (
      (r.target_section = 'a' and coalesce(p.section_a_complete, false) = false)
      or (r.target_section = 'e' and coalesce(se.section_e_complete, false) = false)
    )
  order by r.created_at asc;
$$;

grant execute on function public.get_my_passport_completion_requests() to authenticated;

-- Staff-facing read, RETURNS TABLE shape widened (dismissed_at added) --
-- DROP+CREATE, not a bare CREATE OR REPLACE, per this schema's own
-- standing rule for a shape change.
drop function if exists public.get_passport_completion_requests(uuid);

create function public.get_passport_completion_requests(p_passport_id uuid)
returns table (
  id uuid,
  recipient_id uuid,
  recipient_name text,
  target_section text,
  created_at timestamptz,
  dismissed_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.id,
    r.recipient_id,
    coalesce(ru.raw_user_meta_data ->> 'full_name', ru.raw_app_meta_data ->> 'full_name') as recipient_name,
    r.target_section,
    r.created_at,
    r.dismissed_at
  from public.passport_completion_requests r
  join auth.users ru on ru.id = r.recipient_id
  where r.passport_id = p_passport_id
    and (
      public.owns_passport(p_passport_id)
      or public.has_child_access(auth.uid(), p_passport_id)
      or exists (
        select 1 from public.institution_staff s
        join public.passport_institution_links pil on pil.institution_id = s.institution_id
        where pil.passport_id = p_passport_id
          and s.user_id = auth.uid()
          and s.role = 'principal'
          and s.deactivated_at is null
          and s.approved_at is not null
      )
    )
  order by r.created_at asc;
$$;

grant execute on function public.get_passport_completion_requests(uuid) to authenticated;

-- Re-asking the same person after a dismiss must un-dismiss, not
-- silently fail on "already requested from every current guardian" --
-- the row from the earlier request still exists, only now with
-- dismissed_at set. Upsert instead of a plain filtered insert; v_created
-- now counts both genuinely new rows and un-dismissed ones.
drop function if exists public.request_passport_completion(uuid, uuid, text);

create function public.request_passport_completion(
  p_passport_id uuid,
  p_institution_id uuid,
  p_target_section text default 'a'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if p_target_section not in ('a', 'e') then
    raise exception 'Unknown section.';
  end if;

  if not public.institution_staff_has_current_standing(auth.uid(), p_institution_id) then
    raise exception 'Only an active member of staff at this school can request this.';
  end if;

  if not (
    public.has_child_access(auth.uid(), p_passport_id)
    or exists (
      select 1 from public.institution_staff s
      join public.passport_institution_links pil on pil.institution_id = s.institution_id
      where pil.passport_id = p_passport_id
        and s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and s.deactivated_at is null
        and s.approved_at is not null
    )
  ) then
    raise exception 'You need access to this child''s passport before you can request this.';
  end if;

  if not exists (
    select 1 from public.passport_guardians g where g.passport_id = p_passport_id
  ) then
    raise exception 'This child has no guardian to notify yet.';
  end if;

  insert into public.passport_completion_requests (
    passport_id, institution_id, requested_by, recipient_id, target_section
  )
  select p_passport_id, p_institution_id, auth.uid(), g.user_id, p_target_section
  from public.passport_guardians g
  where g.passport_id = p_passport_id
  on conflict (passport_id, recipient_id, target_section) do update
    set dismissed_at = null,
        requested_by = excluded.requested_by,
        created_at = now()
    where public.passport_completion_requests.dismissed_at is not null;

  get diagnostics v_created = row_count;

  if v_created = 0 then
    raise exception 'This has already been requested from every current guardian on this passport.';
  end if;

  return v_created;
end;
$$;

grant execute on function public.request_passport_completion(uuid, uuid, text) to authenticated;

-- ===========================================================================
-- assessments -- the respondent's own live request. Same posture as
-- passport_completion_requests: a flat column, since assigned_
-- respondent_id already targets exactly one person per row.
-- ===========================================================================

alter table public.assessments add column if not exists respondent_dismissed_at timestamptz;

create function public.dismiss_assessment_response_request(p_assessment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  update public.assessments
  set respondent_dismissed_at = now()
  where id = p_assessment_id
    and assigned_respondent_id = auth.uid()
    and completed_at is null;

  if not found then
    raise exception 'This assessment has no active assignment to dismiss.';
  end if;
end;
$$;

grant execute on function public.dismiss_assessment_response_request(uuid) to authenticated;

drop function if exists public.get_my_assessments_to_complete();

create function public.get_my_assessments_to_complete()
returns table (
  id uuid,
  child_name text,
  instrument_name text,
  clinician_name text,
  instruction text,
  assigned_at timestamptz,
  last_reminded_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    a.id, p.child_name, ai.name,
    coalesce(cu.raw_user_meta_data ->> 'full_name', cu.raw_app_meta_data ->> 'full_name'),
    a.instruction, a.assigned_at, a.last_reminded_at
  from public.assessments a
  join public.passports p on p.id = a.passport_id
  join public.assessment_instruments ai on ai.id = a.instrument_id
  join auth.users cu on cu.id = a.clinician_id
  where a.assigned_respondent_id = auth.uid()
    and a.completed_at is null
    and a.respondent_dismissed_at is null
  order by a.assigned_at asc;
$$;

grant execute on function public.get_my_assessments_to_complete() to authenticated;

-- Re-asking (a reminder) is a fresh ask -- clears a dismissal, matching
-- the same "re-ask un-dismisses" rule as passport_completion_requests.
create or replace function public.remind_assessment_respondent(p_assessment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  update public.assessments
  set last_reminded_at = now(),
      respondent_dismissed_at = null
  where id = p_assessment_id
    and clinician_id = auth.uid()
    and assigned_respondent_id is not null
    and completed_at is null;

  if not found then
    raise exception 'This assessment has no active assignment to remind.';
  end if;
end;
$$;

grant execute on function public.remind_assessment_respondent(uuid) to authenticated;

-- get_assessment_to_complete() (the respondent's own read) is
-- deliberately left unchanged -- it's already gated on
-- assigned_respondent_id = auth.uid() and completed_at is null, the
-- exact same clause the new dismiss RPC checks. A dismissed assessment
-- still opens correctly if the respondent taps back in from
-- somewhere else; only get_my_assessments_to_complete()'s own PROMPT
-- LIST needed the extra filter.

-- The clinician's own editor (AssessmentResponseSheetEditor.tsx) reads
-- straight off `assessments` via its own author-scoped RLS SELECT
-- policy (unchanged by this migration) -- respondent_dismissed_at is
-- just another column on that same row, no RPC change needed for the
-- clinician's own "Dismissed by the respondent" read.

-- No change needed for cross_organisation_grants -- Daniel's own
-- decision: a grant confirmation is a consent decision, not a
-- notification. "Dismiss" for this item type IS
-- decline_cross_organisation_grant() (already live, already director-
-- visible via status='declined'), called directly from the compact
-- card's own new "Not now" link -- no new schema.
