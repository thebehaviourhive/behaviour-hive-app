/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SCHOOL INCIDENT LOG -- Phase 1: schema, RLS, RPCs.

   New, separate module. Does not touch abc_logs, abc_logger, or anything
   ABC-related -- confirmed by grep before writing this, zero references.

   Incorporates all seven decisions from the approval round:
     1. No approved_by_parent gate on school-staff/principal access --
        this is the school's own record, not a parent-consented feature.
     2. 'principal' added to the self-service role set (app-code change,
        not this file) with the accepted first-come-claims-the-school gap
        noted; every principal-institution-wide read additionally
        requires institutions.status = 'verified'.
     3. institution_admin and principal are two separate
        institution_staff.role values.
     4. Owning-teacher access is incident-scoped, not passport-scoped.
     5. Stage-one child selection draws from the institution roster, not
        the creator's own passport_access -- incident_children.added_by
        records who added each child.
     6. No staff-side per-child redaction -- once a staff member can see
        an incident at all, they see all of it.
     7. free_text_name staff are non-blocking; exports render them
        explicitly as unattested rather than omitting them (Phase 6).

   Plus both build notes: a generalised school_notices table (notice_type
   discriminator, not Calm-specific, calm_escalation_notices untouched),
   and a principal report that's a plain filtered list (this file's
   get_institution_incidents), not aggregation/charts.

   A handful of judgment calls where the brief didn't fully specify the
   DB shape -- flagged here and again in chat, not buried:
     J1. recorded_at is a real, distinct column from created_at, even
         though both default to now() and neither is ever touched again
         after insert. The brief names recorded_at as its own field
         separately from created_by; collapsing it into created_at would
         match today's behaviour but silently lose the distinction if
         this table's insert timing ever changes.
     J2. incident_actions is a genuine join table (action_type_id ->
         incident_action_types.id), not a text[] array like
         antecedents/behaviours on abc_logs. Two reasons: the brief's own
         wording calls it "a join to the actions vocabulary" while
         explicitly writing reason_codes[]/disengagement_codes[]/
         result_codes[] with array brackets a few lines later -- a
         deliberate distinction, not an accident -- and a real FK lets
         "was CPI selected" be a robust boolean lookup
         (incident_action_types.is_restraint) instead of fragile string
         matching against a seeded label that a school could theoretically
         edit.
     J3. Post-teacher-signoff immutability on incidents is enforced by a
         trigger that rejects ANY change to a substantive column once
         teacher_signed_at is set (principal_signed_at/by and updated_at
         are the only exceptions), not just an RLS USING clause the way
         fba_reports does it. fba_reports only ever needs "nobody can
         write once locked, full stop" -- this table has a real
         in-between state (teacher signed, principal countersign still
         pending) where a very narrow write must still succeed. RLS alone
         can gate WHICH ROWS are writable, not WHICH COLUMNS change
         within an allowed row, so a trigger is the belt to RLS's braces
         here specifically because "legal document, courtroom" is a
         higher bar than FBA's own stakes.
     J4. incident_amendments INSERT is restricted to the owning teacher,
         the creator, or an institution principal, or a verified
         clinician with active caseload access to an involved child --
         not every staff member who can merely view the incident. The
         brief doesn't name who may add an amendment; this is the
         narrowest reading consistent with "amendments, not a free-for-
         all correction channel." Flagged for override if wrong.
     J5. Who may create the stage-one stamp: class_teacher, sna, or
         principal, all institution-scoped. The brief's "any staff member
         present" most concretely names teacher/SNA; principal is
         included because nothing excludes them and a principal is
         certainly "staff present" in a real building. Flagged in case
         you want principal excluded from stamping.

   Section order below: vocabulary tables and seed data first (nothing
   else references them but they're referenced BY the incident tables),
   then institution_staff's principal addition, then incidents and its
   direct children in the order the paper form itself follows, then the
   shared can_view_incident() helper, then school_notices, then the two
   RPCs (parent redacted view, principal institution-wide list), then
   grants. */


-- =====================================================================
-- PART 1 -- VOCABULARY TABLES
-- =====================================================================
-- Every checkbox list on the paper form becomes a seeded table row, not
-- a hardcoded array in application code -- editing a label or adding an
-- option is a database update, never a deploy. institution_id nullable:
-- null means a global default row available to every school; a real
-- institution_id means that school's own addition/override. Only
-- incident_locations gets a school-facing editing UI in this build (per
-- the brief); the others are still schema-ready for the same treatment
-- later without another migration, and can already be edited today by a
-- direct database update if a school needs a wording change before that
-- UI exists.
--
-- is_active (not delete) is how a school "removes" an option -- hard-
-- deleting a vocabulary row a historic incident already references would
-- either cascade-delete real incident data or leave a dangling
-- reference; deactivating just stops it appearing as a choice for NEW
-- incidents while every existing one keeps rendering exactly what was
-- selected at the time, unchanged.

create table public.incident_action_types (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions (id) on delete cascade,
  value text not null,
  sort_order integer not null default 0,
  -- True for exactly the "Physical restraint (CPI)" row. The app uses
  -- this flag, not a string match against the label, to decide whether
  -- to reveal the restrictive-practice section -- see judgment call J2.
  is_restraint boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.incident_recovery_types (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions (id) on delete cascade,
  value text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.cpi_reason_types (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions (id) on delete cascade,
  value text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.cpi_disengagement_types (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions (id) on delete cascade,
  value text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.cpi_result_types (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions (id) on delete cascade,
  value text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.incident_injury_types (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions (id) on delete cascade,
  value text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.incident_locations (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions (id) on delete cascade,
  value text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Seed data -- verbatim from the paper form, global defaults
-- (institution_id null) so every school starts with the same set.

insert into public.incident_action_types (value, sort_order, is_restraint) values
  ('Gently blocked further attempts', 10, false),
  ('Redirected', 20, false),
  ('Encouraged student to safer area', 30, false),
  ('Removed peers from area', 40, false),
  ('Removed high risk items from area', 50, false),
  ('Called additional staff to assist', 60, false),
  ('Gave space', 70, false),
  ('Co regulation', 80, false),
  ('Calming toolbox', 90, false),
  ('Encouraged deep breathing', 100, false),
  ('Gave choice', 110, false),
  ('Behavioural momentum', 120, false),
  ('Used visuals', 130, false),
  ('Reinforced appropriate responses', 140, false),
  ('Followed BSP', 150, false),
  ('Followed through with instruction', 160, false),
  ('Removed aversive stimulus', 170, false),
  ('Reduced demand', 180, false),
  ('Reminded of school rules', 190, false),
  ('Physical restraint (CPI)', 200, true),
  ('Other', 210, false);

insert into public.incident_recovery_types (value, sort_order) values
  ('Not possible at this time', 10),
  ('chat', 20),
  ('high 5', 30),
  ('hug', 40),
  ('choice', 50),
  ('pairing', 60),
  ('reinforcement', 70),
  ('co-regulation', 80),
  ('Other', 90);

insert into public.cpi_reason_types (value, sort_order) values
  ('Cont Aggression', 10),
  ('Cont. Self-Injury', 20),
  ('Elope unsafe area', 30),
  ('Bite/Hair pull', 40);

insert into public.cpi_disengagement_types (value, sort_order) values
  ('Hold/Stabilise', 10),
  ('Push/Pull', 20),
  ('Lever', 30),
  ('Wrist', 40),
  ('Clothing', 50),
  ('Hair', 60),
  ('Neck', 70),
  ('Body', 80),
  ('Bite', 90),
  ('Turn away', 100);

insert into public.cpi_result_types (value, sort_order) values
  ('Risk reduced', 10),
  ('Break down', 20),
  ('Tension reduction', 30);

insert into public.incident_injury_types (value, sort_order) values
  ('Cut', 10),
  ('Bite (skin broken)', 20),
  ('Scratch', 30),
  ('Swelling', 40),
  ('Redness', 50),
  ('Bruising', 60),
  ('Other', 70);

insert into public.incident_locations (value, sort_order) values
  ('Classroom', 10),
  ('Sensory room', 20),
  ('Corridor', 30),
  ('Yard', 40),
  ('Hall', 50),
  ('Bus', 60),
  ('Off site', 70),
  ('Other', 80);

-- RLS: read is open to any authenticated user for global rows (null
-- institution_id), or that specific institution's own staff for an
-- override row. Write is restricted to that institution's own principal
-- (the only role this build actually needs school-side vocabulary edits
-- for -- Locations). Global (institution_id null) rows are never
-- writable by a school; only Behaviour Hive staff edit those directly.

alter table public.incident_action_types enable row level security;
alter table public.incident_recovery_types enable row level security;
alter table public.cpi_reason_types enable row level security;
alter table public.cpi_disengagement_types enable row level security;
alter table public.cpi_result_types enable row level security;
alter table public.incident_injury_types enable row level security;
alter table public.incident_locations enable row level security;

create policy "Vocabulary is readable by global default or own institution"
  on public.incident_action_types for select to authenticated
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = incident_action_types.institution_id and s.user_id = auth.uid()
  ));
create policy "Vocabulary is readable by global default or own institution"
  on public.incident_recovery_types for select to authenticated
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = incident_recovery_types.institution_id and s.user_id = auth.uid()
  ));
create policy "Vocabulary is readable by global default or own institution"
  on public.cpi_reason_types for select to authenticated
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = cpi_reason_types.institution_id and s.user_id = auth.uid()
  ));
create policy "Vocabulary is readable by global default or own institution"
  on public.cpi_disengagement_types for select to authenticated
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = cpi_disengagement_types.institution_id and s.user_id = auth.uid()
  ));
