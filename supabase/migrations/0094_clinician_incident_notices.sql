-- Phase 4, piece 4 (part 2): the clinician notification. Third
-- audience-specific notices table, matching school_notices (staff) and
-- parent_incident_notices (parent) -- deliberately NOT unified into one
-- table with an audience column. The three RLS shapes check three
-- unrelated relationships (institution-role/incident-ownership,
-- passport-ownership, clinician grant) with nothing shared between them
-- to drift out of sync; unifying would only relocate the same three
-- predicates into nullable, audience-conditional columns and OR-branches
-- of one policy, which is harder to read and easier to query wrong (miss
-- an audience filter once and a dashboard silently shows the wrong
-- audience's rows -- a dedicated table makes that structurally
-- impossible instead of a discipline).
--
-- Single stage only, matching the spec: "at teacher sign-off... also not
-- before" -- no stamp-time equivalent for clinicians. Dormant-account
-- handling doesn't apply here (a clinician account isn't the same
-- "may never have claimed it" population as a parent passport).

create table public.clinician_incident_notices (
  id uuid primary key default gen_random_uuid(),
  notice_type text not null check (notice_type in ('incident_summary_ready')),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  passport_id uuid not null references public.passports (id) on delete cascade,
  institution_id uuid not null references public.institutions (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index clinician_incident_notices_passport_id_idx on public.clinician_incident_notices (passport_id);
create index clinician_incident_notices_incident_id_idx on public.clinician_incident_notices (incident_id);

alter table public.clinician_incident_notices enable row level security;

-- Any actively-linked verified clinician for this passport -- not a
-- single owner the way a parent is, so (unlike parent_incident_notices)
-- one row can legitimately be visible to more than one clinician if the
-- passport ever has more than one active grant.
create policy "Actively-linked verified clinicians can view their case's incident notices"
  on public.clinician_incident_notices for select to authenticated
  using (
    public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = clinician_incident_notices.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

-- No INSERT/UPDATE/DELETE policy for authenticated -- system-written
-- only, via the trigger below.

create or replace function public.notify_clinicians_of_incident_signoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child record;
begin
  if new.teacher_signed_at is not null and old.teacher_signed_at is null then
    for v_child in
      select ic.passport_id from public.incident_children ic where ic.incident_id = new.id
    loop
      -- Only insert when there's genuinely someone to notify -- a
      -- passport with no active clinician gets no row at all, not an
      -- invisible orphaned one.
      if exists (
        select 1 from public.clinician_access ca
        where ca.passport_id = v_child.passport_id and ca.is_active = true
      ) then
        insert into public.clinician_incident_notices (notice_type, incident_id, passport_id, institution_id)
        values ('incident_summary_ready', new.id, v_child.passport_id, new.institution_id);
      end if;
    end loop;
  end if;
  return new;
end;
$$;

create trigger notify_clinicians_on_teacher_signoff
  after update on public.incidents
  for each row
  execute function public.notify_clinicians_of_incident_signoff();
