/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SCHOOL INCIDENT LOG -- the institution_permissions amendment, actually
   implemented. institution_permissions did not exist until this
   migration -- confirmed directly against the live schema (PGRST205,
   "Could not find the table 'public.institution_permissions'"), not
   assumed from the migration history.

   WHAT can_countersign_incident() ACTUALLY CHECKED, BEFORE THIS:
   institution_staff.role = 'principal', at a verified institution.
   Nothing else. The 0073 stub's own header comment said as much ("today's
   behaviour is byte-identical to what the inlined check already did") --
   0073 only moved WHERE that check lived, into one function, so the real
   grant model could land as a change to that function's body later
   without touching the sign-off policy again. That later change is this
   migration. Before this, a Deputy Principal had no path to countersign
   at all, and a principal on leave genuinely did stall every sign-off in
   the school -- exactly the gap the brief named.

   THE GRANT MODEL: institution_permissions is deliberately one row shape
   for "user X holds permission Y at institution Z, granted by W, revoked
   or not" -- a single permission value exists today (countersign_incident)
   because that's the only grant this build needs; adding a second kind
   later is a new allowed value and a new call site, not a new table.
   Revocation is a timestamp, not a delete -- consistent with every other
   "undo" in this module (attestation withdrawal, amendment append-only):
   the fact that authority was granted and later removed stays on the
   record, it doesn't disappear.

   can_countersign_incident() now returns true for EITHER an active
   principal role OR an active grant -- principals keep working exactly
   as before, with no migration of existing data required, and a grant is
   purely additive.

   FOUR QUESTIONS THIS REVISION ANSWERS (asked across two rounds of review
   before running the first draft):

   1. Self-revoke. A principal's authority is never written as an
      institution_permissions ROW -- it's derived live from
      institution_staff.role = 'principal', so there is nothing for a
      principal to revoke on themselves through this table; the literal
      scenario doesn't exist. The real danger is different: a school with
      NO principal, relying entirely on grants, could have its last
      active grant revoked and drop to zero countersign authority.
      guard_institution_permissions_last_holder() (below) blocks exactly
      that -- a revoke is refused unless, afterward, at least one active
      principal or one other active grant still exists at that
      institution.

   2. Who can hold a grant. Nothing previously stopped granting
      countersign_incident to a parent or clinician -- the INSERT policy
      only checked that the GRANTER was a principal, never that the
      GRANTEE was staff at all. guard_institution_permissions_grantee_
      is_staff() (below) is a trigger, not just a policy, because a
      policy is bypassable by service-role code (a fixture script, an
      admin task) and this needs to hold regardless of caller: it refuses
      any insert where the grantee has no institution_staff row at that
      institution. An SNA passes (real staff); a parent or clinician
      fails outright.

   3. Revocation is not retroactive. incidents.countersigned_role_at_time
      is written once, by the countersign policy's own WITH CHECK (0075,
      untouched here), frozen at the moment of signing. Nothing on any
      read or export path re-invokes can_countersign_incident() against
      CURRENT grant state for an already-countersigned incident -- a
      later revoke has no effect on it. That column will correctly show
      a grant-based signer's actual institution_staff.role (e.g.
      'class_teacher'), not 'principal' -- 0075's own comment anticipated
      this exactly ("the role that satisfied the grant might not always
      be 'principal' -- this column records what it actually was for
      THIS signature").

   4. A rewritable grant record. The revoke UPDATE policy only checked
      WHO could write and WHAT the final revoked_by had to be -- nothing
      stopped that same UPDATE from also silently changing user_id,
      permission, granted_by, or granted_at, rewriting who authority was
      ever granted to. In a module where attestations are append-only and
      amendments can't be edited after the fact, a rewritable grant
      record was out of step with everything else here.
      guard_institution_permissions_immutable_grant() (below) rejects any
      UPDATE that touches anything except revoked_at/revoked_by.

   SCOPE -- widened beyond the one function, on purpose. 0073 only ever
   indirected the countersign policy itself. FIVE other places inlined
   "institution_staff.role = 'principal'" as the test for incident-log
   authority that a granted Deputy Principal would also need for a
   countersign grant to be worth anything in practice -- all five are
   rewritten below to call can_countersign_incident() instead of
   re-deriving the role check at every site, matching 0073's own stated
   intent that the real spec should live in one function:
     - can_view_incident() -- a DP who can countersign but can't see the
       incident first is a grant that does nothing.
     - get_institution_incidents() -- the principal's incident list; same
       reasoning, this is how a DP would find what needs signing.
     - "Principal or incident owner can view school notices" -- a DP
       needs to see the parent-call flag too.
     - "Principal or incident owner can acknowledge a school notice" --
       and needs to be able to acknowledge it.
     - "Only those with real standing can add an amendment" -- decided
       explicitly this round: countersign and amend are the same
       authority in practice (a DP who can finalise a record but can't
       append a correction to it has half a role), so this widens too.

   DELIBERATELY LEFT ALONE, NOT WIDENED: the three "Principals can
   add/edit locations for their own institution" vocab policies on
   incident_locations. Decided explicitly this round: editing the
   school's shared CPI/location vocabulary is not incident authority,
   unlike amend -- a different question the brief never asked to fold in
   here. Flagged, not assumed.

   NOT DECIDED YET, ON PURPOSE -- FK POSTURE. The three auth.users FKs on
   institution_permissions are currently inconsistent: user_id (the
   grantee) is ON DELETE CASCADE, so deleting that account silently wipes
   the record that they ever held authority; granted_by and revoked_by
   have no ON DELETE clause (NO ACTION), so deleting a principal who ever
   granted or revoked anything is blocked outright. My recommendation,
   for whenever this gets decided: user_id should also be NO ACTION, to
   match granted_by/revoked_by and this module's own established posture
   elsewhere (teacher_signed_by, countersigned_by, incident_amendments.
   author_id -- none of them cascade). "Jane held countersign authority
   from March to June, granted by X, revoked by Y" is exactly the kind of
   governance fact this audit trail exists to keep even after Jane's
   account is gone -- especially since an incident's own countersigned_by
   could point at a grantee whose OWN grant record silently vanished,
   with no way left to reconstruct how they got that authority. NOT
   changed in this migration -- explicitly deferred to a deliberate
   decision, not a fast one, per the last one of these that cost hours.

   FORWARD DEPENDENCY, FLAGGED SO IT ISN'T MISSED: institution_staff has
   no deactivated_at (or equivalent) column today -- membership is just
   row existence, no active/inactive state. The day it gains one, BOTH
   can_countersign_incident() and guard_institution_permissions_grantee_
   is_staff() must be updated to require ACTIVE membership, not just a
   row. Without that follow-up, a deactivated Deputy Principal keeps
   countersign authority forever -- their institution_permissions grant
   stays valid, and nothing here would ever re-check it. */


-- =====================================================================
-- 1. institution_permissions -- the grant table itself.
-- =====================================================================

create table public.institution_permissions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  permission text not null check (permission in ('countersign_incident')),
  granted_by uuid not null references auth.users (id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id),
  check ((revoked_at is null) = (revoked_by is null))
);

