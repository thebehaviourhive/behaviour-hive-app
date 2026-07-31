-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- One evolving row per parent's passport (unique on user_id, like
-- passports, passport_section_b and passport_section_c), not an audit log.

create table if not exists public.passport_section_d (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  before_behaviour text[],
  before_behaviour_other text,
  during_distress text[],
  during_distress_other text,
  after_distress text[],
  after_distress_other text,
  sensory_seeks text[],
  sensory_avoids text[],
  sensory_avoids_other text,
  section_d_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists passport_section_d_user_id_idx on public.passport_section_d (user_id);
create index if not exists passport_section_d_passport_id_idx on public.passport_section_d (passport_id);

-- Reuses the set_updated_at() function created by the passports migration.
drop trigger if exists set_passport_section_d_updated_at on public.passport_section_d;
create trigger set_passport_section_d_updated_at
  before update on public.passport_section_d
  for each row
  execute function public.set_updated_at();

alter table public.passport_section_d enable row level security;

create policy "Users can view their own section D record"
  on public.passport_section_d
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their own section D record"
  on public.passport_section_d
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own section D record"
  on public.passport_section_d
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
