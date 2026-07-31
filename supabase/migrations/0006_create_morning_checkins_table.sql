-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Each row is one check-in event (an audit trail, not a mutable "current
-- status" row) — the app determines "already checked in today" by
-- querying for a row where checked_in_at falls on today's date, the same
-- way consents is an append-only log rather than a single evolving row.

create table if not exists public.morning_checkins (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists morning_checkins_user_id_idx on public.morning_checkins (user_id);
create index if not exists morning_checkins_passport_id_idx on public.morning_checkins (passport_id);

alter table public.morning_checkins enable row level security;

create policy "Users can insert their own check-ins"
  on public.morning_checkins
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can view their own check-ins"
  on public.morning_checkins
  for select
  to authenticated
  using (auth.uid() = user_id);
