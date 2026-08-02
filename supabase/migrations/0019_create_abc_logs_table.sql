/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   ABC Incident Logger data model. logged_by_role already includes
   'clinician' in its check constraint even though no clinician-facing
   code exists yet -- adding a value to a text check constraint later
   would need its own migration, whereas including it now costs nothing
   and means the column never needs to change when that role is built.
   clinical_notes is likewise present and nullable but genuinely unused
   by this build; nothing here writes to it.

   incident_time defaults to localtime rather than the literal
   current_time the brief mentions -- current_time returns "time with
   time zone" in Postgres, which doesn't match a plain "time" column;
   localtime returns the timezone-less variant that actually matches.

   RLS note on clinical_notes: a table's RLS policies are row-level only
   -- there is no way for a SELECT policy to hide one column while
   allowing the rest of a row through, and every app role here shares the
   same underlying Postgres "authenticated" role, so column-level GRANTs
   can't distinguish parent from teacher either. The base table's SELECT
   policies below (needed regardless, so direct queries and future admin
   tooling are still correctly scoped) grant row-level access as asked,
   but the app itself will read through get_abc_logs() -- a SECURITY
   DEFINER function whose RETURNS TABLE simply omits clinical_notes
   entirely. That omission is structural: no query shape a teacher (or
   parent -- clinical_notes isn't meant for them either, just not called
   out explicitly) can send through that function will ever get the
   column back, which is what "enforce at query level" actually requires
   here. */

create table if not exists public.abc_logs (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  logged_by uuid not null references auth.users (id) on delete cascade,
  logged_by_role text not null
    check (logged_by_role in ('parent', 'class_teacher', 'clinician')),
  incident_date date not null default current_date,
  incident_time time not null default localtime,
  duration_minutes integer,
  intensity integer not null check (intensity between 1 and 5),
  antecedents text[] not null,
  antecedent_other text,
  behaviours text[] not null,
  behaviour_other text,
  consequences text[] not null,
  consequence_other text,
  perceived_function text
    check (perceived_function in ('escape', 'attention', 'tangible', 'sensory')),
  general_notes text,
  clinical_notes text,
  is_draft boolean not null default false,
  sync_status text not null default 'synced'
    check (sync_status in ('synced', 'pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists abc_logs_passport_id_idx on public.abc_logs (passport_id);
create index if not exists abc_logs_logged_by_idx on public.abc_logs (logged_by);

alter table public.abc_logs enable row level security;

-- INSERT: each role may only ever insert as themselves, tagged with
-- their own role, for a passport they're actually connected to. Reuses
-- owns_passport() (migration 0010) and the same passport_access
-- is_active check already established for teacher-side reads elsewhere
-- (e.g. migration 0018), rather than inventing a new authorization shape.

create policy "Parents can insert their own abc logs"
  on public.abc_logs
  for insert
  to authenticated
  with check (
    auth.uid() = logged_by
    and logged_by_role = 'parent'
    and public.owns_passport(passport_id)
  );

create policy "Teachers can insert abc logs for passports they access"
  on public.abc_logs
  for insert
  to authenticated
  with check (
    auth.uid() = logged_by
    and logged_by_role = 'class_teacher'
    and exists (
      select 1 from public.passport_access pa
      where pa.passport_id = abc_logs.passport_id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
    )
  );

-- SELECT: row-level only, per the note above -- clinical_notes hiding is
-- enforced separately by get_abc_logs(), not by these policies.

create policy "Parents can view abc logs for their own passport"
  on public.abc_logs
  for select
  to authenticated
  using (public.owns_passport(passport_id));

create policy "Teachers can view abc logs for passports they access"
  on public.abc_logs
  for select
  to authenticated
  using (
    exists (
      select 1 from public.passport_access pa
      where pa.passport_id = abc_logs.passport_id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
    )
  );

-- UPDATE/DELETE: nothing in this build edits or deletes a log yet, but
-- "no role can update or delete another user's log" is a real
-- requirement independent of whether a UI exists for it today -- scoped
-- to the row's own author so it's correctly locked down the moment any
-- edit/delete feature is added later, without a follow-up migration.

create policy "Users can update their own abc logs"
  on public.abc_logs
  for update
  to authenticated
  using (auth.uid() = logged_by)
  with check (auth.uid() = logged_by);

create policy "Users can delete their own abc logs"
  on public.abc_logs
  for delete
  to authenticated
  using (auth.uid() = logged_by);

-- Read path used by the app: resolves the reporter's display name
-- (auth.users isn't directly queryable by authenticated, same as
-- get_teacher_name in migration 0018) and structurally excludes
-- clinical_notes. Authorization mirrors the SELECT policies above rather
-- than relying on RLS, since SECURITY DEFINER bypasses it.

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
    )
  order by a.incident_date desc, a.incident_time desc;
$$;

grant execute on function public.get_abc_logs(uuid) to authenticated;
