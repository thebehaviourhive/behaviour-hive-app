-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Each row is one consent event (an audit trail, not a mutable "current
-- status" row) — if consent terms change later, a new row with a higher
-- consent_version is inserted rather than overwriting history.

create table if not exists public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  consent_version integer not null,
  marketing_accepted boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists consents_user_id_idx on public.consents (user_id);

alter table public.consents enable row level security;

create policy "Users can insert their own consent records"
  on public.consents
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can view their own consent records"
  on public.consents
  for select
  to authenticated
  using (auth.uid() = user_id);
