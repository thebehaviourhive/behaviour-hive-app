-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 3, Stage 3 -- CORRECTED. 0141/0142's question set (six freeform
-- fields: what works at home, sleep, food, sensory needs at home,
-- history before this school, what previous settings got wrong) came
-- from an example list in the PRD that was never approved as a spec,
-- and duplicated content Sections A-D already collect. Dropped entirely,
-- table and all three RPCs plus the response-reader.
--
-- The real Stage 3: the request is a PROMPT pointing at the EXISTING
-- Section A wizard, not a new form. No response content, no status
-- column -- "outstanding" derives from passports.section_a_complete,
-- the passport's own field, not a second source of truth. This table
-- is now nothing more than a ledger of who was asked and when; nothing
-- ever updates a row after it's inserted, so there's no UPDATE policy,
-- no trigger, no completed_at.

drop function if exists public.get_passport_home_profile_responses(uuid);
drop function if exists public.get_institution_home_profiles_outstanding(uuid);
drop function if exists public.get_my_passport_profile_requests();
drop function if exists public.request_passport_home_profile(uuid, uuid);
drop table if exists public.passport_home_profile_requests;
drop function if exists public.set_home_profile_completed_at();

-- ============================================================
-- 1. passport_completion_requests -- a ledger, not a form.
-- ============================================================

create table public.passport_completion_requests (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  institution_id uuid not null references public.institutions (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (passport_id, recipient_id)
);

create index passport_completion_requests_passport_id_idx
  on public.passport_completion_requests (passport_id);
create index passport_completion_requests_recipient_id_idx
  on public.passport_completion_requests (recipient_id);
create index passport_completion_requests_institution_id_idx
  on public.passport_completion_requests (institution_id);

alter table public.passport_completion_requests enable row level security;

-- No INSERT policy -- same reasoning as 0141: issuing means enumerating
-- current guardians, checking institution standing, and skipping
-- guardians who already have a row. request_passport_completion() does
-- this as SECURITY DEFINER. No UPDATE policy at all -- nothing ever
-- changes on a row after it's inserted; there is no status to write.

create policy "Guardians can view completion requests on their own passport"
  on public.passport_completion_requests
  for select
  to authenticated
  using (public.owns_passport(passport_completion_requests.passport_id));

create policy "Staff with child access can view completion requests"
  on public.passport_completion_requests
  for select
  to authenticated
  using (public.has_child_access(auth.uid(), passport_completion_requests.passport_id));

-- ============================================================
-- 2. request_passport_completion() -- the issuing RPC. Same gate as
--    before: active institution standing AND an active passport_access
--    grant. One request per current guardian without an existing row;
--    guardians who already have one are skipped, not duplicated.
-- ============================================================

create or replace function public.request_passport_completion(
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
    raise exception 'Only an active member of staff at this school can request this.';
  end if;

  if not exists (
    select 1 from public.passport_access pa
    where pa.passport_id = p_passport_id
      and pa.institution_id = p_institution_id
      and pa.teacher_id = auth.uid()
      and pa.is_active = true
  ) then
    raise exception 'You need access to this child''s passport before you can request this.';
  end if;

  if not exists (
    select 1 from public.passport_guardians g where g.passport_id = p_passport_id
  ) then
    raise exception 'This child has no guardian to notify yet.';
  end if;

  insert into public.passport_completion_requests (
    passport_id, institution_id, requested_by, recipient_id
  )
  select p_passport_id, p_institution_id, auth.uid(), g.user_id
  from public.passport_guardians g
  where g.passport_id = p_passport_id
    and not exists (
      select 1 from public.passport_completion_requests r
      where r.passport_id = p_passport_id
        and r.recipient_id = g.user_id
    );

  get diagnostics v_created = row_count;

  if v_created = 0 then
    raise exception 'This has already been requested from every current guardian on this passport.';
  end if;

  return v_created;
end;
$$;

grant execute on function public.request_passport_completion(uuid, uuid) to authenticated;

-- ============================================================
-- 3. get_my_passport_completion_requests() -- the parent's own feed.
--    "Outstanding" derives entirely from passports.section_a_complete
--    -- no status column, nothing to keep in sync. A request stops
--    appearing here the moment the guardian completes Section A through
--    the ordinary wizard, whether or not they ever open this prompt at
--    all (e.g. they navigated there some other way). That's correct:
--    the prompt's only job is pointing at Section A, not tracking
--    whether it was clicked.
-- ============================================================

create or replace function public.get_my_passport_completion_requests()
returns table (
  id uuid,
  passport_id uuid,
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
    p.child_name,
    i.name as institution_name,
    r.created_at
  from public.passport_completion_requests r
  join public.passports p on p.id = r.passport_id
  join public.institutions i on i.id = r.institution_id
  where r.recipient_id = auth.uid()
    and coalesce(p.section_a_complete, false) = false
  order by r.created_at asc;
$$;

grant execute on function public.get_my_passport_completion_requests() to authenticated;

-- ============================================================
-- 4. get_institution_passport_completions_outstanding() -- the
--    principal's dashboard bucket. Same live-state discipline as every
--    other bucket: derives from passports.section_a_complete directly,
--    never a status column that could drift from it.
-- ============================================================

create or replace function public.get_institution_passport_completions_outstanding(
  p_institution_id uuid
)
returns table (
  id uuid,
  passport_id uuid,
  child_name text,
  recipient_name text,
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
    r.created_at
  from public.passport_completion_requests r
  join public.passports p on p.id = r.passport_id
  join auth.users ru on ru.id = r.recipient_id
  where r.institution_id = p_institution_id
    and coalesce(p.section_a_complete, false) = false
    and public.institution_staff_has_current_standing(auth.uid(), p_institution_id)
  order by r.created_at asc;
$$;

grant execute on function public.get_institution_passport_completions_outstanding(uuid) to authenticated;

-- ============================================================
-- 5. get_passport_completion_requests() -- the staff-facing "who was
--    asked" list for one passport. A plain client select against
--    passport_completion_requests can't resolve recipient names (same
--    reason as every other RPC in this family); this is that
--    resolution, scoped to a single passport instead of an institution.
-- ============================================================

create or replace function public.get_passport_completion_requests(p_passport_id uuid)
returns table (
  id uuid,
  recipient_id uuid,
  recipient_name text,
  created_at timestamptz
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
    r.created_at
  from public.passport_completion_requests r
  join auth.users ru on ru.id = r.recipient_id
  where r.passport_id = p_passport_id
    and (
      public.owns_passport(p_passport_id)
      or public.has_child_access(auth.uid(), p_passport_id)
    )
  order by r.created_at asc;
$$;

grant execute on function public.get_passport_completion_requests(uuid) to authenticated;