-- Only one ACTIVE grant of a given permission per user per institution --
-- re-granting after a revoke is a new row, not an update of the old one,
-- so the history of who granted/revoked what, and when, stays intact.
create unique index institution_permissions_active_unique
  on public.institution_permissions (institution_id, user_id, permission)
  where revoked_at is null;

create index institution_permissions_user_idx on public.institution_permissions (user_id);

alter table public.institution_permissions enable row level security;

-- Read: the institution's principal(s), or the grant holder themselves
-- (so a DP can see their own standing).
create policy "Principal or the grant holder can view institution_permissions"
  on public.institution_permissions for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = institution_permissions.institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and inst.status = 'verified'
    )
  );

-- Grant: only an actual principal of that institution, granting to
-- someone else (not themselves -- a principal already has standing via
-- their role, a self-grant would just be noise on the audit trail).
create policy "Principal can grant institution_permissions"
  on public.institution_permissions for insert to authenticated
  with check (
    granted_by = auth.uid()
    and user_id <> auth.uid()
    and exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = institution_permissions.institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and inst.status = 'verified'
    )
  );

-- Revoke: only setting revoked_at/revoked_by, only by an actual
-- principal of that institution, only on a currently-active grant. The
-- WITH CHECK here constrains who revoked_by may be; it does NOT by
-- itself stop the same UPDATE also rewriting user_id/permission/
-- granted_by/granted_at -- that's what guard_institution_permissions_
-- immutable_grant() (below) exists for.
create policy "Principal can revoke institution_permissions"
  on public.institution_permissions for update to authenticated
  using (
    revoked_at is null
    and exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = institution_permissions.institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and inst.status = 'verified'
    )
  )
  with check (revoked_by = auth.uid());

