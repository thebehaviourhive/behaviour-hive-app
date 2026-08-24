/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SCHOOL INCIDENT LOG -- two fixes found during Phase 1's adversarial
   verification, both confirmed live before this migration was written
   (not theorized):

   =====================================================================
   FIX 1 -- create_incident_stamp(): atomic stage-one creation.
   =====================================================================
   The .select()-chained-onto-insert bug reported after the first
   verification run has a root cause deeper than the immediate fix
   (generating the id client-side) addressed: incident VISIBILITY itself
   derives from incident_children (can_view_incident's non-creator/
   non-principal branches all join through it), so a plain multi-step
   client flow -- insert incidents, then insert incident_children, then
   insert incident_staff, as three separate round trips -- has a real
   window where the incidents row exists with ZERO children. That's not
   just an RLS technicality; it's a broken legal record, and it can
   happen at exactly the moment (a phone, mid-crisis, a dropped
   connection) where an interrupted save is most likely.

   create_incident_stamp() makes that structurally impossible: one
   SECURITY DEFINER call inserts the incident, every named child, and
   every named staff member in a single transaction, or none of it
   commits. Phase 3's stage-one screen calls this, not three separate
   .insert() calls.

   Since this RPC is now the ONLY way to create an incident (it bypasses
   RLS internally, the way every SECURITY DEFINER function in this
   schema does), the old direct-INSERT policy on incidents is dropped
   entirely, not left in place as a redundant second path -- a row
   that's never reachable by any policy can never be created directly by
   a client no matter what future code does, which is what "structurally
   impossible" actually requires, not just "the RPC happens to be what
   Phase 3 will call."

   Institution is a required parameter, not derived by guessing at the
   caller's "the" institution -- a user who's staff at more than one
   institution (part-time across two schools, say) would make a
   guessed lookup ambiguous; the caller already knows which institution
   it's operating in from its own session context, so it's asked for
   explicitly and then verified server-side that the caller genuinely
   has standing there.

   Each named child must already have a passport_institution_links row
   for this institution (any row -- approved or not; decision 1 already
   established no approval requirement for school-side access, but SOME
   link is still the only signal this schema has for "is this child
   actually connected to this school at all" -- without that check, any
   passport_id in the whole system could be named on an incident at a
   school it has zero relationship to).

   =====================================================================
   FIX 2 -- the owning-teacher boundary was not actually enforced.
   =====================================================================
   Confirmed live, before writing this fix: an SNA who creates a stamp
   (created_by = their own uid) could ALSO edit stage-two fields
   (narrative, category, ...) and even set teacher_signed_at themselves
   -- the "Creator or owning teacher can edit before teacher sign-off"
   policy never checked role, only created_by/owning_teacher_id
   equality. That directly contradicts the brief's own four-queues
   table, which reserves stage two and sign-off for "Owning teacher"
   specifically -- a role this app's existing model already treats as
   meaningfully different from (and lesser-authority than) class_teacher
   ("support specific children alongside their class teacher").

   The fix is not just adding a role check to that one policy -- every
   stage-two write surface (incident_children, incident_staff,
   incident_actions, restrictive_practices, incident_injuries,
   incident_body_marks, and incident_amendments) had the SAME
   "created_by OR owning_teacher_id" shape, so all of them would have let
   an SNA-creator keep substantively completing stage two (adding
   injuries, restraint details, actions) even with the main incidents
   row itself locked down. All of them are tightened the same way here:
   the "OR created_by" branch is removed, leaving only owning_teacher_id
   as the write authority once the incident exists. incident_debriefs
   already had this right from Phase 1 (owning_teacher_id only, no
   created_by branch) -- confirmed by re-reading it, not touched here.

   That raises the obvious next question: if the creator's rights are
   now this narrow, how does owning_teacher_id ever get set for an
   incident an SNA (or principal, per J5) created? Two paths:
     - create_incident_stamp() auto-assigns owning_teacher_id to the
       caller when the caller's own role is class_teacher -- the common
       case (a class teacher stamps their own incident and continues
       straight into stage two) needs no extra step.
     - claim_incident(), a new narrow RPC below, for the case a class
       teacher needs to pick up a stamp someone else (an SNA, or a
       principal per J5) created. Restricted to class_teacher role,
       requires owning_teacher_id currently null and not yet
       teacher-signed, sets it to the caller only -- never assigns
       someone else, which would be a real reassignment feature this
       fix does not attempt to build.

   The main incidents UPDATE policy additionally re-checks the caller's
   role is class_teacher at the point of edit, not just relying on the
   invariant that owning_teacher_id can only ever have been assigned to
   one -- defense in depth on the single highest-stakes row in this
   schema, matching the same posture Phase 1 already took with the
   immutability trigger. The child-table policies below do not repeat
   that redundant role check -- owning_teacher_id = auth.uid() alone is
   enough there, since the invariant is enforced once, correctly, at the
   two places that ever assign it. */


