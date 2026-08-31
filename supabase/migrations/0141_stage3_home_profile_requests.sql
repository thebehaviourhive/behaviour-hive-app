-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 3, Stage 3 -- the home column. Recon (this same session) found the
-- clinician's questionnaire-respondent machinery (fba_instrument_requests
-- + get_my_instrument_requests(), migrations 0040/0048) is FBA-scoped by
-- a NOT NULL foreign key, clinician-gated by policy, and Likert-only by
-- its own answering UI -- none of which fits a school-issued, freeform
-- home profile. This migration copies the LIFECYCLE IDIOM (a request
-- issued to a named recipient, an attributed answer, status tracked
-- sent/in_progress/completed) and the column-scoped-grant RLS technique
-- verbatim, as a genuine sibling, not a widened original.
--
-- One row per (passport, guardian): every CURRENT guardian on the
-- passport gets their own request and their own attributable answer --
-- never merged, matching the standing "school-says/home-says, never
-- blended" rule this feature exists to serve. A second guardian added
-- later (the claim flow, Stage 1) can be asked separately without
-- disturbing the first guardian's own row.
--
-- No school-authored counterpart exists yet (see CLAUDE.md's own
-- "SCHOOL-AUTHORED CHILD PROFILE -- DEFERRED" entry) -- this migration
-- builds the home side only, deliberately, as a complete thing in
-- itself, not half of a comparison view.

-- ============================================================
-- 1. passport_home_profile_requests
-- ============================================================

