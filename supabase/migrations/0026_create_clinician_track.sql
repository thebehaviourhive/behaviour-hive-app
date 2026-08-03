/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   Clinician Track — database layer. Strictly additive: no existing table's
   NOT NULL constraints, columns, or policies are altered or removed. Every
   change here either creates something new or adds an extra OR'd
   permissive policy alongside what already exists for parents/teachers.

   ARCHITECTURE DECISION — a parallel clinician_access table, not a reused
   passport_access: the brief says "reuse or extend the existing passport
   access pattern... mirror it," but passport_access.teacher_id and
   .institution_id are NOT NULL and every existing policy assumes that
   shape. Clinicians connect directly via a clinician code (no institution,
   no two-factor approval step) -- forcing that into passport_access would
   mean loosening NOT NULL constraints a table full of existing teacher
   rows and policies already depends on. A new table with the same shape
   and spirit (passport_id + actor + is_active + linked_at) mirrors the
   pattern without touching the existing table at all.

   SIX JUDGMENT CALLS made beyond the brief's literal five bullets, flagged
   here rather than silently decided:

   1. Clinician code format: the brief says both "unique 6-character
      alphanumeric code" and "format CL-XXXX" -- these don't fully agree
      (CL- is a fixed 2-letter prefix, not derived like passport codes
      are). Resolved as: literal "CL-" prefix + 4 random hex characters
      (uppercase), so "CL-7A3F" -- 6 alphanumeric characters (C, L, 7, A,
      3, F) if you don't count the hyphen, matching both readings as
      closely as they can be reconciled.

   2. Credential fields (full_name, PSI/CORU/BACB numbers, the two
      declaration booleans) live directly on clinicians, readable by the
      owning clinician -- only the government ID is singled out in the
      brief as sensitive. It gets its own table with NO select policy at
      all, rather than a column-level revoke on clinicians. We got burned
      once already (abc_logs.clinical_notes, migrations 0020/0021) by a
      column-level REVOKE doing nothing against a broader table-level
      GRANT; a separate table sidesteps that failure mode entirely rather
      than relying on getting the revoke/grant ordering right again.

   3. verification_status, clinician_code, and every credential field are
      NEVER directly client-writable -- there's no UPDATE policy that
      touches them at all. They only change through
      submit_clinician_verification() (SECURITY DEFINER), so a clinician
      can't just PATCH their own row to verification_status = 'verified'
      without ever submitting the form. The one thing a clinician CAN
      update directly is review_cadence_days (a genuine user setting),
      enforced via a column-level GRANT the same way the clinical_notes
      fix uses column-level SELECT grants.

   4. last_review_date is bumped automatically (via trigger) whenever a
      clinician logs an ABC entry against that passport -- logging IS the
      review action in this MVP, since the brief describes no separate
      "mark reviewed" UI. It defaults to the linked_at date so a
      freshly-connected case isn't immediately flagged as overdue.

   5. clinician_logged is added as its own activity_log event type,
      distinct from abc_logged (which already fires for every role,
      unchanged). The brief's own Step 4 filter lists both abc_logged AND
      clinician_logged as separately-included types, and Critical
      Constraint #1 says to wrap the shared ABC logger rather than alter
      it -- so the plan for the UI step is: ABCLogger.tsx stays byte-for-
      byte unchanged (still logs abc_logged for every role, as it always
      has), and a clinician-side wrapper additionally logs a
      clinician_logged entry after a successful submission. This
      migration only needs to make clinician_logged a legal value.

   6. Clinicians get read access to passports, passport_section_b/c/d
      (parity for the reused teacher passport-view component, Step 5) and
      to abc_logs + activity_log (read + write, needed for the dashboard
      stats, activity feed, and Add Log flow). They do NOT get
      morning_checkins access -- that's parent/teacher daily
      communication, not a clinical record, and nothing in this brief's
      UI needs it. If Step 5 reuses the teacher passport view unchanged
      and that component queries morning_checkins, it'll just come back
      empty for a clinician (RLS silently filters, no error) -- a
      deliberate, narrower default that can be widened later if needed. */

-- ============================================================
-- 1. clinicians -- one row per clinician user
-- ============================================================