create policy "Vocabulary is readable by global default or own institution"
  on public.cpi_result_types for select to authenticated
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = cpi_result_types.institution_id and s.user_id = auth.uid()
  ));
create policy "Vocabulary is readable by global default or own institution"
  on public.incident_injury_types for select to authenticated
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = incident_injury_types.institution_id and s.user_id = auth.uid()
  ));
create policy "Vocabulary is readable by global default or own institution"
  on public.incident_locations for select to authenticated
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = incident_locations.institution_id and s.user_id = auth.uid()
  ));

-- Only Locations gets a write policy in this build -- the brief is
-- explicit that free text isn't acceptable there and a school must be
-- able to edit its own list. institution_id must equal the caller's own
-- (a principal can never write a global default row, since institution_id
-- is not null in the check below).
create policy "Principals can add locations for their own institution"
  on public.incident_locations for insert to authenticated
  with check (
    institution_id is not null
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = incident_locations.institution_id
        and s.user_id = auth.uid() and s.role = 'principal'
    )
  );
create policy "Principals can edit locations for their own institution"
  on public.incident_locations for update to authenticated
  using (
    institution_id is not null
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = incident_locations.institution_id
        and s.user_id = auth.uid() and s.role = 'principal'
    )
  )
  with check (
    institution_id is not null
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = incident_locations.institution_id
        and s.user_id = auth.uid() and s.role = 'principal'
    )
  );


-- =====================================================================
-- PART 2 -- institution_staff: add the 'principal' role
-- =====================================================================
-- Same widen-the-constraint pattern 0033 (added institution_admin) and
-- 0065 (added sna) already used twice on this exact constraint.

alter table public.institution_staff
  drop constraint if exists institution_staff_role_check;
alter table public.institution_staff
  add constraint institution_staff_role_check
  check (role in ('class_teacher', 'institution_admin', 'sna', 'principal'));