create table public.passport_home_profile_requests (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  institution_id uuid not null references public.institutions (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'sent'
    check (status in ('sent', 'in_progress', 'completed')),
  what_works_at_home text,
  sleep text,
  food text,
  sensory_needs_home text,
  history_before_this_school text,
  previous_settings_feedback text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (passport_id, recipient_id)
);

create index passport_home_profile_requests_passport_id_idx
  on public.passport_home_profile_requests (passport_id);
create index passport_home_profile_requests_recipient_id_idx
  on public.passport_home_profile_requests (recipient_id);
create index passport_home_profile_requests_institution_id_idx
  on public.passport_home_profile_requests (institution_id);

drop trigger if exists set_passport_home_profile_requests_updated_at
  on public.passport_home_profile_requests;
create trigger set_passport_home_profile_requests_updated_at
  before update on public.passport_home_profile_requests
  for each row
  execute function public.set_updated_at();

-- completed_at is set once, the moment status first reaches 'completed'
-- -- never cleared or overwritten by a later edit (a guardian can keep
-- editing their own answer after completion; this timestamp records
-- when they FIRST finished, matching debrief/attestation timestamp
-- conventions elsewhere in this schema).
create or replace function public.set_home_profile_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' and old.completed_at is null then
    new.completed_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists set_home_profile_completed_at_trigger
  on public.passport_home_profile_requests;
create trigger set_home_profile_completed_at_trigger
  before update on public.passport_home_profile_requests
  for each row
  execute function public.set_home_profile_completed_at();

alter table public.passport_home_profile_requests enable row level security;

-- No INSERT policy -- deliberately, not a placeholder. Issuing a request
-- means enumerating current guardians, checking institution standing,
-- and skipping guardians who already have a row -- real logic that
-- belongs in request_passport_home_profile() (SECURITY DEFINER, below),
-- the same reasoning create_school_passport() and grant_passport_access()
-- already established for anything beyond a single-row authorization
-- check. Nothing client-side ever inserts into this table directly.

-- Any current guardian sees every guardian's own answer on this
-- passport -- owns_passport(), same as Section A-D. Attribution lives
-- in recipient_id; visibility is family-wide, matching how the rest of
-- the passport already works. Never merged client-side -- that's a
-- rendering decision for whichever screen reads this, not an RLS one.
create policy "Guardians can view every home profile response on their passport"
  on public.passport_home_profile_requests
  for select
  to authenticated
  using (public.owns_passport(passport_home_profile_requests.passport_id));

-- Column-scoped write: a recipient may only ever change their own six
-- content fields and status -- never passport_id, institution_id,
-- requested_by, or who it was sent to. Same mechanism as
-- fba_instrument_requests' own recipient-write policy (0040).
revoke update on public.passport_home_profile_requests from authenticated;
grant update (
  what_works_at_home, sleep, food, sensory_needs_home,
  history_before_this_school, previous_settings_feedback, status
) on public.passport_home_profile_requests to authenticated;

create policy "Recipients can update their own home profile response"
  on public.passport_home_profile_requests
  for update
  to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- Teachers/SNAs with real access to this child -- has_child_access(),
-- the unified chokepoint (0104), not a raw passport_access check. Reads
-- match how the rest of the passport is already visible to staff; the
-- narrower passport_access-specific gate is deliberately reserved for
-- who may ISSUE a request (request_passport_home_profile(), below), not
-- who may read one that already exists.
create policy "Staff with child access can view home profile responses"
  on public.passport_home_profile_requests
  for select
  to authenticated
  using (public.has_child_access(auth.uid(), passport_home_profile_requests.passport_id));

-- Verified linked clinicians -- same shape as Section B/C/D's own
-- clinician-read policies (0026/0029).
create policy "Verified linked clinicians can view home profile responses"
  on public.passport_home_profile_requests
  for select
  to authenticated
  using (
    exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = passport_home_profile_requests.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
    and public.is_verified_clinician(auth.uid())
  );

-- ============================================================
-- 2. request_passport_home_profile() -- the issuing RPC.
--    Gate: active institution standing AND an active passport_access
--    grant, per Daniel's own instruction -- narrower than
--    has_child_access() deliberately, distinct from who may later READ
--    the answer. One request per CURRENT guardian without an existing
--    row; guardians who already have one (any status) are skipped, not
--    duplicated. Returns the count of new requests actually created.
-- ============================================================

create or replace function public.request_passport_home_profile(
  p_passport_id uuid,
  p_institution_id uuid
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

  if not public.institution_staff_has_current_standing(auth.uid(), p_institution_id) then
    raise exception 'Only an active member of staff at this school can request a home profile.';
  end if;

  if not exists (
    select 1 from public.passport_access pa
    where pa.passport_id = p_passport_id
      and pa.institution_id = p_institution_id
      and pa.teacher_id = auth.uid()
      and pa.is_active = true
  ) then
    raise exception 'You need access to this child''s passport before you can request a home profile.';
  end if;

  if not exists (
    select 1 from public.passport_guardians g where g.passport_id = p_passport_id
  ) then
    raise exception 'This child has no guardian to notify yet.';
  end if;

  insert into public.passport_home_profile_requests (
    passport_id, institution_id, requested_by, recipient_id
  )
  select p_passport_id, p_institution_id, auth.uid(), g.user_id
  from public.passport_guardians g
  where g.passport_id = p_passport_id
    and not exists (
      select 1 from public.passport_home_profile_requests r
      where r.passport_id = p_passport_id
        and r.recipient_id = g.user_id
    );

  get diagnostics v_created = row_count;

  if v_created = 0 then
    raise exception 'A home profile has already been requested from every current guardian on this passport.';
  end if;

  return v_created;
end;
$$;

grant execute on function public.request_passport_home_profile(uuid, uuid) to authenticated;

-- ============================================================
-- 3. get_my_passport_profile_requests() -- the parent's own feed.
--    Same shape as get_my_instrument_requests() (0048): recipient-scoped,
--    only outstanding (not yet completed) rows, resolves display fields
--    inline. Labels by INSTITUTION name, not the individual staff
--    member who clicked the button -- "your child's school has asked
--    you", matching how the request is framed to the parent (Daniel's
--    own "the school issues" wording), not a named-teacher framing.
-- ============================================================

create or replace function public.get_my_passport_profile_requests()
returns table (
  id uuid,
  passport_id uuid,
  status text,
  child_name text,
  institution_name text,
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
    r.status,
    p.child_name,
    i.name as institution_name,
    r.created_at
  from public.passport_home_profile_requests r
  join public.passports p on p.id = r.passport_id
  join public.institutions i on i.id = r.institution_id
  where r.recipient_id = auth.uid()
    and r.status in ('sent', 'in_progress')
  order by r.created_at asc;
$$;

grant execute on function public.get_my_passport_profile_requests() to authenticated;

-- ============================================================
-- 4. get_institution_home_profiles_outstanding() -- the principal's
--    dashboard bucket. Sixth instance of the established pattern
--    (get_institution_restraints_needing_parent_call,
--    get_institution_withdrawn_attestations, 0134): institution-scoped,
--    non-authority caller sees nothing, live current state (status <>
--    'completed'), never an event log.
-- ============================================================

create or replace function public.get_institution_home_profiles_outstanding(
  p_institution_id uuid
)
returns table (
  id uuid,
  passport_id uuid,
  child_name text,
  recipient_name text,
  status text,
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
    coalesce(ru.raw_user_meta_data ->> 'full_name', ru.raw_app_meta_data ->> 'full_name') as recipient_name,
    r.status,
    r.created_at
  from public.passport_home_profile_requests r
  join public.passports p on p.id = r.passport_id
  join auth.users ru on ru.id = r.recipient_id
  where r.institution_id = p_institution_id
    and r.status in ('sent', 'in_progress')
    and public.institution_staff_has_current_standing(auth.uid(), p_institution_id)
  order by r.created_at asc;
$$;

grant execute on function public.get_institution_home_profiles_outstanding(uuid) to authenticated;