create table if not exists public.clinicians (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  specialty text not null
    check (specialty in (
      'clinical_psychologist',
      'behavioural_psychologist',
      'educational_psychologist',
      'gp',
      'slt',
      'ot'
    )),
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified')),
  clinician_code text unique,
  review_cadence_days integer not null default 30
    check (review_cadence_days in (14, 30, 60, 90)),
  full_name text,
  psi_membership_number text,
  coru_registration_number text,
  bacb_certification_number text,
  garda_vetting_declared boolean not null default false,
  professional_indemnity_declared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_clinicians_updated_at on public.clinicians;
create trigger set_clinicians_updated_at
  before update on public.clinicians
  for each row
  execute function public.set_updated_at();

alter table public.clinicians enable row level security;

create policy "Clinicians can view their own profile"
  on public.clinicians
  for select
  to authenticated
  using (user_id = auth.uid());

-- Column-level grant: a clinician can update review_cadence_days directly
-- (a real setting), but nothing else on this row -- verification_status,
-- clinician_code, and every credential field are function-guarded only.
revoke update on public.clinicians from authenticated;
grant update (review_cadence_days) on public.clinicians to authenticated;

create policy "Clinicians can update their own review cadence"
  on public.clinicians
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- 2. clinician_government_id -- write-once, never selectable back
-- ============================================================

create table if not exists public.clinician_government_id (
  id uuid primary key default gen_random_uuid(),
  clinician_id uuid not null unique references public.clinicians (id) on delete cascade,
  government_id_number text not null,
  created_at timestamptz not null default now()
);

alter table public.clinician_government_id enable row level security;

-- Deliberately no SELECT, UPDATE, or DELETE policy for authenticated at
-- all -- with RLS enabled and no matching policy, PostgREST can never
-- return this data through any client role, full stop. Only service_role
-- (bypasses RLS) can read it, for the one-time manual verification the
-- brief describes -- same as how institutions.status is verified
-- directly in the database today (migration 0009).
create policy "Clinicians can insert their own government ID once"
  on public.clinician_government_id
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.clinicians c
      where c.id = clinician_id and c.user_id = auth.uid()
    )
  );

-- ============================================================
-- 3. clinician_access -- mirrors passport_access, parallel table
-- ============================================================

create table if not exists public.clinician_access (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  clinician_id uuid not null references auth.users (id) on delete cascade,
  is_active boolean not null default true,
  linked_at timestamptz not null default now(),
  last_review_date date not null default current_date,
  created_at timestamptz not null default now(),
  unique (passport_id, clinician_id)
);

create index if not exists clinician_access_passport_id_idx on public.clinician_access (passport_id);
create index if not exists clinician_access_clinician_id_idx on public.clinician_access (clinician_id);

alter table public.clinician_access enable row level security;

-- Connecting a clinician is parent-initiated (parent enters the
-- clinician's code), the mirror image of the teacher flow (teacher
-- enters the passport code) -- so this follows the SAME shape as the
-- parent's existing institution-approval insert in ShareBottomSheet.tsx,
-- not the teacher's passport_access insert policy.
create policy "Parents can connect a clinician to their own passport"
  on public.clinician_access
  for insert
  to authenticated
  with check (public.owns_passport(passport_id));

create policy "Parents can revoke clinician access on their own passport"
  on public.clinician_access
  for update
  to authenticated
  using (public.owns_passport(passport_id))
  with check (public.owns_passport(passport_id));

create policy "Parents can view clinicians connected to their own passport"
  on public.clinician_access
  for select
  to authenticated
  using (public.owns_passport(passport_id));

create policy "Clinicians can view their own active links"
  on public.clinician_access
  for select
  to authenticated
  using (clinician_id = auth.uid());

-- ============================================================
-- 4. Clinician code lookup -- mirrors lookup_passport_by_code (0015)
-- ============================================================

create or replace function public.lookup_clinician_by_code(code text)
returns table (
  id uuid,
  user_id uuid,
  full_name text,
  specialty text
)
language sql
security definer
set search_path = public
stable
as $$
  select c.id, c.user_id, c.full_name, c.specialty
  from public.clinicians c
  where c.clinician_code = code
    and c.verification_status = 'verified';
$$;

grant execute on function public.lookup_clinician_by_code(text) to authenticated;

-- ============================================================
-- 5. Specialty selection + verification submission
-- ============================================================