-- No delete policy, anywhere -- matches this module's own rule that an
-- undone decision is recorded, not erased.


-- =====================================================================
-- 1a. Grantee must actually be school staff -- database-enforced,
-- regardless of caller (a policy alone is bypassable by service-role
-- code; this is a trigger so it isn't). Answers question 2. See the
-- FORWARD DEPENDENCY note above the header comment: this must also
-- check active membership once institution_staff has that concept.
-- =====================================================================

create or replace function public.guard_institution_permissions_grantee_is_staff()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.institution_staff s
    where s.institution_id = new.institution_id and s.user_id = new.user_id
  ) then
    raise exception 'Cannot grant % -- user % is not a member of institution_staff at institution %.',
      new.permission, new.user_id, new.institution_id;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_institution_permissions_grantee_is_staff on public.institution_permissions;
create trigger guard_institution_permissions_grantee_is_staff
  before insert on public.institution_permissions
  for each row
  execute function public.guard_institution_permissions_grantee_is_staff();


-- =====================================================================
-- 1b. Cannot revoke the last active countersign holder at an
-- institution -- a school with no principal, relying entirely on
-- grants, must never be revoked down to zero. Answers question 1.
-- =====================================================================

create or replace function public.guard_institution_permissions_last_holder()
returns trigger
language plpgsql
as $$
begin
  if new.revoked_at is not null and old.revoked_at is null and new.permission = 'countersign_incident' then
    if not exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = new.institution_id
        and s.role = 'principal'
        and inst.status = 'verified'
    ) and not exists (
      select 1 from public.institution_permissions p2
      where p2.institution_id = new.institution_id
        and p2.permission = 'countersign_incident'
        and p2.revoked_at is null
        and p2.id <> new.id
    ) then
      raise exception 'Cannot revoke -- this is the last active countersign holder at institution %. This institution has no principal; revoking this grant would leave nobody able to countersign.',
        new.institution_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_institution_permissions_last_holder on public.institution_permissions;
create trigger guard_institution_permissions_last_holder
  before update on public.institution_permissions
  for each row
  execute function public.guard_institution_permissions_last_holder();


-- =====================================================================
-- 1c. A grant record cannot be rewritten -- only revoked_at/revoked_by
-- may ever change after insert. Answers question 4. Runs before
-- guard_institution_permissions_last_holder (alphabetical trigger
-- order: "immutable" < "last_holder"), so an illegitimate field change
-- is rejected before the revoke logic even considers it.
-- =====================================================================

create or replace function public.guard_institution_permissions_immutable_grant()
returns trigger
language plpgsql
as $$
begin
  if new.id <> old.id
    or new.institution_id <> old.institution_id
    or new.user_id <> old.user_id
    or new.permission <> old.permission
    or new.granted_by <> old.granted_by
    or new.granted_at <> old.granted_at
  then
    raise exception 'Cannot modify institution_permissions -- only revoked_at/revoked_by may ever change after insert.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_institution_permissions_immutable_grant on public.institution_permissions;
