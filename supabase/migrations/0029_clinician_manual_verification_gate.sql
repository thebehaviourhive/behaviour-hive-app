/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SECURITY FIX (C-03) -- closes a live-exploited hole: submit_clinician_
   verification() (migration 0026) unconditionally set verification_status
   = 'verified' and minted a working clinician_code for whoever called it,
   with zero server-side check of specialty or the two legal declarations.
   A disposable account called the RPC directly with specialty='gp' (one
   of the five "coming soon" specialties the UI is supposed to block) and
   both declarations set to false, and received a fully functional code
   usable to gain real clinical access to a child's record. The UI's own
   gating (specialty select, the locked-dashboard overlay) was correct --
   this was purely a backend enforcement gap, and it had to be fixed at
   the database layer since that's exactly how the exploit reached it
   (raw supabase.rpc(...), no browser involved).

   THE NEW MODEL, mirroring how institutions are verified today (manually,
   directly in the database, per migration 0009's own comments):

   1. submit_clinician_verification() now validates specialty ==
      'behavioural_psychologist', every credential field is non-empty, and
      BOTH declarations are true -- failing any of those raises an
      exception (the submission is refused outright, nothing is written)
      rather than ever landing in a state that looks reviewable. A
      passing submission sets verification_status = 'pending' and does
      NOT generate a clinician_code -- a pending clinician has no code to
      hand out yet.

   2. Two new SECURITY DEFINER functions, both with EXECUTE explicitly
      revoked from anon/authenticated/public and granted ONLY to
      service_role (called from the Supabase Dashboard SQL editor by a
      human reviewer, same as institution verification):
        - approve_clinician(clinician_email text): atomically moves a
          PENDING clinician to verified AND generates their code in the
          same statement, so the two can never diverge (no window where a
          clinician is "verified" with no code, or has a code while still
          pending).
        - reject_clinician(clinician_email text): moves a PENDING
          clinician to 'rejected'. No code is ever generated for a
          rejected clinician.

   3. Defense in depth, not just the front door: every clinician-scoped
      RLS policy and RPC that grants access to a child's data now
      independently re-checks verification_status = 'verified' via a new
      is_verified_clinician() helper, rather than trusting that a
      clinician_access row can only exist for a verified clinician (true
      today, but this makes each consumer correct on its own terms
      instead of depending on that single invariant holding forever). The
      one new gate that actually changes real behaviour is on
      clinician_access's own INSERT policy: a parent can no longer link a
      non-verified clinician's code to their child's passport at all --
      previously this was ONLY prevented because lookup_clinician_by_code
      (the code the parent-facing UI uses to find a clinician) already
      filtered to verified clinicians, but nothing stopped a direct
      clinician_access INSERT naming an arbitrary clinician_id.

   4. select_clinician_specialty() now resets verification_status back to
      'pending' if an EXISTING clinician's specialty is actually changed
      (not on the first-ever call, which already defaults to 'pending').
      Without this, a verified behavioural_psychologist could call
      select_clinician_specialty('gp') directly and remain "verified" for
      a specialty that was never actually reviewed -- the same shape of
      bug this whole migration exists to close, just reached through a
      different function.

   5. Migration safety: nothing here touches existing rows.
      verification_status keeps its two old values and gains a third
      ('rejected'); no UPDATE statement in this file touches any existing
      clinicians row. An already-verified clinician keeps their existing
      verification_status and clinician_code untouched -- there is no
      code path in this migration that resets or regenerates either for a
      row that isn't currently 'pending'. */

-- Explicit transaction: every statement below is transactional DDL, and
-- wrapping it means a failure anywhere rolls back the entire migration
-- instead of leaving is_verified_clinician (or anything else) partially
-- applied -- which is what produced the "function ... does not exist"
-- error on the first run attempt (some statement after it failed, but
-- without an explicit transaction the SQL editor state at that point was
-- ambiguous rather than cleanly rolled back).
begin;

-- ============================================================
-- 1. Widen verification_status to add 'rejected'
-- ============================================================

do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'public.clinicians'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%verification_status%';

  if v_constraint_name is not null then
    execute format('alter table public.clinicians drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table public.clinicians add constraint clinicians_verification_status_check
  check (verification_status in ('pending', 'verified', 'rejected'));

-- ============================================================
-- 2. is_verified_clinician() -- the one helper every access-granting
--    policy/function below re-checks against, so "must be verified" is
--    expressed the same way everywhere instead of re-derived per call site.
-- ============================================================

create or replace function public.is_verified_clinician(p_clinician_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.clinicians c
    where c.user_id = p_clinician_user_id
      and c.verification_status = 'verified'
  );
$$;

grant execute on function public.is_verified_clinician(uuid) to authenticated;

-- ============================================================
-- 3. select_clinician_specialty() -- reset to pending on a genuine
--    specialty change, so verified status can never quietly carry over
--    to a specialty that was never actually reviewed.
-- ============================================================

create or replace function public.select_clinician_specialty(p_specialty text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.clinicians (user_id, specialty)
  values (auth.uid(), p_specialty)
  on conflict (user_id) do update
    set specialty = excluded.specialty,
        verification_status = case
          when public.clinicians.specialty is distinct from excluded.specialty
          then 'pending'
          else public.clinicians.verification_status
        end;
end;
$$;

grant execute on function public.select_clinician_specialty(text) to authenticated;

-- ============================================================
-- 4. submit_clinician_verification() -- the actual fix. Validates
--    everything server-side and lands on 'pending', never 'verified',
--    never generates a code.
-- ============================================================

drop function if exists public.submit_clinician_verification(text, text, text, text, text, boolean, boolean);

create or replace function public.submit_clinician_verification(
  p_full_name text,
  p_psi_membership_number text,
  p_coru_registration_number text,
  p_bacb_certification_number text,
  p_government_id_number text,
  p_garda_vetting_declared boolean,
  p_professional_indemnity_declared boolean
)
returns table (verification_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinician_id uuid;
  v_specialty text;
  v_current_status text;
begin
  select id, specialty, clinicians.verification_status
  into v_clinician_id, v_specialty, v_current_status
  from public.clinicians
  where user_id = auth.uid();

  if v_clinician_id is null then
    raise exception 'No clinician profile found for this user. Select a specialty first.';
  end if;

  if v_current_status = 'verified' then
    raise exception 'This clinician profile is already verified.';
  end if;

  if v_specialty is distinct from 'behavioural_psychologist' then
    raise exception 'Verification is not yet available for this specialty.';
  end if;

  if coalesce(trim(p_full_name), '') = ''
    or coalesce(trim(p_psi_membership_number), '') = ''
    or coalesce(trim(p_coru_registration_number), '') = ''
    or coalesce(trim(p_bacb_certification_number), '') = ''
    or coalesce(trim(p_government_id_number), '') = '' then
    raise exception 'All credential fields are required.';
  end if;

  if not p_garda_vetting_declared or not p_professional_indemnity_declared then
    raise exception 'Both declarations must be confirmed.';
  end if;

  update public.clinicians
  set
    verification_status = 'pending',
    full_name = p_full_name,
    psi_membership_number = p_psi_membership_number,
    coru_registration_number = p_coru_registration_number,
    bacb_certification_number = p_bacb_certification_number,
    garda_vetting_declared = p_garda_vetting_declared,
    professional_indemnity_declared = p_professional_indemnity_declared
  where id = v_clinician_id;

  insert into public.clinician_government_id (clinician_id, government_id_number)
  values (v_clinician_id, p_government_id_number)
  on conflict (clinician_id) do update
    set government_id_number = excluded.government_id_number;

  return query select 'pending'::text;
end;
$$;

grant execute on function public.submit_clinician_verification(text, text, text, text, text, boolean, boolean) to authenticated;

-- ============================================================
-- 5. approve_clinician() / reject_clinician() -- the manual review gate.
--    service_role only: revoked from public (which would otherwise cover
--    every role by default) and from anon/authenticated explicitly, then
--    granted directly to service_role so that revoke can't accidentally
--    take service_role's access with it.
-- ============================================================

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
      clinician_code = v_code
  where id = v_clinician_id;

  return query select v_code;
end;
$$;

revoke all on function public.approve_clinician(text) from public;
revoke all on function public.approve_clinician(text) from authenticated, anon;
grant execute on function public.approve_clinician(text) to service_role;

create or replace function public.reject_clinician(clinician_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_clinician_id uuid;
  v_status text;
begin
  select u.id into v_user_id from auth.users u where u.email = clinician_email;
  if v_user_id is null then
    raise exception 'No user found with email %', clinician_email;
  end if;

  select id, clinicians.verification_status into v_clinician_id, v_status
  from public.clinicians
  where user_id = v_user_id;

  if v_clinician_id is null then
    raise exception 'No clinician profile found for %', clinician_email;
  end if;

  if v_status <> 'pending' then
    raise exception 'Clinician % is not pending verification (current status: %)', clinician_email, v_status;
  end if;

  update public.clinicians
  set verification_status = 'rejected'
  where id = v_clinician_id;
end;
$$;

revoke all on function public.reject_clinician(text) from public;
revoke all on function public.reject_clinician(text) from authenticated, anon;
grant execute on function public.reject_clinician(text) to service_role;

-- ============================================================
-- 6. Defense in depth -- every existing clinician-scoped policy/function
--    that grants access to a child's data now independently re-checks
--    is_verified_clinician(), not just clinician_access.is_active.
-- ============================================================

drop policy if exists "Parents can connect a clinician to their own passport" on public.clinician_access;
create policy "Parents can connect a clinician to their own passport"
  on public.clinician_access
  for insert
  to authenticated
  with check (
    public.owns_passport(passport_id)
    and public.is_verified_clinician(clinician_id)
  );

drop policy if exists "Clinicians can view their own active links" on public.clinician_access;
create policy "Clinicians can view their own active links"
  on public.clinician_access
  for select
  to authenticated
  using (
    clinician_id = auth.uid()
    and public.is_verified_clinician(clinician_id)
  );

drop policy if exists "Clinicians can insert abc logs for passports they access" on public.abc_logs;
create policy "Clinicians can insert abc logs for passports they access"
  on public.abc_logs
  for insert
  to authenticated
  with check (
    auth.uid() = logged_by
    and logged_by_role = 'clinician'
    and public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = abc_logs.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

drop policy if exists "Clinicians can view abc logs for passports they access" on public.abc_logs;
create policy "Clinicians can view abc logs for passports they access"
  on public.abc_logs
  for select
  to authenticated
  using (
    public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = abc_logs.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

drop policy if exists "Clinicians can insert activity for passports they access" on public.activity_log;
create policy "Clinicians can insert activity for passports they access"
  on public.activity_log
  for insert
  to authenticated
  with check (
    actor_id = auth.uid()
    and public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = activity_log.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

drop policy if exists "Clinicians can view activity for passports they access" on public.activity_log;
create policy "Clinicians can view activity for passports they access"
  on public.activity_log
  for select
  to authenticated
  using (
    public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = activity_log.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

drop policy if exists "Clinicians with active access can view a passport" on public.passports;
create policy "Clinicians with active access can view a passport"
  on public.passports
  for select
  to authenticated
  using (
    public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = passports.id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

drop policy if exists "Clinicians with active access can view section B" on public.passport_section_b;
create policy "Clinicians with active access can view section B"
  on public.passport_section_b
  for select
  to authenticated
  using (
    public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = passport_section_b.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

drop policy if exists "Clinicians with active access can view section C" on public.passport_section_c;
create policy "Clinicians with active access can view section C"
  on public.passport_section_c
  for select
  to authenticated
  using (
    public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = passport_section_c.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

drop policy if exists "Clinicians with active access can view section D" on public.passport_section_d;
create policy "Clinicians with active access can view section D"
  on public.passport_section_d
  for select
  to authenticated
  using (
    public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = passport_section_d.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

-- ============================================================
-- 7. Same re-check inside the SECURITY DEFINER read functions --
--    signatures/return shapes are unchanged, so plain CREATE OR REPLACE
--    is safe here (unlike submit_clinician_verification above).
-- ============================================================

create or replace function public.get_abc_logs(p_passport_id uuid)
returns table (
  id uuid,
  passport_id uuid,
  logged_by uuid,
  logged_by_name text,
  logged_by_role text,
  incident_date date,
  incident_time time,
  duration_minutes integer,
  intensity integer,
  antecedents text[],
  antecedent_other text,
  behaviours text[],
  behaviour_other text,
  consequences text[],
  consequence_other text,
  perceived_function text,
  general_notes text,
  is_draft boolean,
  sync_status text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    a.id, a.passport_id, a.logged_by,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as logged_by_name,
    a.logged_by_role, a.incident_date, a.incident_time, a.duration_minutes,
    a.intensity, a.antecedents, a.antecedent_other, a.behaviours, a.behaviour_other,
    a.consequences, a.consequence_other, a.perceived_function, a.general_notes,
    a.is_draft, a.sync_status, a.created_at
  from public.abc_logs a
  join auth.users u on u.id = a.logged_by
  where a.passport_id = p_passport_id
    and (
      public.owns_passport(p_passport_id)
      or exists (
        select 1 from public.passport_access pa
        where pa.passport_id = p_passport_id
          and pa.teacher_id = auth.uid()
          and pa.is_active = true
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
  order by a.incident_date desc, a.incident_time desc;
$$;

create or replace function public.get_clinician_activity_feed(
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  passport_id uuid,
  child_name text,
  event_type text,
  event_description text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select al.id, al.passport_id, p.child_name, al.event_type, al.event_description, al.created_at
  from public.activity_log al
  join public.passports p on p.id = al.passport_id
  join public.clinician_access ca on ca.passport_id = al.passport_id
  where ca.clinician_id = auth.uid()
    and ca.is_active = true
    and public.is_verified_clinician(auth.uid())
    and al.event_type in ('abc_logged', 'passport_updated', 'clinician_logged')
  order by al.created_at desc
  limit p_limit offset p_offset;
$$;

create or replace function public.get_passport_clinicians(p_passport_id uuid)
returns table (
  clinician_id uuid,
  full_name text,
  specialty text,
  last_review_date date,
  linked_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select ca.clinician_id, c.full_name, c.specialty, ca.last_review_date, ca.linked_at
  from public.clinician_access ca
  join public.clinicians c on c.user_id = ca.clinician_id
  where ca.passport_id = p_passport_id
    and ca.is_active = true
    and c.verification_status = 'verified'
    and public.owns_passport(p_passport_id);
$$;

create or replace function public.get_clinician_passports()
returns table (
  passport_id uuid,
  child_name text,
  date_of_birth date,
  diagnoses text[],
  diagnosis_other text,
  last_review_date date,
  linked_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.child_name, p.date_of_birth, p.diagnoses, p.diagnosis_other, ca.last_review_date, ca.linked_at
  from public.clinician_access ca
  join public.passports p on p.id = ca.passport_id
  where ca.clinician_id = auth.uid()
    and ca.is_active = true
    and public.is_verified_clinician(auth.uid())
  order by ca.linked_at desc;
$$;

-- get_passport_team's clinician branch (added in 0027) also needs the
-- verified re-check -- its left join to clinicians means an unverified
-- (or since-removed) clinician's row would otherwise still surface here.
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
    pa.teacher_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    coalesce(s.role, 'class_teacher') as role,
    pa.linked_at
  from public.passport_access pa
  join auth.users u on u.id = pa.teacher_id
  left join public.institution_staff s
    on s.user_id = pa.teacher_id and s.institution_id = pa.institution_id
  where pa.passport_id = p_passport_id
    and pa.is_active = true
    and public.owns_passport(p_passport_id)

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
    and coalesce(c.verification_status, '') = 'verified'
    and public.owns_passport(p_passport_id);
$$;

-- lookup_clinician_by_code (0026) already filters verification_status =
-- 'verified' -- no change needed, included here only as a comment so
-- this migration's own audit trail confirms every clinician-facing
-- surface was actually checked, not just the ones that needed editing.

commit;
