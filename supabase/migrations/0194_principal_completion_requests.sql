-- Stage 4, item 2: a principal can send passport and medical completion
-- requests, as a class teacher can. Confirmed before building (and
-- reported to Daniel before touching anything): has_child_access() --
-- has_class_teacher_access() OR has_sna_access() -- has no principal
-- branch in either primitive (live definitions: 0130, 0133 re-read in
-- full). Group A's own fix (0188) pointed request_passport_completion()
-- and request_passport_home_profile() at has_child_access() correctly,
-- but a principal was never going to pass that gate for any child,
-- regardless of institution.
--
-- WHY THIS IS INLINE, NOT A has_child_access() BRANCH -- read this
-- before "fixing" it into the chokepoint. This session found SIX
-- hand-rolled copies of has_child_access()'s own branch logic that had
-- drifted out of sync with it (0188's own Group B) specifically because
-- widening or bypassing the chokepoint is the easy move and nothing
-- stops a seventh. has_child_access() is not read-only plumbing -- it
-- backs 45+ policy references across this schema, INCLUDING WRITE
-- policies (e.g. strategy_feedback's own INSERT gate uses the narrower
-- has_class_teacher_access() specifically). A principal's authority
-- here is INSTITUTIONAL -- any enrolled child at their own school --
-- not class-derived the way a teacher's or SNA's is; folding that into
-- has_child_access() would silently grant every other caller built on
-- it (RLS policies, other RPCs) an institution-wide principal branch
-- none of them were audited for. The established pattern for exactly
-- this shape -- a principal-specific OR-branch, inline, at the one call
-- site that needs it -- is already shipped in get_abc_logs() (0190) and
-- get_passport_clinical_content() (0160); this matches it.
--
-- Scoped to the SAME p_institution_id the caller already passes and is
-- checked as an active staff member of (institution_staff_has_current_
-- standing), joined against passport_institution_links -- "enrolled at
-- their own institution", the same scoping 0160's own principal branch
-- uses, not a broader institution-agnostic principal check.
--
-- Same signatures, same return type -- CREATE OR REPLACE is sufficient,
-- no DROP needed.
create or replace function public.request_passport_completion(
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
    and not exists (
      select 1 from public.passport_completion_requests r
      where r.passport_id = p_passport_id
        and r.recipient_id = g.user_id
        and r.target_section = p_target_section
    );

  get diagnostics v_created = row_count;

  if v_created = 0 then
    raise exception 'This has already been requested from every current guardian on this passport.';
  end if;

  return v_created;
end;
$$;

grant execute on function public.request_passport_completion(uuid, uuid, text) to authenticated;

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

-- get_passport_completion_requests() -- the read side ("who was asked"
-- for this passport), rendered by PassportCompletionSection.tsx.
-- Without this, a principal could send a NEW request (the write-side
-- fix above) while the same component silently showed "not yet
-- requested" even when someone already had -- owns_passport() or
-- has_child_access() was the only gate, no principal branch. Same
-- reasoning as the two RPCs above for why this is an inline OR-branch,
-- not a has_child_access() widening. p_institution_id isn't a
-- parameter here (matches get_child_passport_profile_for_principal()'s
-- own shape, 0160) -- scoped via passport_institution_links to ANY
-- institution this principal currently staffs that this child is
-- linked to, same "enrolled at their own institution" rule expressed
-- the way this function's own signature allows it to be.
--
-- Same signature, same return type -- CREATE OR REPLACE is sufficient.
create or replace function public.get_passport_completion_requests(p_passport_id uuid)
returns table (
  id uuid,
  recipient_id uuid,
  recipient_name text,
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
    r.recipient_id,
    coalesce(ru.raw_user_meta_data ->> 'full_name', ru.raw_app_meta_data ->> 'full_name') as recipient_name,
    r.target_section,
    r.created_at
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
