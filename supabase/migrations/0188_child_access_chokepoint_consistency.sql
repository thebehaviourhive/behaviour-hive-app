-- Class-derived access consistency pass -- QA run-through, 15 Sept 2026.
--
-- has_child_access(user, passport) = has_class_teacher_access() OR
-- has_sna_access(). Both primitives (live definitions: 0130, 0133) have
-- FOUR branches each: an explicit passport_access grant, class-roster-
-- derived, a full-tier class SNA (class_sna_assignments), and -- SNA
-- only -- a covering/temporary grant (temporary_access). Because they
-- call each other by name and CREATE OR REPLACE resolves at execution
-- time, anything that calls has_child_access() gets every branch,
-- including ones added after it was written. Anything that hand-copies
-- the branch logic instead does not -- it's frozen at whatever
-- has_child_access() covered on the day it was written.
--
-- Two groups, found by enumerating every function/policy/client query
-- that mentions passport_access (reported in chat before this migration
-- was written):
--
-- GROUP A -- two functions nobody ever converted. request_passport_
-- completion() and request_passport_home_profile() (0185, 0141) both
-- checked passport_access with a bare EXISTS instead of calling
-- has_child_access() -- the exact bug reported live: a class-derived
-- teacher refused with "you need access to this child's passport".
-- Mechanical swap, same signatures, same error text.
--
-- GROUP B -- four functions that LOOK converted (RLS was fixed
-- schema-wide in 0104's own wave) but hand-copied has_child_access()'s
-- branch logic into a read-model/enumeration query instead of calling
-- it, and have silently fallen behind as the primitives grew branches
-- (class_sna_assignments in 0129/0130, temporary_access in 0105):
--   get_my_accessible_children (0148) -- missing individual
--     child_assignments SNA and temporary_access covering SNA.
--   get_passport_team (0104) -- missing class_sna_assignments and
--     temporary_access.
--   get_fba_recipient_candidates (0113) -- same two branches missing.
--   get_teacher_activity_feed (0155) -- split personality: its incident
--     rows already call has_child_access() and are correct; its
--     activity_log rows are hand-rolled and are not. Same function, two
--     standards -- the clearest example of why this drifts.
-- Fixed by removing the reason each one COULD miss a branch, not by
-- adding the branches they happen to be missing today: each now
-- resolves its candidate set from institution_staff/institution roster
-- (bounded, efficient) and gates inclusion with has_child_access() (or
-- the specific primitive, where a per-branch label is genuinely
-- needed) as the one and only authority. The next branch has_child_
-- access() gains reaches all four with zero further changes.
--
-- get_staff_deactivation_preview (0164) is the same shape but a
-- different severity: it's a read-only preview, not an access gate, so
-- the old bug never blocked anyone -- it just under-reported the
-- impact of deactivating a class-derived teacher/SNA to the principal
-- about to do it. Fixed the same way (candidate + has_child_access()),
-- named honestly: the whole point of that screen is seeing the real
-- impact before an irreversible action, so under-reporting it was a
-- real defect, just not a blocking one.
--
-- NOT included here, deliberately: get_message_recipient_candidates
-- (0162) has no SNA branch at all, and send_message (0169)'s child-
-- conversation sender-role resolution stops at class_teachers. Both are
-- the parked "SNA messaging about a child" product decision, now
-- decided (SNAs get it) but scoped as its own piece after this one --
-- it needs message_categories.allowed_sender_roles work too, and mixing
-- a product change into an access-consistency pass is how one hides
-- inside the other.

-- =====================================================================
-- GROUP A
-- =====================================================================

create or replace function public.request_passport_completion(
  p_passport_id uuid,
  p_institution_id uuid,
  p_target_section text default 'a'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if p_target_section not in ('a', 'e') then
    raise exception 'Unknown section.';
  end if;

  if not public.institution_staff_has_current_standing(auth.uid(), p_institution_id) then
    raise exception 'Only an active member of staff at this school can request this.';
  end if;

  if not public.has_child_access(auth.uid(), p_passport_id) then
    raise exception 'You need access to this child''s passport before you can request this.';
  end if;

  if not exists (
    select 1 from public.passport_guardians g where g.passport_id = p_passport_id
  ) then
    raise exception 'This child has no guardian to notify yet.';
  end if;

  insert into public.passport_completion_requests (
    passport_id, institution_id, requested_by, recipient_id, target_section
  )
  select p_passport_id, p_institution_id, auth.uid(), g.user_id, p_target_section
  from public.passport_guardians g
  where g.passport_id = p_passport_id
    and not exists (
      select 1 from public.passport_completion_requests r
      where r.passport_id = p_passport_id
        and r.recipient_id = g.user_id
        and r.target_section = p_target_section
    );

  get diagnostics v_created = row_count;

  if v_created = 0 then
    raise exception 'This has already been requested from every current guardian on this passport.';
  end if;

  return v_created;
end;
$$;

grant execute on function public.request_passport_completion(uuid, uuid, text) to authenticated;

create or replace function public.request_passport_home_profile(
  p_passport_id uuid,
  p_institution_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.institution_staff_has_current_standing(auth.uid(), p_institution_id) then
    raise exception 'Only an active member of staff at this school can request a home profile.';
  end if;

  if not public.has_child_access(auth.uid(), p_passport_id) then
    raise exception 'You need access to this child''s passport before you can request a home profile.';
  end if;

  if not exists (
    select 1 from public.passport_guardians g where g.passport_id = p_passport_id
  ) then
    raise exception 'This child has no guardian to notify yet.';
  end if;

  insert into public.passport_home_profile_requests (
    passport_id, institution_id, requested_by, recipient_id
  )
  select p_passport_id, p_institution_id, auth.uid(), g.user_id
  from public.passport_guardians g
  where g.passport_id = p_passport_id
    and not exists (
      select 1 from public.passport_home_profile_requests r
      where r.passport_id = p_passport_id
        and r.recipient_id = g.user_id
    );

  get diagnostics v_created = row_count;

  if v_created = 0 then
    raise exception 'A home profile has already been requested from every current guardian on this passport.';
  end if;

  return v_created;
end;
$$;

grant execute on function public.request_passport_home_profile(uuid, uuid) to authenticated;

-- =====================================================================
-- GROUP B -- the four unambiguous ones
-- =====================================================================

-- get_my_accessible_children() -- candidate set is every passport
-- linked to an institution the caller currently staffs (bounded,
-- efficient); has_child_access() is the sole gate. access_source is
-- derived by calling the SPECIFIC primitives (has_class_teacher_access/
-- has_sna_access), not by re-deriving from raw joins -- so a role
-- label can never disagree with the gate that admitted the row.
-- access_source's third value changes from 'class_sna' to 'sna' (the
-- old value distinguished the MECHANISM; this distinguishes the TIER,
-- which is what the type's only other reader, useSnaChildren.ts's own
-- isTemporary/isAssigned flags, already does) -- confirmed unused for
-- display anywhere in the client today (grep: accessSource is read
-- nowhere outside useTeacherPassports.ts itself), so this is a safe
-- rename, not a breaking one. See useTeacherPassports.ts for the
-- matching type update.
create or replace function public.get_my_accessible_children()
returns table (
  passport_id uuid,
  child_name text,
  diagnoses text[],
  diagnosis_other text,
  access_source text,
  source_detail text
)
language sql
security definer
set search_path = public
stable
as $$
  with candidates as (
    select distinct
      p.id as passport_id,
      p.child_name,
      p.diagnoses,
      p.diagnosis_other,
      c.name as class_name
    from public.institution_staff s
    join public.passport_institution_links pil on pil.institution_id = s.institution_id
    join public.passports p on p.id = pil.passport_id
    left join public.class_children cc on cc.passport_id = p.id and cc.ended_at is null
    left join public.classes c on c.id = cc.class_id
    where s.user_id = auth.uid()
      and s.deactivated_at is null
      and s.approved_at is not null
  )
  select
    cand.passport_id,
    cand.child_name,
    cand.diagnoses,
    cand.diagnosis_other,
    case
      when public.has_class_teacher_access(auth.uid(), cand.passport_id) then 'class_teacher'
      when public.has_sna_access(auth.uid(), cand.passport_id) then 'sna'
      else 'direct_grant'
    end as access_source,
    cand.class_name as source_detail
  from candidates cand
  where public.has_child_access(auth.uid(), cand.passport_id)
  order by cand.child_name;
$$;

grant execute on function public.get_my_accessible_children() to authenticated;

-- get_passport_team() -- same pattern: candidate is every active member
-- of staff at this passport's own institution(s), has_child_access() is
-- the sole gate, role comes straight from institution_staff.role (the
-- person's actual job, not an inference from which branch matched --
-- simpler and more honest than the old per-branch role labelling, and
-- it already correctly returns 'sna' with no client-side change needed,
-- confirmed by reading YourTeamCard.tsx's own ROLE_LABEL map). linked_at
-- is best-effort provenance only (confirmed unused by the one caller,
-- YourTeamCard.tsx, today) -- never the access decision.
create or replace function public.get_passport_team(p_passport_id uuid)
returns table (
  teacher_id uuid,
  full_name text,
  role text,
  linked_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.user_id as teacher_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    s.role,
    coalesce(pa.linked_at, ct.started_at, csa.started_at, ca2.started_at, ta.created_at) as linked_at
  from public.institution_staff s
  join public.passport_institution_links pil on pil.institution_id = s.institution_id
  join auth.users u on u.id = s.user_id
  left join public.passport_access pa
    on pa.passport_id = p_passport_id and pa.teacher_id = s.user_id and pa.is_active = true
  left join public.class_children cc on cc.passport_id = p_passport_id and cc.ended_at is null
  left join public.class_teachers ct
    on ct.class_id = cc.class_id and ct.user_id = s.user_id and ct.ended_at is null
  left join public.class_sna_assignments csa
    on csa.class_id = cc.class_id and csa.user_id = s.user_id and csa.ended_at is null
  left join public.child_assignments ca2
    on ca2.passport_id = p_passport_id and ca2.user_id = s.user_id and ca2.ended_at is null
  left join public.temporary_access ta
    on ta.granted_to = s.user_id
    and ta.institution_id = s.institution_id
    and ta.class_id = cc.class_id
    and ta.revoked_at is null
  where pil.passport_id = p_passport_id
    and s.deactivated_at is null
    and s.approved_at is not null
    and public.owns_passport(p_passport_id)
    and public.has_child_access(s.user_id, p_passport_id)

  union all

  select
    ca.clinician_id as teacher_id,
    coalesce(c.full_name, u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    'clinician' as role,
    ca.linked_at
  from public.clinician_access ca
  join auth.users u on u.id = ca.clinician_id
  left join public.clinicians c on c.user_id = ca.clinician_id
  where ca.passport_id = p_passport_id
    and ca.is_active = true
    and coalesce(c.verification_status, '') = 'verified'
    and public.owns_passport(p_passport_id);
$$;

grant execute on function public.get_passport_team(uuid) to authenticated;

-- get_fba_recipient_candidates() -- same pattern: candidate is every
-- active member of staff at the FBA's own institution, has_child_
-- access() is the sole gate, role comes from institution_staff.role
-- directly. This now returns 'sna' rows on the has_sna_access() branch
-- it was previously missing (class_sna_assignments, temporary_access) --
-- see the companion client fix in src/lib/fba/types.ts (RecipientRole
-- widened to include 'sna'; it was silently missing that value even for
-- the child_assignments-derived 'sna' rows this function ALREADY
-- returned before today, a separate small pre-existing gap fixed
-- alongside this one since it's directly downstream of the same rows).
create or replace function public.get_fba_recipient_candidates(p_fba_id uuid)
returns table (
  recipient_id uuid,
  full_name text,
  role text
)
language sql
security definer
set search_path = public
stable
as $$
  with authorized_fba as (
    select fr.id, fr.passport_id
    from public.fba_reports fr
    join public.clinician_access ca on ca.passport_id = fr.passport_id
    where fr.id = p_fba_id
      and fr.clinician_id = auth.uid()
      and ca.clinician_id = auth.uid()
      and ca.is_active = true
      and public.is_verified_clinician(auth.uid())
  )
  select
    g.user_id as recipient_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    'parent' as role
  from authorized_fba af
  join public.passport_guardians g on g.passport_id = af.passport_id
  join auth.users u on u.id = g.user_id

  union all

  select
    s.user_id as recipient_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    s.role as role
  from authorized_fba af
  join public.passport_institution_links pil on pil.passport_id = af.passport_id
  join public.institution_staff s on s.institution_id = pil.institution_id
  join auth.users u on u.id = s.user_id
  where s.deactivated_at is null
    and s.approved_at is not null
    and public.has_child_access(s.user_id, af.passport_id);
$$;

grant execute on function public.get_fba_recipient_candidates(uuid) to authenticated;

-- get_teacher_activity_feed() -- targeted fix, not a restructure: the
-- incident branch already calls has_child_access() and stays
-- untouched; only the activity_log branch's hand-rolled triple-EXISTS
-- (passport_access, class_teachers, class_sna_assignments -- missing
-- child_assignments and temporary_access) is replaced with the same
-- has_child_access() call the incident branch already uses. Same
-- function, one standard now, not two. p_limit/p_offset and the
-- support_alerts branch are unchanged.
create or replace function public.get_teacher_activity_feed(
  p_limit integer default 20, p_offset integer default 0
)
returns table (
  id uuid, passport_id uuid, child_name text, event_type text,
  event_description text, created_at timestamptz, incident_id uuid
)
language sql
security definer
set search_path = public
stable
as $$
  select * from (
    select al.id, al.passport_id, p.child_name, al.event_type, al.event_description, al.created_at,
      null::uuid as incident_id
    from public.activity_log al
    join public.passports p on p.id = al.passport_id
    where public.has_child_access(auth.uid(), al.passport_id)
      and al.event_type in (
        'passport_updated', 'abc_logged', 'team_linked', 'strategy_logged',
        'access_revoked', 'afternoon_update', 'clinical_content_added'
      )
      and (al.event_type <> 'abc_logged' or al.actor_id = auth.uid())
      and not exists (
        select 1 from public.clinicians c where c.user_id = al.actor_id
      )

    union all

    -- Incidents -- exactly can_view_incident()'s own child branch
    -- (0104): status <> 'draft' and has_child_access() on the child.
    select ic.id, ic.passport_id, p.child_name, 'incident'::text, 'An incident was recorded.'::text,
      i.occurred_at, i.id as incident_id
    from public.incident_children ic
    join public.incidents i on i.id = ic.incident_id
    join public.passports p on p.id = ic.passport_id
    where i.status <> 'draft'
      and public.has_child_access(auth.uid(), ic.passport_id)

    union all

    -- Support alerts -- institution-wide, not per-child (passport_id/
    -- child_name null, same as the parent activity feed's own
    -- non-incident rows). Same audience support_alerts' own RLS SELECT
    -- policy already grants: any active institution_staff member at
    -- this alert's school.
    select
      sa.id, null::uuid, null::text, 'support_alert'::text,
      'Support Requested'
        || case when array_length(sa.room_names, 1) > 0 then ' - ' || array_to_string(sa.room_names, ', ') else '' end
        || case
             when sa.closed_at is null then ''
             when sa.is_likely_mistap then ' - cancelled'
             else ' - resolved'
           end,
      sa.raised_at, null::uuid
    from public.support_alerts sa
    where exists (
      select 1 from public.institution_staff s
      where s.institution_id = sa.institution_id
        and s.user_id = auth.uid()
        and s.deactivated_at is null
        and s.approved_at is not null
    )
  ) combined
  order by created_at desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.get_teacher_activity_feed(integer, integer) to authenticated;

-- =====================================================================
-- get_staff_deactivation_preview() -- lower severity (informational,
-- not a gate), fixed the same way: named honestly in the header
-- comment above, not soft-pedalled as cosmetic.
-- =====================================================================
create or replace function public.get_staff_deactivation_preview(p_institution_staff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.institution_staff;
  v_caller_is_active_principal boolean;
  v_unsigned_incidents jsonb;
  v_outstanding_attestations jsonb;
  v_active_children jsonb;
begin
  select * into v_target from public.institution_staff where id = p_institution_staff_id;
  if not found then
    raise exception 'Staff member not found.';
  end if;

  select exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.user_id = auth.uid()
      and s.institution_id = v_target.institution_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) into v_caller_is_active_principal;

  if not v_caller_is_active_principal then
    raise exception 'Only an active principal at this institution can preview this.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'incident_id', i.id, 'occurred_at', i.occurred_at, 'status', i.status
  ) order by i.occurred_at), '[]'::jsonb)
  into v_unsigned_incidents
  from public.incidents i
  where i.institution_id = v_target.institution_id
    and i.owning_teacher_id = v_target.user_id
    and i.teacher_signed_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'incident_id', i.id, 'occurred_at', i.occurred_at
  ) order by i.occurred_at), '[]'::jsonb)
  into v_outstanding_attestations
  from public.incident_staff st
  join public.incidents i on i.id = st.incident_id
  where i.institution_id = v_target.institution_id
    and st.user_id = v_target.user_id
    and st.user_id is distinct from i.owning_teacher_id
    and public.get_attestation_status(st.id) = 'not_attested';

  -- FIX (this migration): was `passport_access pa where pa.institution_id
  -- = v_target.institution_id and pa.teacher_id = v_target.user_id and
  -- pa.is_active = true` -- explicit grants only, so a principal
  -- deactivating a class-derived teacher or SNA was shown an
  -- undercounted, sometimes-empty impact list right before an
  -- irreversible action. Candidate is now every passport linked to
  -- v_target's own institution, has_child_access(v_target.user_id, ...)
  -- is the sole gate -- matching what actually stops working the
  -- moment institution_staff.deactivated_at is set.
  select coalesce(jsonb_agg(jsonb_build_object(
    'passport_id', p.id, 'child_name', p.child_name
  ) order by p.child_name), '[]'::jsonb)
  into v_active_children
  from public.passport_institution_links pil
  join public.passports p on p.id = pil.passport_id
  where pil.institution_id = v_target.institution_id
    and public.has_child_access(v_target.user_id, p.id);

  return jsonb_build_object(
    'unsigned_incidents', v_unsigned_incidents,
    'outstanding_attestations', v_outstanding_attestations,
    'active_children', v_active_children
  );
end;
$$;

grant execute on function public.get_staff_deactivation_preview(uuid) to authenticated;
