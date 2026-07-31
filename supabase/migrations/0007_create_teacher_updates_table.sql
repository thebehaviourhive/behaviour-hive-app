-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Each row is one end-of-day update event (an audit trail, like
-- morning_checkins and consents), submitted by a teacher.
--
-- RLS note: a teacher_update has two legitimate readers — the teacher who
-- submitted it (teacher_id = auth.uid()), and the parent whose child's
-- passport it belongs to (looked up via passport_id -> passports.user_id).
-- Without the second clause, parents could never read the row that the
-- parent dashboard's afternoon state is built from, so "own records" is
-- read here as "records belonging to a passport I own" for parents.

create table if not exists public.teacher_updates (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  teacher_id uuid not null references auth.users (id) on delete cascade,
  settled_state text
    check (settled_state in ('settled', 'unsettled', 'dysregulated')),
  energy_level integer
    check (energy_level between 1 and 5),
  flags text[],
  heads_up text,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists teacher_updates_teacher_id_idx on public.teacher_updates (teacher_id);
create index if not exists teacher_updates_passport_id_idx on public.teacher_updates (passport_id);

alter table public.teacher_updates enable row level security;

create policy "Teachers can insert their own submitted updates"
  on public.teacher_updates
  for insert
  to authenticated
  with check (auth.uid() = teacher_id);

create policy "Teachers and the child's parent can view an update"
  on public.teacher_updates
  for select
  to authenticated
  using (
    auth.uid() = teacher_id
    or exists (
      select 1
      from public.passports p
      where p.id = teacher_updates.passport_id
        and p.user_id = auth.uid()
    )
  );