create trigger guard_institution_permissions_immutable_grant
  before update on public.institution_permissions
  for each row
  execute function public.guard_institution_permissions_immutable_grant();


-- =====================================================================
-- 2. can_countersign_incident() -- the real spec, as a change to this
-- function's body and nothing else, exactly as 0073 set up. See the
-- FORWARD DEPENDENCY note above the header comment.
-- =====================================================================

create or replace function public.can_countersign_incident(p_user_id uuid, p_institution_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = p_user_id
      and s.role = 'principal'
      and inst.status = 'verified'
  )
  or exists (
    select 1 from public.institution_permissions p
    join public.institutions inst on inst.id = p.institution_id
    where p.institution_id = p_institution_id
      and p.user_id = p_user_id
      and p.permission = 'countersign_incident'
      and p.revoked_at is null
      and inst.status = 'verified'
  );
$$;


-- =====================================================================
-- 3. can_view_incident() -- principal branch now calls the same
-- function, so a granted DP sees what they're able to countersign.
-- =====================================================================

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
        public.can_countersign_incident(auth.uid(), i.institution_id)
        or i.created_by = auth.uid()
        or i.owning_teacher_id = auth.uid()
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
        or (
          i.status <> 'draft'
          and exists (
            select 1 from public.incident_staff st
            where st.incident_id = i.id and st.user_id = auth.uid()
          )
        )
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


-- =====================================================================
-- 4. get_institution_incidents() -- the principal's incident list, now
-- gated the same way. DROP first: CREATE OR REPLACE cannot change a
-- RETURNS TABLE column's shape, but here only the WHERE-clause gate
-- changes, so this is a like-for-like recreate, not a rename.
-- =====================================================================

drop function if exists public.get_institution_incidents(uuid, date, date, text, boolean);

create function public.get_institution_incidents(
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
  countersigned_at timestamptz,
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
    i.countersigned_at,
    exists (select 1 from public.restrictive_practices rp where rp.incident_id = i.id) as has_restrictive_practice,
    (select array_agg(rp.planning_status) from public.restrictive_practices rp where rp.incident_id = i.id) as planning_status,
    (select array_agg(rp.ncse_report_complete) from public.restrictive_practices rp where rp.incident_id = i.id) as ncse_report_complete
  from public.incidents i
  join public.incident_locations loc on loc.id = i.location_id
  left join auth.users u on u.id = i.owning_teacher_id
  where i.institution_id = p_institution_id
    and public.can_countersign_incident(auth.uid(), p_institution_id)
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


-- =====================================================================
-- 5. school_notices -- view and acknowledge, same widening.
-- =====================================================================

drop policy "Principal or incident owner can view school notices" on public.school_notices;
create policy "Principal or incident owner can view school notices"
  on public.school_notices for select to authenticated
  using (
    public.can_countersign_incident(auth.uid(), school_notices.institution_id)
    or exists (
      select 1 from public.incidents i
      where i.id = school_notices.incident_id
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  );

drop policy "Principal or incident owner can acknowledge a school notice" on public.school_notices;
create policy "Principal or incident owner can acknowledge a school notice"
  on public.school_notices for update to authenticated
  using (
    public.can_countersign_incident(auth.uid(), school_notices.institution_id)
    or exists (
      select 1 from public.incidents i
      where i.id = school_notices.incident_id
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  )
  with check (acknowledged_by = auth.uid());


-- =====================================================================
-- 6. incident_amendments -- decided explicitly this round: countersign
-- and amend are the same authority in practice, so this widens too.
-- The owning-teacher and clinician branches are untouched; only the
-- principal branch is replaced.
-- =====================================================================

drop policy if exists "Only those with real standing can add an amendment" on public.incident_amendments;
create policy "Only those with real standing can add an amendment"
  on public.incident_amendments for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.incidents i
      where i.id = incident_amendments.incident_id
        and (
          i.owning_teacher_id = auth.uid()
          or public.can_countersign_incident(auth.uid(), i.institution_id)
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