-- Called right after the secondary specialty-select screen, for every
-- specialty (including the five "coming soon" ones) -- creates the
-- pending clinicians row so a returning user lands back on the same
-- locked/coming-soon state rather than being asked again.
create or replace function public.select_clinician_specialty(p_specialty text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.clinicians (user_id, specialty)
  values (auth.uid(), p_specialty)
  on conflict (user_id) do update set specialty = excluded.specialty;
$$;

grant execute on function public.select_clinician_specialty(text) to authenticated;

-- Called on verification form submit (Behavioural Psychologist only, in
-- this build). Auto-approves for the MVP trial, generates the clinician
-- code the first time this is called for a given clinician, and writes
-- the government ID into the write-once restricted table.
create or replace function public.submit_clinician_verification(
  p_full_name text,
  p_psi_membership_number text,
  p_coru_registration_number text,
  p_bacb_certification_number text,
  p_government_id_number text,
  p_garda_vetting_declared boolean,
  p_professional_indemnity_declared boolean
)
returns table (code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinician_id uuid;
  v_code text;
begin
  update public.clinicians
  set
    verification_status = 'verified',
    full_name = p_full_name,
    psi_membership_number = p_psi_membership_number,
    coru_registration_number = p_coru_registration_number,
    bacb_certification_number = p_bacb_certification_number,
    garda_vetting_declared = p_garda_vetting_declared,
    professional_indemnity_declared = p_professional_indemnity_declared
  where user_id = auth.uid()
  returning clinicians.id, clinicians.clinician_code into v_clinician_id, v_code;

  if v_clinician_id is null then
    raise exception 'No clinician profile found for this user. Select a specialty first.';
  end if;

  if v_code is null then
    loop
      v_code := 'CL-' || upper(substr(md5(random()::text), 1, 4));
      exit when not exists (select 1 from public.clinicians where clinician_code = v_code);
    end loop;
    update public.clinicians set clinician_code = v_code where id = v_clinician_id;
  end if;

  insert into public.clinician_government_id (clinician_id, government_id_number)
  values (v_clinician_id, p_government_id_number)
  on conflict (clinician_id) do nothing;

  return query select v_code;
end;
$$;

grant execute on function public.submit_clinician_verification(text, text, text, text, text, boolean, boolean) to authenticated;

-- ============================================================
-- 6. abc_logs -- additive clinician policies + review-date trigger
-- ============================================================

create policy "Clinicians can insert abc logs for passports they access"
  on public.abc_logs
  for insert
  to authenticated
  with check (
    auth.uid() = logged_by
    and logged_by_role = 'clinician'
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = abc_logs.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

create policy "Clinicians can view abc logs for passports they access"
  on public.abc_logs
  for select
  to authenticated
  using (
    exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = abc_logs.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

-- Additive OR branch only -- the existing parent/teacher branches in
-- get_abc_logs() (migration 0019) are untouched, so their behaviour is
-- identical to before this migration for those two roles.
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
      or exists (
        select 1 from public.clinician_access ca
        where ca.passport_id = p_passport_id
          and ca.clinician_id = auth.uid()
          and ca.is_active = true
      )
    )
  order by a.incident_date desc, a.incident_time desc;
$$;

grant execute on function public.get_abc_logs(uuid) to authenticated;

-- Judgment call #4: logging IS the review action in this MVP.
create or replace function public.update_clinician_last_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.logged_by_role = 'clinician' then
    update public.clinician_access
    set last_review_date = current_date
    where passport_id = new.passport_id
      and clinician_id = new.logged_by
      and is_active = true;
  end if;
  return new;
end;
$$;

drop trigger if exists bump_clinician_last_review on public.abc_logs;
create trigger bump_clinician_last_review
  after insert on public.abc_logs
  for each row
  execute function public.update_clinician_last_review();

-- ============================================================
-- 7. activity_log -- new event type + additive clinician policies
-- ============================================================

alter table public.activity_log drop constraint if exists activity_log_event_type_check;
alter table public.activity_log add constraint activity_log_event_type_check
  check (event_type in (
    'passport_updated',
    'morning_checkin',
    'afternoon_update',
    'abc_logged',
    'passport_shared',
    'team_linked',
    'clinician_logged'
  ));

create policy "Clinicians can insert activity for passports they access"
  on public.activity_log
  for insert
  to authenticated
  with check (
    actor_id = auth.uid()
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = activity_log.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

create policy "Clinicians can view activity for passports they access"
  on public.activity_log
  for select
  to authenticated
  using (
    exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = activity_log.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

-- Aggregated, cross-passport feed for the clinical dashboard, with the
-- INCLUDE/EXCLUDE filter enforced server-side rather than trusted to the
-- client to get right every time.
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
    and al.event_type in ('abc_logged', 'passport_updated', 'clinician_logged')
  order by al.created_at desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.get_clinician_activity_feed(integer, integer) to authenticated;

-- ============================================================
-- 8. passports + sections -- additive clinician read policies
-- ============================================================

create policy "Clinicians with active access can view a passport"
  on public.passports
  for select
  to authenticated
  using (
    exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = passports.id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

create policy "Clinicians with active access can view section B"
  on public.passport_section_b
  for select
  to authenticated
  using (
    exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = passport_section_b.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

create policy "Clinicians with active access can view section C"
  on public.passport_section_c
  for select
  to authenticated
  using (
    exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = passport_section_c.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

create policy "Clinicians with active access can view section D"
  on public.passport_section_d
  for select
  to authenticated
  using (
    exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = passport_section_d.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

-- ============================================================
-- 9. Convenience read functions for the Clinical Team list and
--    the clinician's own passport list
-- ============================================================

-- Feeds Step 3's "Clinical Team" section in the parent's Manage Access
-- view -- mirrors get_passport_team()'s exact shape/pattern (0023).
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
    and public.owns_passport(p_passport_id);
$$;

grant execute on function public.get_passport_clinicians(uuid) to authenticated;

-- Feeds Step 5's passport list (/clinician/passports).
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
  order by ca.linked_at desc;
$$;

grant execute on function public.get_clinician_passports() to authenticated;