-- Self-link INSERT policy: add 'principal' to the allowed set. Still
-- requires current_user_role() = role (0033's fix), so nobody can
-- self-link as principal without their real, server-set app_metadata
-- role already being 'principal' -- this migration doesn't create a
-- privilege escalation, it only admits a role that /api/set-role (an
-- app-code change, not this file) will let a user pick for themselves.
alter policy "Institution admins and class teachers can self-link"
  on public.institution_staff
  with check (
    auth.uid() = user_id
    and public.current_user_role() in ('institution_admin', 'class_teacher', 'sna', 'principal')
    and public.current_user_role() = role
  );

-- One principal per institution, enforced at the database -- same
-- partial-unique-index shape as fba_reports_one_active_per_passport
-- (migration 0040). A second principal's self-link INSERT will fail
-- with a unique-violation, not a friendly message -- that's an app-code
-- concern (mapping the error), not this file's.
create unique index institution_staff_one_principal_per_institution
  on public.institution_staff (institution_id)
  where role = 'principal';


-- =====================================================================
-- PART 3 -- incidents (the parent record)
-- =====================================================================

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  -- Nullable: the stage-one stamp is created by whoever's present, who
  -- may not be the eventual owning teacher. Assigned at or during stage
  -- two. See judgment call notes above the table -- no DB-level check
  -- that whoever this points to actually holds the class_teacher role;
  -- left as an application concern.
  owning_teacher_id uuid references auth.users (id) on delete set null,
  occurred_at timestamptz not null,
  -- J1: a real, separate column from created_at, even though both
  -- default to now() and neither changes after insert.
  recorded_at timestamptz not null default now(),
  location_id uuid not null references public.incident_locations (id),
  -- Nullable: not part of the four stage-one fields (child, time,
  -- location, staff present) -- filled in at stage two.
  category text check (category in ('behaviour_leading_to_injury', 'imminent_risk_of_injury', 'one_party_incident')),
  party text check (party in ('self', 'peer', 'staff')),
  item_involved text,
  narrative text,
  parent_summary text,
  staff_count_needed text check (staff_count_needed in ('1', '2', '3', '4', '5+')),
  staff_distressed text check (staff_distressed in ('yes', 'slightly', 'no')),
  risk_reduction_future text,
  other_information text,
  status text not null default 'draft'
    check (status in ('draft', 'awaiting_attestation', 'awaiting_debrief', 'awaiting_principal', 'finalised')),
  debrief_required boolean not null default false,
  teacher_signed_at timestamptz,
  teacher_signed_by uuid references auth.users (id),
  principal_signed_at timestamptz,
  principal_signed_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index incidents_institution_id_idx on public.incidents (institution_id);
create index incidents_created_by_idx on public.incidents (created_by);
create index incidents_owning_teacher_id_idx on public.incidents (owning_teacher_id);
create index incidents_status_idx on public.incidents (status);

drop trigger if exists set_incidents_updated_at on public.incidents;
create trigger set_incidents_updated_at
  before update on public.incidents
  for each row
  execute function public.set_updated_at();

-- J3: post-teacher-signoff immutability, enforced as a trigger, not just
-- an RLS USING clause. Once teacher_signed_at is set, the ONLY columns
-- allowed to change afterward are principal_signed_at/principal_signed_by
-- (the countersign itself) and updated_at (which the trigger above
-- always touches). Everything else -- narrative, category, status, even
-- teacher_signed_at itself -- is frozen. This is stricter than
-- fba_reports' own precedent (a bare USING status <> 'completed'
-- clause) deliberately: fba_reports only ever has ALL-writes-blocked as
-- its locked state, this table has a real in-between state (teacher
-- signed, principal countersign still pending) where a very narrow
-- write must still succeed, and RLS alone can gate which ROWS are
-- writable but not which COLUMNS change within an allowed row.
create or replace function public.guard_incident_immutability()
returns trigger
language plpgsql
as $$
begin
  if old.teacher_signed_at is not null then
    if new.institution_id is distinct from old.institution_id
      or new.created_by is distinct from old.created_by
      or new.owning_teacher_id is distinct from old.owning_teacher_id
      or new.occurred_at is distinct from old.occurred_at
      or new.recorded_at is distinct from old.recorded_at
      or new.location_id is distinct from old.location_id
      or new.category is distinct from old.category
      or new.party is distinct from old.party
      or new.item_involved is distinct from old.item_involved
      or new.narrative is distinct from old.narrative
      or new.parent_summary is distinct from old.parent_summary
      or new.staff_count_needed is distinct from old.staff_count_needed
      or new.staff_distressed is distinct from old.staff_distressed
      or new.risk_reduction_future is distinct from old.risk_reduction_future
      or new.other_information is distinct from old.other_information
      or new.status is distinct from old.status
      or new.debrief_required is distinct from old.debrief_required
      or new.teacher_signed_at is distinct from old.teacher_signed_at
      or new.teacher_signed_by is distinct from old.teacher_signed_by
    then
      raise exception 'This incident is teacher-signed and immutable. Use incident_amendments to add a correction.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_incidents_immutability on public.incidents;
create trigger guard_incidents_immutability
  before update on public.incidents
  for each row
  execute function public.guard_incident_immutability();

alter table public.incidents enable row level security;

