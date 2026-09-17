-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 5 Stage 6, Step 1 -- verification_route, and consolidating raw
-- verification_status = 'verified' checks onto is_verified_clinician().
--
-- WHY THIS COLUMN, NOT JUST REUSING 'verified': Daniel's own decision.
-- Reusing the literal string keeps all fourteen-plus existing gated
-- call sites working unchanged, which is the thing that actually
-- matters -- but "verified" alone can no longer answer "verified HOW."
-- An independent practitioner is verified because Behaviour Hive
-- reviewed real credentials (PSI/CORU/BACB numbers, Garda vetting,
-- professional indemnity -- 0029's own gate). A clinic practitioner
-- (0222) is verified because their director approved their membership
-- -- nobody checked a credential, because there is no credential to
-- check; the clinic itself already went through Behaviour Hive's own
-- manual institution-verification gate. For a clinical record system
-- where a practitioner's own standing may genuinely be asked about,
-- that question should be answerable directly from the data, not
-- reconstructed by inferring it from whether an institution_staff row
-- happens to exist. Nullable -- a pending or rejected clinician hasn't
-- been verified via any route yet, so there's nothing to record.
--
-- BACKFILL, not a guess: every clinicians row that exists before this
-- migration went through submit_clinician_verification() +
-- approve_clinician() -- the ONLY path that has ever existed until
-- 0222 adds the second one. Backfilling every currently-'verified' row
-- to 'behaviour_hive' is a fact, not an inference.
--
-- THE SIX RAW CHECKS: found by an explicit sweep, per Daniel's own
-- instruction -- "raw copies of a check that has a function are the
-- same shape as the six hand-rolled access checks, and if there are
-- several they should go through the function whether or not anything
-- else changes." lookup_clinician_by_code() (0036), connect_clinician()
-- and grant_clinician_access() (0123), get_passport_team() (0188),
-- get_passport_clinicians() (0124), and get_institution_clinicians()
-- (0151) each hand-rolled `c.verification_status = 'verified'` directly
-- instead of calling is_verified_clinician() -- consolidated here, same
-- signatures throughout, CREATE OR REPLACE is sufficient for all six.
-- bulk_grant_clinician_access()'s own two raw checks are fixed in 0224,
-- alongside the signature change that migration makes for the same
-- function -- not duplicated here.

alter table public.clinicians
  add column if not exists verification_route text
    check (verification_route is null or verification_route in ('behaviour_hive', 'organisation'));

update public.clinicians
set verification_route = 'behaviour_hive'
where verification_status = 'verified' and verification_route is null;

-- approve_clinician() -- same signature, same behaviour, now also
-- records the route. service_role only, unchanged from 0029.
create or replace function public.approve_clinician(clinician_email text)
returns table (clinician_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_clinician_id uuid;
  v_status text;
  v_code text;
begin
  select u.id into v_user_id from auth.users u where u.email = clinician_email;
  if v_user_id is null then
    raise exception 'No user found with email %', clinician_email;
  end if;

  select id, clinicians.verification_status, clinicians.clinician_code
  into v_clinician_id, v_status, v_code
  from public.clinicians
  where user_id = v_user_id;

  if v_clinician_id is null then
    raise exception 'No clinician profile found for %', clinician_email;
  end if;

  if v_status <> 'pending' then
    raise exception 'Clinician % is not pending verification (current status: %)', clinician_email, v_status;
  end if;

  if v_code is null then
    loop
      v_code := 'CL-' || upper(substr(md5(random()::text), 1, 4));
      exit when not exists (select 1 from public.clinicians where clinician_code = v_code);
    end loop;
  end if;

  update public.clinicians
  set verification_status = 'verified',
      verification_route = 'behaviour_hive',
      clinician_code = v_code
  where id = v_clinician_id;

  return query select v_code;
end;
$$;

revoke all on function public.approve_clinician(text) from public;
revoke all on function public.approve_clinician(text) from authenticated, anon;
grant execute on function public.approve_clinician(text) to service_role;

-- lookup_clinician_by_code() -- same signature.
create or replace function public.lookup_clinician_by_code(code text)
returns table (
  id uuid,
  user_id uuid,
  full_name text,
  specialty text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_recent_failures integer;
  v_id uuid;
  v_clinician_user_id uuid;
  v_full_name text;
  v_specialty text;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  select count(*) into v_recent_failures
  from public.code_lookup_attempts
  where public.code_lookup_attempts.user_id = v_uid
    and lookup_type = 'clinician'
    and attempted_at > now() - interval '1 hour';

  if v_recent_failures >= 10 then
    raise exception 'Too many failed lookups. Please try again later.';
  end if;

  select c.id, c.user_id, c.full_name, c.specialty
  into v_id, v_clinician_user_id, v_full_name, v_specialty
  from public.clinicians c
  where c.clinician_code = code
    and public.is_verified_clinician(c.user_id);

  if v_id is null then
    insert into public.code_lookup_attempts (user_id, lookup_type) values (v_uid, 'clinician');
    raise exception 'We couldn''t find a clinician with that code. Please check with them and try again.';
  end if;

  return query select v_id, v_clinician_user_id, v_full_name, v_specialty;
end;
$$;

grant execute on function public.lookup_clinician_by_code(text) to authenticated;

-- connect_clinician() -- same signature.
create or replace function public.connect_clinician(
  p_passport_id uuid,
  p_clinician_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinician_id uuid;
  v_existing public.clinician_access;
  v_row_id uuid;
begin
  if not public.owns_passport(p_passport_id) then
    raise exception 'Only this child''s own parent or guardian can connect a clinician.';
  end if;

  select c.user_id into v_clinician_id
  from public.clinicians c
  where c.clinician_code = p_clinician_code
    and public.is_verified_clinician(c.user_id);

  if v_clinician_id is null then
    raise exception 'We couldn''t find a clinician with that code. Please check with them and try again.';
  end if;

  select * into v_existing
  from public.clinician_access
  where passport_id = p_passport_id and clinician_id = v_clinician_id;

  if found then
    if v_existing.engaged_by = 'institution' then
      raise exception 'This clinician is already connected to your child through their school and cannot be reconnected here. Contact the school if you''d like this changed.';
    end if;

    if v_existing.is_active then
      raise exception 'This clinician already has active access to this child.';
    end if;

    update public.clinician_access
    set is_active = true,
        linked_at = now(),
        granted_by = auth.uid(),
        revoked_at = null,
        revoked_by = null,
        revocation_reason = null
    where id = v_existing.id
    returning id into v_row_id;
    return v_row_id;
  end if;

  insert into public.clinician_access (passport_id, clinician_id, engaged_by, granted_by)
  values (p_passport_id, v_clinician_id, 'parent', auth.uid())
  returning id into v_row_id;

  return v_row_id;
end;
$$;

grant execute on function public.connect_clinician(uuid, text) to authenticated;

-- grant_clinician_access() -- same signature.
create or replace function public.grant_clinician_access(
  p_institution_id uuid,
  p_passport_id uuid,
  p_clinician_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinician_id uuid;
  v_existing public.clinician_access;
  v_row_id uuid;
begin
  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and inst.status = 'verified'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'Only an active, verified principal can connect a clinician for their school.';
  end if;

  if not exists (
    select 1 from public.passport_institution_links pil
    where pil.passport_id = p_passport_id and pil.institution_id = p_institution_id
  ) then
    raise exception 'This child has no link to your institution.';
  end if;

  select c.user_id into v_clinician_id
  from public.clinicians c
  where c.clinician_code = p_clinician_code
    and public.is_verified_clinician(c.user_id);

  if v_clinician_id is null then
    raise exception 'We couldn''t find a clinician with that code. Please check with them and try again.';
  end if;

  select * into v_existing
  from public.clinician_access
  where passport_id = p_passport_id and clinician_id = v_clinician_id;

  if found then
    if v_existing.engaged_by = 'parent' then
      raise exception 'This clinician is already engaged by this child''s parent or guardian. A school cannot take over a parent''s own clinical engagement -- if your school needs its own involvement, connect a different clinician, or ask the family to make the introduction.';
    end if;
    if v_existing.engaged_by_institution_id <> p_institution_id then
      raise exception 'This clinician was engaged by a different school for this child and cannot be reactivated here.';
    end if;

    if v_existing.is_active then
      raise exception 'This clinician already has active access to this child.';
    end if;

    update public.clinician_access
    set is_active = true,
        linked_at = now(),
        granted_by = auth.uid(),
        revoked_at = null,
        revoked_by = null,
        revocation_reason = null
    where id = v_existing.id
    returning id into v_row_id;
    return v_row_id;
  end if;

  insert into public.clinician_access (passport_id, clinician_id, engaged_by, engaged_by_institution_id, granted_by)
  values (p_passport_id, v_clinician_id, 'institution', p_institution_id, auth.uid())
  returning id into v_row_id;

  return v_row_id;
end;
$$;

grant execute on function public.grant_clinician_access(uuid, uuid, text) to authenticated;

-- get_passport_team() -- same signature.
create or replace function public.get_passport_team(p_passport_id uuid)
returns table (
  teacher_id uuid,
  full_name text,
  role text,
  linked_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.user_id as teacher_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    s.role,
    coalesce(pa.linked_at, ct.started_at, csa.started_at, ca2.started_at, ta.created_at) as linked_at
  from public.institution_staff s
  join public.passport_institution_links pil on pil.institution_id = s.institution_id
  join auth.users u on u.id = s.user_id
  left join public.passport_access pa
    on pa.passport_id = p_passport_id and pa.teacher_id = s.user_id and pa.is_active = true
  left join public.class_children cc on cc.passport_id = p_passport_id and cc.ended_at is null
  left join public.class_teachers ct
    on ct.class_id = cc.class_id and ct.user_id = s.user_id and ct.ended_at is null
  left join public.class_sna_assignments csa
    on csa.class_id = cc.class_id and csa.user_id = s.user_id and csa.ended_at is null
  left join public.child_assignments ca2
    on ca2.passport_id = p_passport_id and ca2.user_id = s.user_id and ca2.ended_at is null
  left join public.temporary_access ta
    on ta.granted_to = s.user_id
    and ta.institution_id = s.institution_id
    and ta.class_id = cc.class_id
    and ta.revoked_at is null
  where pil.passport_id = p_passport_id
    and s.deactivated_at is null
    and s.approved_at is not null
    and public.owns_passport(p_passport_id)
    and public.has_child_access(s.user_id, p_passport_id)

  union all

  select
    ca.clinician_id as teacher_id,
    coalesce(c.full_name, u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    'clinician' as role,
    ca.linked_at
  from public.clinician_access ca
  join auth.users u on u.id = ca.clinician_id
  left join public.clinicians c on c.user_id = ca.clinician_id
  where ca.passport_id = p_passport_id
    and ca.is_active = true
    and public.is_verified_clinician(ca.clinician_id)
    and public.owns_passport(p_passport_id);
$$;

grant execute on function public.get_passport_team(uuid) to authenticated;

-- get_passport_clinicians() -- same signature.
create or replace function public.get_passport_clinicians(p_passport_id uuid)
returns table (
  clinician_access_id uuid,
  clinician_id uuid,
  full_name text,
  specialty text,
  last_review_date date,
  linked_at timestamptz,
  engaged_by text,
  engaged_by_institution_id uuid,
  engaged_by_institution_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    ca.id, ca.clinician_id, c.full_name, c.specialty, ca.last_review_date, ca.linked_at,
    ca.engaged_by, ca.engaged_by_institution_id, inst.name
  from public.clinician_access ca
  join public.clinicians c on c.user_id = ca.clinician_id
  left join public.institutions inst on inst.id = ca.engaged_by_institution_id
  where ca.passport_id = p_passport_id
    and ca.is_active = true
    and public.is_verified_clinician(ca.clinician_id)
    and (
      public.owns_passport(p_passport_id)
      or exists (
        select 1 from public.passport_institution_links pil
        join public.institution_staff s on s.institution_id = pil.institution_id
        where pil.passport_id = p_passport_id
          and s.user_id = auth.uid()
          and s.role = 'principal'
          and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
      )
    );
$$;

grant execute on function public.get_passport_clinicians(uuid) to authenticated;

-- get_institution_clinicians() -- same signature.
create or replace function public.get_institution_clinicians(p_institution_id uuid)
returns table (
  clinician_id uuid,
  full_name text,
  specialty text,
  covered_child_count integer
)
language sql
security definer
set search_path = public
stable
as $$
  select
    c.user_id as clinician_id,
    c.full_name,
    c.specialty,
    count(*)::integer as covered_child_count
  from public.clinician_access ca
  join public.clinicians c on c.user_id = ca.clinician_id
  where ca.engaged_by = 'institution'
    and ca.engaged_by_institution_id = p_institution_id
    and ca.is_active = true
    and public.is_verified_clinician(c.user_id)
    and exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and inst.status = 'verified'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  group by c.user_id, c.full_name, c.specialty
  order by c.full_name;
$$;

grant execute on function public.get_institution_clinicians(uuid) to authenticated;
