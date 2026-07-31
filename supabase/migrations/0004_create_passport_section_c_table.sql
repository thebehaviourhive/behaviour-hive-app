-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- One evolving row per parent's passport (unique on user_id, like
-- passports and passport_section_b), not an audit log.

create table if not exists public.passport_section_c (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  communication_methods text[],
  communication_methods_other text,
  shows_happy text,
  shows_anxious text,
  phrases_to_avoid text,
  section_c_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists passport_section_c_user_id_idx on public.passport_section_c (user_id);
create index if not exists passport_section_c_passport_id_idx on public.passport_section_c (passport_id);

-- Reuses the set_updated_at() function created by the passports migration.
drop trigger if exists set_passport_section_c_updated_at on public.passport_section_c;
create trigger set_passport_section_c_updated_at
  before update on public.passport_section_c
  for each row
  execute function public.set_updated_at();

alter table public.passport_section_c enable row level security;

create policy "Users can view their own section C record"
  on public.passport_section_c
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their own section C record"
  on public.passport_section_c
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own section C record"
  on public.passport_section_c
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
