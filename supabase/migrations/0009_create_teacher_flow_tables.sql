-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Data model for the teacher flow: institutions (created by an
-- institution_admin), institution_staff (links a user to an institution —
-- both admins and class teachers get a row here), passport_access (a
-- teacher's granted view of one child's passport), and strategy_ledger
-- (teacher-submitted wins/observations/updates against a passport).
--
-- Institution creation and joining are both self-service, gated purely by
-- the role stored in the user's JWT (auth.jwt() -> user_metadata ->> role)
-- -- there is no in-app approval workflow yet, so an institution's status
-- starts and stays 'pending' until Behaviour Hive staff verify it directly
-- in the database (update institutions.status to 'verified').

create table if not exists public.institutions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  institution_code text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'suspended')),
  created_at timestamptz not null default now()
);

create table if not exists public.institution_staff (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'class_teacher',
  created_at timestamptz not null default now()
);

create index if not exists institution_staff_institution_id_idx on public.institution_staff (institution_id);
create index if not exists institution_staff_user_id_idx on public.institution_staff (user_id);

-- Both tables exist before either's RLS policies are created, since the
-- institutions select policy below reads institution_staff.

alter table public.institutions enable row level security;

create policy "Institution admins can create an institution"
  on public.institutions
  for insert
  to authenticated
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'institution_admin');

create policy "Staff can view their own institution"
  on public.institutions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = institutions.id
        and s.user_id = auth.uid()
    )
  );

alter table public.institution_staff enable row level security;

-- A user may only ever claim a staff link for themselves; which real-world
-- institution they attach to is controlled entirely by application logic
-- (the admin creates a brand new institution row in the same request the
-- teacher looks an existing one up by institution_code).
create policy "Institution admins and class teachers can self-link"
  on public.institution_staff
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and (auth.jwt() -> 'user_metadata' ->> 'role') in ('institution_admin', 'class_teacher')
  );

create policy "Users can view their own staff link"
  on public.institution_staff
  for select
  to authenticated
  using (auth.uid() = user_id);

create table if not exists public.passport_access (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  teacher_id uuid not null references auth.users (id) on delete cascade,
  institution_id uuid not null references public.institutions (id) on delete cascade,
  access_code text not null,
  granted_at timestamptz not null default now()
);

create index if not exists passport_access_teacher_id_idx on public.passport_access (teacher_id);
create index if not exists passport_access_passport_id_idx on public.passport_access (passport_id);

alter table public.passport_access enable row level security;

-- No insert policy yet: the Add Child flow is a placeholder in this build
-- (see brief), so nothing client-side is allowed to create these rows
-- until the real access-code verification logic is wired up. Rows for
-- testing are seeded directly via the service role in the meantime.

create policy "Teachers can view their own granted access"
  on public.passport_access
  for select
  to authenticated
  using (auth.uid() = teacher_id);

create policy "Parents can view access granted on their own passport"
  on public.passport_access
  for select
  to authenticated
  using (
    exists (
      select 1 from public.passports p
      where p.id = passport_access.passport_id
        and p.user_id = auth.uid()
    )
  );

create table if not exists public.strategy_ledger (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  submitted_by uuid not null references auth.users (id) on delete cascade,
  entry_type text not null
    check (entry_type in ('win', 'observation', 'update')),
  description text not null,
  environment text not null default 'school'
    check (environment in ('school', 'other')),
  created_at timestamptz not null default now()
);

create index if not exists strategy_ledger_passport_id_idx on public.strategy_ledger (passport_id);

alter table public.strategy_ledger enable row level security;

create policy "Teachers can insert ledger entries for passports they can access"
  on public.strategy_ledger
  for insert
  to authenticated
  with check (
    auth.uid() = submitted_by
    and exists (
      select 1 from public.passport_access pa
      where pa.passport_id = strategy_ledger.passport_id
        and pa.teacher_id = auth.uid()
    )
  );

create policy "Teachers and the child's parent can view ledger entries"
  on public.strategy_ledger
  for select
  to authenticated
  using (
    auth.uid() = submitted_by
    or exists (
      select 1 from public.passports p
      where p.id = strategy_ledger.passport_id
        and p.user_id = auth.uid()
    )
    or exists (
      select 1 from public.passport_access pa
      where pa.passport_id = strategy_ledger.passport_id
        and pa.teacher_id = auth.uid()
    )
  );

-- A teacher with granted access needs to read the underlying passport data
-- to render the classroom profile and morning RAG status. These are
-- *additional* permissive select policies alongside each table's existing
-- "the parent who owns this row" policy — Postgres ORs them together, so
-- parents keep exactly the access they already had.

create policy "Teachers with granted access can view a passport"
  on public.passports
  for select
  to authenticated
  using (
    exists (
      select 1 from public.passport_access pa
      where pa.passport_id = passports.id
        and pa.teacher_id = auth.uid()
    )
  );

create policy "Teachers with granted access can view section B"
  on public.passport_section_b
  for select
  to authenticated
  using (
    exists (
      select 1 from public.passport_access pa
      where pa.passport_id = passport_section_b.passport_id
        and pa.teacher_id = auth.uid()
    )
  );

create policy "Teachers with granted access can view section C"
  on public.passport_section_c
  for select
  to authenticated
  using (
    exists (
      select 1 from public.passport_access pa
      where pa.passport_id = passport_section_c.passport_id
        and pa.teacher_id = auth.uid()
    )
  );

create policy "Teachers with granted access can view section D"
  on public.passport_section_d
  for select
  to authenticated
  using (
    exists (
      select 1 from public.passport_access pa
      where pa.passport_id = passport_section_d.passport_id
        and pa.teacher_id = auth.uid()
    )
  );

create policy "Teachers with granted access can view morning check-ins"
  on public.morning_checkins
  for select
  to authenticated
  using (
    exists (
      select 1 from public.passport_access pa
      where pa.passport_id = morning_checkins.passport_id
        and pa.teacher_id = auth.uid()
    )
  );

-- Tighten teacher_updates: a teacher could previously insert an update
-- against ANY passport_id just by claiming teacher_id = themselves, with
-- nothing checking they actually have access to that child. Now that
-- passport_access exists as the real access-control mechanism, require it.
drop policy if exists "Teachers can insert their own submitted updates" on public.teacher_updates;

create policy "Teachers can insert updates for passports they can access"
  on public.teacher_updates
  for insert
  to authenticated
  with check (
    auth.uid() = teacher_id
    and exists (
      select 1 from public.passport_access pa
      where pa.passport_id = teacher_updates.passport_id
        and pa.teacher_id = auth.uid()
    )
  );