-- Shared visibility helper -- used by this table's own SELECT policy AND
-- by every child table below (no staff-side per-child redaction per
-- decision 6: if you can see the incident, you see all of it, so every
-- child table's policy is just "can the caller see the parent
-- incident"). SECURITY DEFINER so it can read incidents/incident_children
-- without re-triggering their own RLS from inside a policy check.
--
-- LANGUAGE PLPGSQL, not SQL, and specifically because of that choice --
-- not a style preference. A LANGUAGE SQL function body is parsed AND
-- semantically validated (including that every referenced relation
-- exists) at CREATE FUNCTION time, not lazily. This function references
-- incident_children and incident_staff, both created further down this
-- same file (Parts 4 and 5) -- defined here as SQL, CREATE FUNCTION
-- itself would fail with "relation does not exist" before either table
-- exists yet. PL/pgSQL function bodies are stored as opaque text and
-- only parsed/validated the first time the function actually runs, so
-- the forward reference is fine. (Confirmed live: this is exactly the
-- error this function originally hit.)
create or replace function public.can_view_incident(p_incident_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return exists (
    select 1 from public.incidents i
    where i.id = p_incident_id
      and (
        -- Principal: institution-wide, verified institution only
        -- (decision 2's accepted gap -- institution_staff.role =
        -- 'principal' is first-come at self-link time; this only adds
        -- the institutions.status = 'verified' condition on top).
        exists (
          select 1 from public.institution_staff s
          join public.institutions inst on inst.id = s.institution_id
          where s.institution_id = i.institution_id
            and s.user_id = auth.uid()
            and s.role = 'principal'
            and inst.status = 'verified'
        )
        -- Creator and owning teacher: always, incident-scoped (decision 4).
        or i.created_by = auth.uid()
        or i.owning_teacher_id = auth.uid()
        -- Clinician: full caseload access, any involved child, never a draft.
        or (
          i.status <> 'draft'
          and public.is_verified_clinician(auth.uid())
          and exists (
            select 1 from public.incident_children ic
            join public.clinician_access ca on ca.passport_id = ic.passport_id
            where ic.incident_id = i.id
              and ca.clinician_id = auth.uid()
              and ca.is_active = true
          )
        )
        -- Named staff (involved/witnessed), once past draft -- drafts are
        -- author/owning-teacher/principal only, per the brief's own
        -- "nobody else, ever" rule, and this incident_staff row wouldn't
        -- typically exist meaningfully at draft stage anyway.
        or (
          i.status <> 'draft'
          and exists (
            select 1 from public.incident_staff st
            where st.incident_id = i.id and st.user_id = auth.uid()
          )
        )
        -- Ordinary teacher/SNA passport_access to a named child, once
        -- past draft -- decision 1: NOT gated on approved_by_parent, this
        -- is the school's own record under the school's own obligations.
        or (
          i.status <> 'draft'
          and exists (
            select 1 from public.incident_children ic
            join public.passport_access pa on pa.passport_id = ic.passport_id
            where ic.incident_id = i.id
              and pa.teacher_id = auth.uid()
              and pa.is_active = true
          )
        )
      )
  );
end;
$$;

create policy "Incident visibility follows can_view_incident"
  on public.incidents for select to authenticated
  using (public.can_view_incident(id));

-- INSERT: any actively-linked class_teacher, sna, or principal at the
-- named institution (J5) -- the stage-one stamp. created_by must be the
-- caller; status must start as 'draft'; nothing else is required, since
-- the four stage-one fields (child, time, location, staff) span
-- incidents + incident_children + incident_staff, not this table alone.
create policy "School staff can create an incident for their institution"
  on public.incidents for insert to authenticated
  with check (
    created_by = auth.uid()
    and status = 'draft'
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = incidents.institution_id
        and s.user_id = auth.uid()
        and s.role in ('class_teacher', 'sna', 'principal')
    )
  );

-- UPDATE, pre-teacher-signoff: creator or owning teacher, while
-- teacher_signed_at is still null. This is the stage-two full-record
-- write, and also how the creator sets/changes owning_teacher_id.
create policy "Creator or owning teacher can edit before teacher sign-off"
  on public.incidents for update to authenticated
  using (
    teacher_signed_at is null
    and (created_by = auth.uid() or owning_teacher_id = auth.uid())
  )
  with check (
    created_by = auth.uid() or owning_teacher_id = auth.uid()
  );

-- UPDATE, principal countersign: only once teacher has signed and
-- principal hasn't yet. The guard_incidents_immutability trigger above
-- is what actually stops this policy's WITH CHECK from being (ab)used to
-- rewrite anything but principal_signed_at/principal_signed_by -- RLS
-- alone can't express "only these two columns changed."
create policy "Principal can countersign after teacher sign-off"
  on public.incidents for update to authenticated
  using (
    teacher_signed_at is not null
    and principal_signed_at is null
    and exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = incidents.institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and inst.status = 'verified'
    )
  )
  with check (
    principal_signed_by = auth.uid()
  );


-- =====================================================================
-- PART 4 -- incident_children
-- =====================================================================
-- child_index in ('A','B') plus a unique(incident_id, child_index)
-- constraint is what caps this at two children per incident WITHOUT
-- baking "two" into the table shape -- it stays a real one-to-many
-- child table, just one whose only two legal slots are already taken
-- once both exist. Raising the cap later (if the paper form ever
-- changes) is a single CHECK-constraint edit, not a schema rewrite.

create table public.incident_children (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  passport_id uuid not null references public.passports (id) on delete cascade,
  child_index text not null check (child_index in ('A', 'B')),
  -- Decision 5: stage-one child selection draws from the institution
  -- roster, not the creator's own passport_access -- record who actually
  -- added this child to the incident.
  added_by uuid not null references auth.users (id),
  distress_level text check (distress_level in ('yes_definitely', 'slightly', 'not_distressed', 'hard_to_tell')),
  remained_on_site boolean,
  remained_detail text,
  recovery_methods text[],
  parent_call_required boolean not null default false,
  parent_called_at timestamptz,
  parent_called_by uuid references auth.users (id),
  parent_notified_at timestamptz,
  parent_notified_by uuid references auth.users (id),
  unique (incident_id, passport_id),
  unique (incident_id, child_index)
);

create index incident_children_incident_id_idx on public.incident_children (incident_id);
create index incident_children_passport_id_idx on public.incident_children (passport_id);

