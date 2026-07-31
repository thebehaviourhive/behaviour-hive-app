-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- One row per parent's child passport (unique on user_id, so the app can
-- upsert as sections are saved) — not an audit log like consents.

create table if not exists public.passports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  child_name text,
  date_of_birth date,
  school text,
  important_people text,
  diagnoses text[],
  diagnosis_other text,
  section_a_complete boolean not null default false,
  passport_status text not null default 'not_started'
    check (passport_status in ('not_started', 'in_progress', 'complete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists passports_user_id_idx on public.passports (user_id);

-- Keep updated_at current on every change, regardless of what the app remembers to set.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_passports_updated_at on public.passports;
create trigger set_passports_updated_at
  before update on public.passports
  for each row
  execute function public.set_updated_at();

alter table public.passports enable row level security;

create policy "Users can view their own passport"
  on public.passports
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their own passport"
  on public.passports
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own passport"
  on public.passports
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