-- =====================================================================
-- PART 1 -- incidents: drop the direct-INSERT policy. All creation now
-- goes through create_incident_stamp() below.
-- =====================================================================

drop policy if exists "School staff can create an incident for their institution" on public.incidents;


-- =====================================================================
-- PART 2 -- incidents: replace the creator-inclusive UPDATE policy with
-- an owning-teacher-only one, role-checked.
-- =====================================================================

drop policy if exists "Creator or owning teacher can edit before teacher sign-off" on public.incidents;

create policy "Owning teacher can edit before teacher sign-off"
  on public.incidents for update to authenticated
  using (
    teacher_signed_at is null
    and owning_teacher_id = auth.uid()
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = incidents.institution_id
        and s.user_id = auth.uid()
        and s.role = 'class_teacher'
    )
  )
  with check (
    owning_teacher_id = auth.uid()
  );

-- The principal-countersign policy from Phase 1 is untouched -- it never
-- referenced created_by and needs no change.


-- =====================================================================
-- PART 3 -- child-table policies: remove the "OR created_by" branch.
-- Same before/after shape repeated for each table -- drop, recreate
-- identical except for that one condition.
-- =====================================================================

-- incident_children
drop policy if exists "Creator or owning teacher can add children before sign-off" on public.incident_children;
create policy "Owning teacher can add children before sign-off"
  on public.incident_children for insert to authenticated
  with check (
    added_by = auth.uid()
    and exists (
      select 1 from public.incidents i
      where i.id = incident_children.incident_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  );

drop policy if exists "Creator or owning teacher can edit children before sign-off" on public.incident_children;
create policy "Owning teacher can edit children before sign-off"
  on public.incident_children for update to authenticated
  using (
    exists (
      select 1 from public.incidents i
      where i.id = incident_children.incident_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.incidents i
      where i.id = incident_children.incident_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  );

drop policy if exists "Creator or owning teacher can remove children before sign-off" on public.incident_children;
create policy "Owning teacher can remove children before sign-off"
  on public.incident_children for delete to authenticated
  using (
    exists (
      select 1 from public.incidents i
      where i.id = incident_children.incident_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  );

-- incident_staff (the "Named staff can attest to their own row" policy
-- is untouched -- it's a completely different authority, unrelated to
-- this fix).
drop policy if exists "Creator or owning teacher can name staff before sign-off" on public.incident_staff;
create policy "Owning teacher can name staff before sign-off"
  on public.incident_staff for insert to authenticated
  with check (
    exists (
      select 1 from public.incidents i
      where i.id = incident_staff.incident_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  );

drop policy if exists "Creator or owning teacher can edit staff entries before sign-off" on public.incident_staff;
create policy "Owning teacher can edit staff entries before sign-off"
  on public.incident_staff for update to authenticated
  using (
    exists (
      select 1 from public.incidents i
      where i.id = incident_staff.incident_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.incidents i
      where i.id = incident_staff.incident_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  );

drop policy if exists "Creator or owning teacher can remove staff entries before sign-off" on public.incident_staff;
create policy "Owning teacher can remove staff entries before sign-off"
  on public.incident_staff for delete to authenticated
  using (
    exists (
      select 1 from public.incidents i
      where i.id = incident_staff.incident_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  );

-- incident_actions
drop policy if exists "Creator or owning teacher can select actions before sign-off" on public.incident_actions;
create policy "Owning teacher can select actions before sign-off"
  on public.incident_actions for insert to authenticated
  with check (
    exists (
      select 1 from public.incidents i
      where i.id = incident_actions.incident_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  );

drop policy if exists "Creator or owning teacher can deselect actions before sign-off" on public.incident_actions;
create policy "Owning teacher can deselect actions before sign-off"
  on public.incident_actions for delete to authenticated
  using (
    exists (
      select 1 from public.incidents i
      where i.id = incident_actions.incident_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  );

-- restrictive_practices
drop policy if exists "Creator or owning teacher can record restrictive practice before sign-off" on public.restrictive_practices;
create policy "Owning teacher can record restrictive practice before sign-off"
  on public.restrictive_practices for insert to authenticated
  with check (
    exists (
      select 1 from public.incidents i
      where i.id = restrictive_practices.incident_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  );

drop policy if exists "Creator or owning teacher can edit restrictive practice before sign-off" on public.restrictive_practices;
create policy "Owning teacher can edit restrictive practice before sign-off"
  on public.restrictive_practices for update to authenticated
  using (
    exists (
      select 1 from public.incidents i
      where i.id = restrictive_practices.incident_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.incidents i
      where i.id = restrictive_practices.incident_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  );

-- incident_injuries
drop policy if exists "Creator or owning teacher can record injuries before sign-off" on public.incident_injuries;
create policy "Owning teacher can record injuries before sign-off"
  on public.incident_injuries for insert to authenticated
  with check (
    exists (
      select 1 from public.incidents i
      where i.id = incident_injuries.incident_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  );

drop policy if exists "Creator or owning teacher can edit injuries before sign-off" on public.incident_injuries;
create policy "Owning teacher can edit injuries before sign-off"
  on public.incident_injuries for update to authenticated
  using (
    exists (
      select 1 from public.incidents i
      where i.id = incident_injuries.incident_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.incidents i
      where i.id = incident_injuries.incident_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  );

drop policy if exists "Creator or owning teacher can remove injuries before sign-off" on public.incident_injuries;
create policy "Owning teacher can remove injuries before sign-off"
  on public.incident_injuries for delete to authenticated
  using (
    exists (
      select 1 from public.incidents i
      where i.id = incident_injuries.incident_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  );

-- incident_body_marks
drop policy if exists "Creator or owning teacher can place markers before sign-off" on public.incident_body_marks;
create policy "Owning teacher can place markers before sign-off"
  on public.incident_body_marks for insert to authenticated
  with check (
    exists (
      select 1 from public.incident_injuries ii
      join public.incidents i on i.id = ii.incident_id
      where ii.id = incident_body_marks.injury_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  );

drop policy if exists "Creator or owning teacher can edit markers before sign-off" on public.incident_body_marks;
create policy "Owning teacher can edit markers before sign-off"
  on public.incident_body_marks for update to authenticated
  using (
    exists (
      select 1 from public.incident_injuries ii
      join public.incidents i on i.id = ii.incident_id
      where ii.id = incident_body_marks.injury_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.incident_injuries ii
      join public.incidents i on i.id = ii.incident_id
      where ii.id = incident_body_marks.injury_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  );

drop policy if exists "Creator or owning teacher can remove markers before sign-off" on public.incident_body_marks;
create policy "Owning teacher can remove markers before sign-off"
  on public.incident_body_marks for delete to authenticated
  using (
    exists (
      select 1 from public.incident_injuries ii
      join public.incidents i on i.id = ii.incident_id
      where ii.id = incident_body_marks.injury_id
        and i.teacher_signed_at is null
        and i.owning_teacher_id = auth.uid()
    )
  );

-- incident_amendments -- same tightening, applied to its INSERT policy's
-- first branch only; the principal and clinician branches are untouched.
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
-- PART 4 -- create_incident_stamp(): atomic stage-one creation.
-- =====================================================================

create or replace function public.create_incident_stamp(
  p_institution_id uuid,
  p_occurred_at timestamptz,
  p_location_id uuid,
  p_child_passport_ids uuid[],
  p_staff jsonb  -- array of {"user_id": uuid} or {"free_text_name": text}, optional "involvement" (defaults 'involved')
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_incident_id uuid;
  v_child_count integer;
  v_child_index text;
  v_passport_id uuid;
  v_i integer;
  v_staff_entry jsonb;
  v_user_id uuid;
  v_free_text_name text;
  v_involvement text;
begin
  -- The caller must be genuine, actively-registered school staff at
  -- EXACTLY the institution they claim -- not derived by guessing,
  -- confirmed by explicit lookup, per this file's own header note on
  -- why the institution is a required parameter rather than inferred.
  select role into v_caller_role
  from public.institution_staff
  where institution_id = p_institution_id and user_id = auth.uid();

  if v_caller_role is null or v_caller_role not in ('class_teacher', 'sna', 'principal') then
    raise exception 'You are not registered as school staff at this institution.';
  end if;

  if p_child_passport_ids is null or array_length(p_child_passport_ids, 1) is null or array_length(p_child_passport_ids, 1) = 0 then
    raise exception 'At least one child is required.';
  end if;
  v_child_count := array_length(p_child_passport_ids, 1);
  if v_child_count > 2 then
    raise exception 'An incident can name at most two children.';
  end if;

  v_incident_id := gen_random_uuid();

  -- Auto-assign owning_teacher_id when the caller is themselves a
  -- class_teacher -- the common case (a class teacher stamps their own
  -- incident and continues straight into stage two) needs no separate
  -- claim step. An sna or principal creating the stamp leaves it
  -- unassigned; claim_incident() below is how a class teacher picks it
  -- up afterward.
  insert into public.incidents (id, institution_id, created_by, owning_teacher_id, occurred_at, location_id)
  values (
    v_incident_id, p_institution_id, auth.uid(),
    case when v_caller_role = 'class_teacher' then auth.uid() else null end,
    p_occurred_at, p_location_id
  );

  v_i := 0;
  foreach v_passport_id in array p_child_passport_ids
  loop
    if not exists (
      select 1 from public.passport_institution_links pil
      where pil.passport_id = v_passport_id and pil.institution_id = p_institution_id
    ) then
      raise exception 'Child % is not connected to this institution.', v_passport_id;
    end if;

    v_child_index := case when v_i = 0 then 'A' else 'B' end;
    insert into public.incident_children (incident_id, passport_id, child_index, added_by)
    values (v_incident_id, v_passport_id, v_child_index, auth.uid());
    v_i := v_i + 1;
  end loop;

  if p_staff is not null then
    for v_staff_entry in select * from jsonb_array_elements(p_staff)
    loop
      v_user_id := nullif(v_staff_entry ->> 'user_id', '')::uuid;
      v_free_text_name := nullif(v_staff_entry ->> 'free_text_name', '');
      v_involvement := coalesce(nullif(v_staff_entry ->> 'involvement', ''), 'involved');

      if v_user_id is null and v_free_text_name is null then
        raise exception 'Each staff entry needs either user_id or free_text_name.';
      end if;
      if v_involvement not in ('involved', 'witnessed') then
        raise exception 'Invalid involvement value: %', v_involvement;
      end if;

      insert into public.incident_staff (incident_id, user_id, free_text_name, involvement)
      values (v_incident_id, v_user_id, v_free_text_name, v_involvement);
    end loop;
  end if;

  return v_incident_id;
end;
$$;

grant execute on function public.create_incident_stamp(uuid, timestamptz, uuid, uuid[], jsonb) to authenticated;


-- =====================================================================
-- PART 5 -- claim_incident(): a class teacher picks up an sna- or
-- principal-created stamp.
-- =====================================================================

create or replace function public.claim_incident(p_incident_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_institution_id uuid;
begin
  select institution_id into v_institution_id
  from public.incidents
  where id = p_incident_id and owning_teacher_id is null and teacher_signed_at is null;

  if v_institution_id is null then
    raise exception 'This incident cannot be claimed -- it may already have an owning teacher, be signed off, or not exist.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    where s.institution_id = v_institution_id and s.user_id = auth.uid() and s.role = 'class_teacher'
  ) then
    raise exception 'Only a class teacher at this institution can claim an incident.';
  end if;

  update public.incidents set owning_teacher_id = auth.uid() where id = p_incident_id;
end;
$$;

grant execute on function public.claim_incident(uuid) to authenticated;