alter table public.incident_children enable row level security;

create policy "Incident child visibility follows the parent incident"
  on public.incident_children for select to authenticated
  using (public.can_view_incident(incident_id));

create policy "Creator or owning teacher can add children before sign-off"
  on public.incident_children for insert to authenticated
  with check (
    added_by = auth.uid()
    and exists (
      select 1 from public.incidents i
      where i.id = incident_children.incident_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  );

create policy "Creator or owning teacher can edit children before sign-off"
  on public.incident_children for update to authenticated
  using (
    exists (
      select 1 from public.incidents i
      where i.id = incident_children.incident_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.incidents i
      where i.id = incident_children.incident_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  );

create policy "Creator or owning teacher can remove children before sign-off"
  on public.incident_children for delete to authenticated
  using (
    exists (
      select 1 from public.incidents i
      where i.id = incident_children.incident_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  );


-- =====================================================================
-- PART 5 -- incident_staff
-- =====================================================================

create table public.incident_staff (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  free_text_name text,
  involvement text not null check (involvement in ('involved', 'witnessed')),
  attested_at timestamptz,
  attestation_addendum text,
  check (user_id is not null or free_text_name is not null)
);

create index incident_staff_incident_id_idx on public.incident_staff (incident_id);
create index incident_staff_user_id_idx on public.incident_staff (user_id);
-- A given account can only be named once per incident (as either
-- involved or witnessed, not both simultaneously as separate rows) --
-- partial because free-text-named rows (user_id null) have no identity
-- to de-duplicate on.
create unique index incident_staff_one_row_per_user on public.incident_staff (incident_id, user_id) where user_id is not null;

alter table public.incident_staff enable row level security;

create policy "Incident staff visibility follows the parent incident"
  on public.incident_staff for select to authenticated
  using (public.can_view_incident(incident_id));

create policy "Creator or owning teacher can name staff before sign-off"
  on public.incident_staff for insert to authenticated
  with check (
    exists (
      select 1 from public.incidents i
      where i.id = incident_staff.incident_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  );

-- Two distinct UPDATE policies rather than one OR'd together: the named
-- staff member attesting to THEIR OWN row is a completely different
-- authority than the creator/owning teacher editing who's named at all
-- (e.g. fixing a misspelled free-text name) -- keeping them separate
-- means a future change to one can't accidentally widen the other.
create policy "Named staff can attest to their own row"
  on public.incident_staff for update to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from public.incidents i where i.id = incident_staff.incident_id and i.teacher_signed_at is null)
  )
  with check (user_id = auth.uid());

create policy "Creator or owning teacher can edit staff entries before sign-off"
  on public.incident_staff for update to authenticated
  using (
    exists (
      select 1 from public.incidents i
      where i.id = incident_staff.incident_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.incidents i
      where i.id = incident_staff.incident_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  );

create policy "Creator or owning teacher can remove staff entries before sign-off"
  on public.incident_staff for delete to authenticated
  using (
    exists (
      select 1 from public.incidents i
      where i.id = incident_staff.incident_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  );


-- =====================================================================
-- PART 6 -- incident_actions (join to the actions vocabulary -- J2)
-- =====================================================================

create table public.incident_actions (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  action_type_id uuid not null references public.incident_action_types (id),
  unique (incident_id, action_type_id)
);

create index incident_actions_incident_id_idx on public.incident_actions (incident_id);

alter table public.incident_actions enable row level security;

create policy "Incident action visibility follows the parent incident"
  on public.incident_actions for select to authenticated
  using (public.can_view_incident(incident_id));

create policy "Creator or owning teacher can select actions before sign-off"
  on public.incident_actions for insert to authenticated
  with check (
    exists (
      select 1 from public.incidents i
      where i.id = incident_actions.incident_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  );

create policy "Creator or owning teacher can deselect actions before sign-off"
  on public.incident_actions for delete to authenticated
  using (
    exists (
      select 1 from public.incidents i
      where i.id = incident_actions.incident_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  );


-- =====================================================================
-- PART 7 -- restrictive_practices
-- =====================================================================
-- Zero, one, or many rows per incident -- a child could have more than
-- one hold within a single prolonged incident. planning_status has NO
-- default, per the brief: it must always be an active choice.

create table public.restrictive_practices (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  passport_id uuid not null references public.passports (id),
  planning_status text not null check (planning_status in ('in_bsp', 'not_planned')),
  reason_codes text[],
  disengagement_codes text[],
  hold_type text check (hold_type in ('childrens', 'young_person')),
  hold_position text check (hold_position in ('seated', 'standing')),
  hold_level text check (hold_level in ('low', 'med', 'high')),
  result_codes text[],
  total_procedures integer,
  staff_initials text,
  ncse_report_complete boolean not null default false,
  ncse_completed_at timestamptz,
  ncse_completed_by uuid references auth.users (id)
);

create index restrictive_practices_incident_id_idx on public.restrictive_practices (incident_id);
create index restrictive_practices_passport_id_idx on public.restrictive_practices (passport_id);

alter table public.restrictive_practices enable row level security;

create policy "Restrictive practice visibility follows the parent incident"
  on public.restrictive_practices for select to authenticated
  using (public.can_view_incident(incident_id));

create policy "Creator or owning teacher can record restrictive practice before sign-off"
  on public.restrictive_practices for insert to authenticated
  with check (
    exists (
      select 1 from public.incidents i
      where i.id = restrictive_practices.incident_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  );

create policy "Creator or owning teacher can edit restrictive practice before sign-off"
  on public.restrictive_practices for update to authenticated
  using (
    exists (
      select 1 from public.incidents i
      where i.id = restrictive_practices.incident_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.incidents i
      where i.id = restrictive_practices.incident_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  );

-- NCSE completion is deliberately editable via the same policy above,
-- not split out -- it's still pre-signoff record-keeping, same authors.
-- No delete policy: once a restrictive-practice row exists it is never
-- removed, only ever corrected via the same update path pre-signoff or
-- via incident_amendments after.


-- =====================================================================
-- PART 8 -- incident_injuries
-- =====================================================================

create table public.incident_injuries (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  injured_party_type text not null check (injured_party_type in ('student', 'staff')),
  passport_id uuid references public.passports (id),
  staff_user_id uuid references auth.users (id),
  free_text_name text,
  injury_types text[],
  injury_notes text,
  first_aider_called boolean not null default false,
  first_aider_name text,
  doctor_ambulance_called boolean not null default false,
  treatments text[],
  treatment_other text,
  remained_on_site boolean,
  remained_detail text,
  check (
    (injured_party_type = 'student' and passport_id is not null)
    or (injured_party_type = 'staff' and (staff_user_id is not null or free_text_name is not null))
  )
);

create index incident_injuries_incident_id_idx on public.incident_injuries (incident_id);
create index incident_injuries_passport_id_idx on public.incident_injuries (passport_id);

alter table public.incident_injuries enable row level security;

create policy "Injury visibility follows the parent incident"
  on public.incident_injuries for select to authenticated
  using (public.can_view_incident(incident_id));

create policy "Creator or owning teacher can record injuries before sign-off"
  on public.incident_injuries for insert to authenticated
  with check (
    exists (
      select 1 from public.incidents i
      where i.id = incident_injuries.incident_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  );

create policy "Creator or owning teacher can edit injuries before sign-off"
  on public.incident_injuries for update to authenticated
  using (
    exists (
      select 1 from public.incidents i
      where i.id = incident_injuries.incident_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.incidents i
      where i.id = incident_injuries.incident_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  );

create policy "Creator or owning teacher can remove injuries before sign-off"
  on public.incident_injuries for delete to authenticated
  using (
    exists (
      select 1 from public.incidents i
      where i.id = incident_injuries.incident_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  );


-- =====================================================================
-- PART 9 -- incident_body_marks
-- =====================================================================
-- Normalised 0-1 coordinates so the body map renders at any size (the
-- brief's own requirement). Scoped via injury_id -> incident_injuries,
-- not a direct incident_id -- can_view_incident is reached through one
-- extra join rather than denormalising incident_id onto this table too.

create table public.incident_body_marks (
  id uuid primary key default gen_random_uuid(),
  injury_id uuid not null references public.incident_injuries (id) on delete cascade,
  view text not null check (view in ('front', 'back')),
  x numeric not null check (x >= 0 and x <= 1),
  y numeric not null check (y >= 0 and y <= 1),
  injury_type text,
  note text,
  created_at timestamptz not null default now()
);

create index incident_body_marks_injury_id_idx on public.incident_body_marks (injury_id);

alter table public.incident_body_marks enable row level security;

create policy "Body mark visibility follows the parent incident"
  on public.incident_body_marks for select to authenticated
  using (
    exists (
      select 1 from public.incident_injuries ii
      where ii.id = incident_body_marks.injury_id
        and public.can_view_incident(ii.incident_id)
    )
  );

create policy "Creator or owning teacher can place markers before sign-off"
  on public.incident_body_marks for insert to authenticated
  with check (
    exists (
      select 1 from public.incident_injuries ii
      join public.incidents i on i.id = ii.incident_id
      where ii.id = incident_body_marks.injury_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  );

create policy "Creator or owning teacher can edit markers before sign-off"
  on public.incident_body_marks for update to authenticated
  using (
    exists (
      select 1 from public.incident_injuries ii
      join public.incidents i on i.id = ii.incident_id
      where ii.id = incident_body_marks.injury_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.incident_injuries ii
      join public.incidents i on i.id = ii.incident_id
      where ii.id = incident_body_marks.injury_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  );

create policy "Creator or owning teacher can remove markers before sign-off"
  on public.incident_body_marks for delete to authenticated
  using (
    exists (
      select 1 from public.incident_injuries ii
      join public.incidents i on i.id = ii.incident_id
      where ii.id = incident_body_marks.injury_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  );


-- =====================================================================
-- PART 10 -- incident_debriefs
-- =====================================================================
-- One row per incident (unique incident_id) -- "debrief, owned by the
-- teacher" is singular on the brief's own terms.

create table public.incident_debriefs (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  debrief_date date not null,
  staff_present text[],
  notes text,
  actions_for_management text,
  completed_by uuid references auth.users (id),
  completed_at timestamptz,
  unique (incident_id)
);

create index incident_debriefs_incident_id_idx on public.incident_debriefs (incident_id);

alter table public.incident_debriefs enable row level security;

create policy "Debrief visibility follows the parent incident"
  on public.incident_debriefs for select to authenticated
  using (public.can_view_incident(incident_id));

create policy "Owning teacher can record the debrief before sign-off"
  on public.incident_debriefs for insert to authenticated
  with check (
    exists (
      select 1 from public.incidents i
      where i.id = incident_debriefs.incident_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  );

create policy "Owning teacher can edit the debrief before sign-off"
  on public.incident_debriefs for update to authenticated
  using (
    exists (
      select 1 from public.incidents i
      where i.id = incident_debriefs.incident_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.incidents i
      where i.id = incident_debriefs.incident_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  );


-- =====================================================================
-- PART 11 -- incident_amendments (append-only, post-finalisation)
-- =====================================================================
-- No UPDATE or DELETE policy at all, on purpose -- INSERT and SELECT are
-- the only operations this table supports, ever. J4: restricted to the
-- owning teacher, the creator, an institution principal, or a verified
-- clinician with active caseload access to an involved child -- not
-- every staff member who can merely view the incident. Flagged as a
-- judgment call; tell me if amendment rights should be broader or
-- narrower.

create table public.incident_amendments (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id) on delete cascade,
  author_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  reason text not null,
  content text not null
);

create index incident_amendments_incident_id_idx on public.incident_amendments (incident_id);

alter table public.incident_amendments enable row level security;

create policy "Amendment visibility follows the parent incident"
  on public.incident_amendments for select to authenticated
  using (public.can_view_incident(incident_id));

create policy "Only those with real standing can add an amendment"
  on public.incident_amendments for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.incidents i
      where i.id = incident_amendments.incident_id
        and (
          i.created_by = auth.uid()
          or i.owning_teacher_id = auth.uid()
          or exists (
            select 1 from public.institution_staff s
            join public.institutions inst on inst.id = s.institution_id
            where s.institution_id = i.institution_id
              and s.user_id = auth.uid()
              and s.role = 'principal'
              and inst.status = 'verified'
          )
          or (
            public.is_verified_clinician(auth.uid())
            and exists (
              select 1 from public.incident_children ic
              join public.clinician_access ca on ca.passport_id = ic.passport_id
              where ic.incident_id = i.id
                and ca.clinician_id = auth.uid()
                and ca.is_active = true
            )
          )
        )
    )
  );


-- =====================================================================
-- PART 12 -- school_notices (generalised, notice_type discriminator)
-- =====================================================================
-- Build note: the parent-call flag needs a new table, generalised from
-- the start so the NEXT notice type doesn't need a third table --
-- calm_escalation_notices is untouched, this is a separate table in a
-- separate namespace (school-staff/principal-consumed, not clinician-
-- consumed). Only one notice_type exists today; the CHECK constraint is
-- intentionally a literal list so adding a second type later is a one-
-- line ALTER, not a schema redesign.
--
-- Two small triggers set incident_children.parent_call_required to true
-- (never back to false -- once required, always required, matching "a
-- physical injury or restrictive practice was used" being a fact that
-- doesn't un-happen) when a qualifying incident_injuries or
-- restrictive_practices row is inserted for a given child. A third
-- trigger, on incident_children itself, reacts to parent_call_required
-- flipping to true -- from EITHER of those two triggers, or a direct
-- manual teacher UPDATE -- and raises exactly one school_notices row.
-- This keeps notice-creation in one place instead of three.

create table public.school_notices (
  id uuid primary key default gen_random_uuid(),
  notice_type text not null check (notice_type in ('incident_parent_call')),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  incident_id uuid references public.incidents (id) on delete cascade,
  passport_id uuid references public.passports (id),
  occurred_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index school_notices_institution_id_idx on public.school_notices (institution_id);
create index school_notices_incident_id_idx on public.school_notices (incident_id);
-- Mirrors calm_escalation_notices' own "unacknowledged, newest first"
-- read shape.
create index school_notices_unacknowledged_idx on public.school_notices (institution_id, occurred_at desc) where acknowledged_at is null;

alter table public.school_notices enable row level security;

-- Read: principal of a verified institution, or the incident's owning
-- teacher/creator (so the person actioning the call can also see the
-- flag on their own dashboard, not principal-only). No parent policy at
-- all, matching calm_escalation_notices' own deliberate parent exclusion.
create policy "Principal or incident owner can view school notices"
  on public.school_notices for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = school_notices.institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and inst.status = 'verified'
    )
    or exists (
      select 1 from public.incidents i
      where i.id = school_notices.incident_id
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  );

create policy "Principal or incident owner can acknowledge a school notice"
  on public.school_notices for update to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = school_notices.institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and inst.status = 'verified'
    )
    or exists (
      select 1 from public.incidents i
      where i.id = school_notices.incident_id
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  )
  with check (acknowledged_by = auth.uid());

-- No client-facing INSERT policy -- every row is written by the trigger
-- below (SECURITY DEFINER-equivalent via being a trigger function owned
-- by the migration role), never directly by a client insert.

create or replace function public.raise_incident_parent_call_notice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_institution_id uuid;
begin
  -- This trigger only ever fires on UPDATE OF parent_call_required, so
  -- old is always populated here -- no INSERT case to guard against,
  -- since the column defaults to false at row creation.
  if new.parent_call_required = true and old.parent_call_required = false then
    select institution_id into v_institution_id from public.incidents where id = new.incident_id;
    insert into public.school_notices (notice_type, institution_id, incident_id, passport_id)
    values ('incident_parent_call', v_institution_id, new.incident_id, new.passport_id);
  end if;
  return new;
end;
$$;

drop trigger if exists raise_parent_call_notice on public.incident_children;
create trigger raise_parent_call_notice
  after update of parent_call_required on public.incident_children
  for each row
  execute function public.raise_incident_parent_call_notice();

-- Injuries and restrictive practice set the flag automatically; the
-- manual teacher toggle is just a direct UPDATE to incident_children
-- from the app, which the trigger above already covers identically.

create or replace function public.flag_parent_call_for_injury()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.injured_party_type = 'student' and new.passport_id is not null then
    update public.incident_children
    set parent_call_required = true
    where incident_id = new.incident_id and passport_id = new.passport_id
      and parent_call_required = false;
  end if;
  return new;
end;
$$;

drop trigger if exists flag_parent_call_on_injury on public.incident_injuries;
create trigger flag_parent_call_on_injury
  after insert on public.incident_injuries
  for each row
  execute function public.flag_parent_call_for_injury();

create or replace function public.flag_parent_call_for_restrictive_practice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.incident_children
  set parent_call_required = true
  where incident_id = new.incident_id and passport_id = new.passport_id
    and parent_call_required = false;
  return new;
end;
$$;

drop trigger if exists flag_parent_call_on_restrictive_practice on public.restrictive_practices;
create trigger flag_parent_call_on_restrictive_practice
  after insert on public.restrictive_practices
  for each row
  execute function public.flag_parent_call_for_restrictive_practice();


-- =====================================================================
-- PART 13 -- get_parent_incidents(): the redacted parent view
-- =====================================================================
-- Follows get_abc_logs's own shape exactly: SECURITY DEFINER, RETURNS
-- TABLE with a structurally narrow column list -- narrative and the
-- other child's data are not columns this function can ever return,
-- the same way clinical_notes is not a column get_abc_logs can ever
-- return. No parent-facing SELECT policy exists on ANY of the base
-- tables above (confirm by grep after running this) -- every parent
-- read goes through this one function, never a direct table query.
--
-- Never returns draft incidents (owns_passport alone is not enough --
-- the WHERE clause below explicitly excludes status = 'draft').
-- Injuries and restrictive-practice rows are pre-filtered to the
-- caller's own child (passport_id match) and folded into jsonb arrays
-- per incident, so there is no way for a join to leak the other child's
-- injury or restraint rows even by accident.

create or replace function public.get_parent_incidents(p_passport_id uuid)
returns table (
  incident_id uuid,
  occurred_at timestamptz,
  recorded_at timestamptz,
  location text,
  status text,
  parent_summary text,
  child_index text,
  distress_level text,
  remained_on_site boolean,
  remained_detail text,
  recovery_methods text[],
  parent_call_required boolean,
  parent_called_at timestamptz,
  parent_notified_at timestamptz,
  teacher_signed_at timestamptz,
  principal_signed_at timestamptz,
  injuries jsonb,
  restrictive_practice jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select
    i.id as incident_id,
    i.occurred_at,
    i.recorded_at,
    loc.value as location,
    i.status,
    i.parent_summary,
    ic.child_index,
    ic.distress_level,
    ic.remained_on_site,
    ic.remained_detail,
    ic.recovery_methods,
    ic.parent_call_required,
    ic.parent_called_at,
    ic.parent_notified_at,
    i.teacher_signed_at,
    i.principal_signed_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'injury_types', inj.injury_types,
        'injury_notes', inj.injury_notes,
        'first_aider_called', inj.first_aider_called,
        'first_aider_name', inj.first_aider_name,
        'doctor_ambulance_called', inj.doctor_ambulance_called,
        'treatments', inj.treatments,
        'treatment_other', inj.treatment_other,
        'remained_on_site', inj.remained_on_site,
        'remained_detail', inj.remained_detail
      ))
      from public.incident_injuries inj
      where inj.incident_id = i.id
        and inj.injured_party_type = 'student'
        and inj.passport_id = p_passport_id
    ), '[]'::jsonb) as injuries,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'planning_status', rp.planning_status,
        'ncse_report_complete', rp.ncse_report_complete
      ))
      from public.restrictive_practices rp
      where rp.incident_id = i.id
        and rp.passport_id = p_passport_id
    ), '[]'::jsonb) as restrictive_practice
  from public.incidents i
  join public.incident_children ic on ic.incident_id = i.id and ic.passport_id = p_passport_id
  join public.incident_locations loc on loc.id = i.location_id
  where public.owns_passport(p_passport_id)
    and i.status <> 'draft'
  order by i.occurred_at desc;
$$;

grant execute on function public.get_parent_incidents(uuid) to authenticated;


-- =====================================================================
-- PART 14 -- get_institution_incidents(): principal's filterable list
-- =====================================================================
-- Descoped per the build note: a plain filterable list with NCSE and
-- planning_status visible, no aggregation, no charts. Principal-only,
-- verified-institution-only (decision 2), full narrative included since
-- there's no staff-side redaction (decision 6) and a principal already
-- has full incident access via can_view_incident.

create or replace function public.get_institution_incidents(
  p_institution_id uuid,
  p_start date default null,
  p_end date default null,
  p_planning_status text default null,
  p_ncse_complete boolean default null
)
returns table (
  incident_id uuid,
  occurred_at timestamptz,
  recorded_at timestamptz,
  location text,
  category text,
  status text,
  owning_teacher_name text,
  child_indices text[],
  debrief_required boolean,
  teacher_signed_at timestamptz,
  principal_signed_at timestamptz,
  has_restrictive_practice boolean,
  planning_status text[],
  ncse_report_complete boolean[]
)
language sql
security definer
set search_path = public
stable
as $$
  select
    i.id as incident_id,
    i.occurred_at,
    i.recorded_at,
    loc.value as location,
    i.category,
    i.status,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as owning_teacher_name,
    (select array_agg(ic.child_index order by ic.child_index) from public.incident_children ic where ic.incident_id = i.id) as child_indices,
    i.debrief_required,
    i.teacher_signed_at,
    i.principal_signed_at,
    exists (select 1 from public.restrictive_practices rp where rp.incident_id = i.id) as has_restrictive_practice,
    (select array_agg(rp.planning_status) from public.restrictive_practices rp where rp.incident_id = i.id) as planning_status,
    (select array_agg(rp.ncse_report_complete) from public.restrictive_practices rp where rp.incident_id = i.id) as ncse_report_complete
  from public.incidents i
  join public.incident_locations loc on loc.id = i.location_id
  left join auth.users u on u.id = i.owning_teacher_id
  where i.institution_id = p_institution_id
    and exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and inst.status = 'verified'
    )
    and (p_start is null or i.occurred_at::date >= p_start)
    and (p_end is null or i.occurred_at::date <= p_end)
    and (
      p_planning_status is null
      or exists (select 1 from public.restrictive_practices rp where rp.incident_id = i.id and rp.planning_status = p_planning_status)
    )
    and (
      p_ncse_complete is null
      or exists (select 1 from public.restrictive_practices rp where rp.incident_id = i.id and rp.ncse_report_complete = p_ncse_complete)
    )
  order by i.occurred_at desc;
$$;

grant execute on function public.get_institution_incidents(uuid, date, date, text, boolean) to authenticated;
