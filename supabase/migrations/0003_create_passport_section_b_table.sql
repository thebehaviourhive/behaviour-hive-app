-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- One evolving row per parent's passport (unique on user_id, like
-- passports itself), not an audit log — the 3 section B pages upsert
-- into the same row as they're saved.

create table if not exists public.passport_section_b (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  okay_signals text[],
  okay_signals_other text,
  hard_signals text[],
  hard_signals_other text,
  hard_triggers text[],
  hard_triggers_other text,
  section_b_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists passport_section_b_user_id_idx on public.passport_section_b (user_id);
create index if not exists passport_section_b_passport_id_idx on public.passport_section_b (passport_id);

-- Reuses the set_updated_at() function created by the passports migration.
drop trigger if exists set_passport_section_b_updated_at on public.passport_section_b;
create trigger set_passport_section_b_updated_at
  before update on public.passport_section_b
  for each row
  execute function public.set_updated_at();

alter table public.passport_section_b enable row level security;

create policy "Users can view their own section B record"
  on public.passport_section_b
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their own section B record"
  on public.passport_section_b
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own section B record"
  on public.passport_section_b
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
