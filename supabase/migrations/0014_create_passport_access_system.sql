/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   Two-factor passport access: a parent approves an institution
   (passport_institution_links.approved_by_parent), and a teacher
   separately proves they have the child's passport_code before a
   passport_access row can exist. Both factors are required.

   Three additions beyond what was asked for, needed for the feature to
   actually work end to end -- flagged clearly rather than silently
   added:

   1. passport_access has no INSERT or UPDATE policy yet (the Add Child
      flow was a placeholder until now, and revoke needs to flip
      is_active). The insert policy re-checks the FULL authorization
      chain at the database level, not just in application code --
      matching institution_staff membership AND an approved link must
      both exist, mirroring the app's own checks 1-4 as defense in
      depth. A unique (passport_id, teacher_id) constraint backs up
      app-level check 4 ("you already have access") at the DB level too.
   2. passport_institution_links needs a parent-facing SELECT policy
      too (not just the teacher one asked for) -- otherwise a parent
      could never see their own "Who can see this passport" list.
   3. Both new passport_institution_links policies reuse the existing
      owns_passport() SECURITY DEFINER function (from migration 0010)
      rather than a fresh correlated subquery against passports, since
      passports' own RLS already queries passport_access and a naive
      subquery here risks reintroducing the same infinite-recursion bug
      already hit and fixed once this build. */

alter table public.passports
  add column if not exists passport_code text unique,
  add column if not exists passport_code_active boolean not null default true;

create table if not exists public.passport_institution_links (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  institution_id uuid not null references public.institutions (id) on delete cascade,
  approved_by_parent boolean not null default false,
  parent_approved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists passport_institution_links_passport_id_idx on public.passport_institution_links (passport_id);
create index if not exists passport_institution_links_institution_id_idx on public.passport_institution_links (institution_id);

alter table public.passport_institution_links enable row level security;

create policy "Parents can insert links for their own passport"
  on public.passport_institution_links
  for insert
  to authenticated
  with check (public.owns_passport(passport_id));

create policy "Parents can update links for their own passport"
  on public.passport_institution_links
  for update
  to authenticated
  using (public.owns_passport(passport_id))
  with check (public.owns_passport(passport_id));

create policy "Parents can view links for their own passport"
  on public.passport_institution_links
  for select
  to authenticated
  using (public.owns_passport(passport_id));

create policy "Teachers can view links for their institution"
  on public.passport_institution_links
  for select
  to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = passport_institution_links.institution_id
        and s.user_id = auth.uid()
    )
  );

alter table public.passport_access
  add column if not exists is_active boolean not null default true,
  add column if not exists linked_at timestamptz not null default now();

alter table public.passport_access
  add constraint passport_access_passport_teacher_unique unique (passport_id, teacher_id);

create policy "Teachers can insert access for approved, matching institutions"
  on public.passport_access
  for insert
  to authenticated
  with check (
    auth.uid() = teacher_id
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = passport_access.institution_id
        and s.user_id = auth.uid()
    )
    and exists (
      select 1 from public.passport_institution_links pil
      where pil.passport_id = passport_access.passport_id
        and pil.institution_id = passport_access.institution_id
        and pil.approved_by_parent = true
    )
  );

create policy "Parents can revoke access on their own passport"
  on public.passport_access
  for update
  to authenticated
  using (public.owns_passport(passport_access.passport_id))
  with check (public.owns_passport(passport_access.passport_id));
