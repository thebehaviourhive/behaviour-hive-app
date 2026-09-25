-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- A REAL, LIVE CROSS-INSTITUTION RECIPIENT LEAK -- found by Daniel
-- browser-testing PRD 11 Stage 5's own Handover feature (0302): a
-- respite care_staff composing a "Handover" message (allowed_sender_
-- roles ['centre_manager', 'care_staff'], respite-only) saw a wholly
-- unrelated CLINIC's own director in the "To:" list, and could send to
-- them -- because the same passport happens to also be linked to that
-- clinic (via onboard_clinic_client()), and get_message_recipient_
-- candidates(p_passport_id) has never taken the CALLER's own
-- institution into account at all.
--
-- READ THE LIVE DEFINITION FIRST, PER STANDING RULE: the live body
-- (0302) is one "authorized" gate (does the caller have SOME route to
-- this passport at all) followed by SIX candidate arms, each unioned
-- together with zero further scoping. Two of those arms --
-- "principal" (joins passport_institution_links to institution_staff
-- role='principal', no institution filter at all) and the new
-- "respite worker" arm (joins episodes_of_care to institution_staff
-- role in ('centre_manager','care_staff'), same shape) -- return
-- candidates from EVERY institution linked to the passport, not just
-- the one the calling user themselves belongs to. 'principal' is used
-- by BOTH schools and clinics (a clinic director is role='principal',
-- confirmed elsewhere in this schema's own migrations) -- so this is a
-- genuine cross-INSTITUTION-TYPE leak, not merely a cosmetic one: a
-- school class teacher composing an ordinary "Medication note" would
-- equally see (and could message) an unrelated linked clinic's
-- director, and vice versa. This is the exact boundary PRD 6/PRD 8
-- spend real effort keeping closed everywhere else in this schema
-- (session_notes, assessments, strategy_bank all gained explicit
-- institution-type/institution-id checks for the identical reason) --
-- messaging was never given the same treatment.
--
-- send_message() ITSELF NEEDS NO SEPARATE FIX. Read directly before
-- concluding that: its own recipient-role resolution already
-- delegates to get_message_recipient_candidates(p_passport_id) --
-- "select role from get_message_recipient_candidates(p_passport_id) c
-- where c.recipient_id = rid" -- and refuses the whole send if any
-- chosen recipient resolves to a null role ("not authorized
-- participants"). It never hand-rolls a second, parallel eligibility
-- check the way the SENDER-side role check does. Fixing the candidate
-- function closes BOTH the picker (what a sender is shown) and the
-- write path (a raw RPC call naming an out-of-scope recipient id
-- directly, bypassing the UI) in one place -- exactly this schema's
-- own "one function, not duplicated logic" precedent (send_message()'s
-- own staff-conversation path already works this way against
-- get_institution_staff_candidates(), which is properly p_institution_
-- id-scoped and was never affected by this bug).
--
-- THE FIX: every candidate arm that is INSTITUTION-MEMBERSHIP-based
-- (class_teacher via passport_access, class_teacher via class
-- assignment, sna, principal, respite worker) is now restricted to
-- institutions the CALLING USER also currently belongs to -- UNLESS
-- the caller reaches this passport via a route that is deliberately
-- cross-institution BY DESIGN: passport ownership (a parent needs full
-- reach across every institution involved with their own child,
-- unconditionally) or genuine, active clinician_access (the schema-
-- wide precedent -- PRD 8's own clinician-reads-school-incidents design
-- is the same principle -- that THIS SPECIFIC RELATIONSHIP, not mere
-- institution membership, is what legitimately crosses institution
-- boundaries). The "parent" candidate arm and the "clinician" candidate
-- arm are both left completely untouched -- neither was ever
-- institution-scoped and neither should be.
--
-- Applied to class_teacher/sna too, not just principal/respite, for
-- the same defense-in-depth reason this schema already applies
-- elsewhere (see CLAUDE.md's own "PERMISSIVE RLS POLICIES..." and
-- "WERE WRITABLE BY A SCHOOL..." entries): today's single-active-
-- enrolment constraint happens to make those two arms self-limiting in
-- practice, but "nothing today produces the wrong-shaped row" is
-- exactly the load-bearing assumption that let this bug sit
-- unnoticed for months. A CLINIC director or respite centre_manager
-- composing a message was equally able to see (and message) an
-- unrelated SCHOOL's class teacher/SNA before this fix, for the
-- identical reason -- confirmed by reading the pre-fix arms directly,
-- not assumed.
create or replace function public.get_message_recipient_candidates(p_passport_id uuid)
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
  with authorized as (
    select 1
    where
      public.owns_passport(p_passport_id)
      or exists (
        select 1 from public.passport_access pa
        join public.passport_institution_links pil
          on pil.passport_id = pa.passport_id and pil.institution_id = pa.institution_id
        where pa.passport_id = p_passport_id
          and pa.teacher_id = auth.uid()
          and pa.is_active = true
          and pa.actor_role = 'class_teacher'
      )
      or exists (
        select 1
        from public.class_children cc
        join public.classes c on c.id = cc.class_id
        join public.class_teachers ct on ct.class_id = c.id
        join public.institution_staff s on s.user_id = ct.user_id and s.institution_id = c.institution_id
        join public.passport_institution_links pil
          on pil.passport_id = cc.passport_id and pil.institution_id = c.institution_id
        where cc.passport_id = p_passport_id
          and cc.ended_at is null
          and ct.user_id = auth.uid()
          and ct.ended_at is null
          and s.deactivated_at is null
          and s.approved_at is not null
      )
      or (
        public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = p_passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
      )
      or (
        exists (
          select 1 from public.passport_institution_links pil
          join public.institution_staff s on s.institution_id = pil.institution_id
          where pil.passport_id = p_passport_id
            and s.user_id = auth.uid()
            and s.role = 'principal'
            and s.deactivated_at is null
            and s.approved_at is not null
        )
      )
      or public.has_sna_access(auth.uid(), p_passport_id)
      or exists (
        select 1 from public.institution_staff s
        where s.user_id = auth.uid()
          and s.role in ('centre_manager', 'care_staff')
          and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
          and exists (
            select 1 from public.respite_activations a
            where a.passport_id = p_passport_id
              and a.institution_id = s.institution_id
              and a.closed_at is null
          )
      )
  ),
  -- NEW. Every OTHER route into `authorized` above is institution-
  -- MEMBERSHIP-based and must stay scoped to the institution(s) the
  -- caller actually belongs to -- these two are the deliberate
  -- exceptions, matched byte-for-byte against `authorized`'s own
  -- parent/clinician branches so this can never silently drift out of
  -- sync with what `authorized` itself considers cross-institution.
  caller_is_cross_institution_by_design as (
    select 1
    where
      public.owns_passport(p_passport_id)
      or (
        public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = p_passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
      )
  ),
  candidates as (
    select g.user_id as recipient_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
           'parent'::text as role
    from authorized, public.passport_guardians g
    join auth.users u on u.id = g.user_id
    where g.passport_id = p_passport_id

    union all

    select pa.teacher_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           'class_teacher'
    from authorized, public.passport_access pa
    join public.passport_institution_links pil
      on pil.passport_id = pa.passport_id and pil.institution_id = pa.institution_id
    join auth.users u on u.id = pa.teacher_id
    where pa.passport_id = p_passport_id
      and pa.is_active = true
      and pa.actor_role = 'class_teacher'
      -- NEW: same institution as the caller, unless the caller reaches
      -- this passport via a deliberately cross-institution route.
      and (
        exists (select 1 from caller_is_cross_institution_by_design)
        or public.institution_staff_has_current_standing(auth.uid(), pil.institution_id)
      )

    union all

    select ct.user_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           'class_teacher'
    from authorized, public.class_children cc
    join public.classes c on c.id = cc.class_id
    join public.class_teachers ct on ct.class_id = c.id
    join public.institution_staff s on s.user_id = ct.user_id and s.institution_id = c.institution_id
    join public.passport_institution_links pil
      on pil.passport_id = cc.passport_id and pil.institution_id = c.institution_id
    join auth.users u on u.id = ct.user_id
    where cc.passport_id = p_passport_id
      and cc.ended_at is null
      and ct.ended_at is null
      and s.deactivated_at is null
      and s.approved_at is not null
      and not exists (
        select 1 from public.passport_access pa2
        where pa2.passport_id = p_passport_id
          and pa2.teacher_id = ct.user_id
          and pa2.is_active = true
          and pa2.actor_role = 'class_teacher'
      )
      -- NEW: same institution as the caller, unless cross-institution
      -- by design.
      and (
        exists (select 1 from caller_is_cross_institution_by_design)
        or public.institution_staff_has_current_standing(auth.uid(), c.institution_id)
      )

    union all

    select ca.clinician_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           'clinician'
    from authorized, public.clinician_access ca
    join auth.users u on u.id = ca.clinician_id
    where ca.passport_id = p_passport_id
      and ca.is_active = true
      and public.is_verified_clinician(ca.clinician_id)
    -- UNCHANGED: clinician_access is itself the genuine, schema-wide
    -- cross-institution-valid relationship. No institution filter here.

    union all

    select s.user_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           'principal'
    from authorized, public.passport_institution_links pil
    join public.institution_staff s on s.institution_id = pil.institution_id
    join auth.users u on u.id = s.user_id
    where pil.passport_id = p_passport_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      -- NEW: this is the confirmed leak -- 'principal' spans both
      -- school and clinic institution types, so without this, any
      -- institution-tied caller sees every OTHER institution's
      -- principal/director too, purely because both institutions
      -- happen to be linked to the same passport.
      and (
        exists (select 1 from caller_is_cross_institution_by_design)
        or public.institution_staff_has_current_standing(auth.uid(), pil.institution_id)
      )

    union all

    select s.user_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           'sna'
    from authorized, public.passport_institution_links pil
    join public.institution_staff s on s.institution_id = pil.institution_id
    join auth.users u on u.id = s.user_id
    where pil.passport_id = p_passport_id
      and s.role = 'sna'
      and s.deactivated_at is null
      and s.approved_at is not null
      and public.has_sna_access(s.user_id, p_passport_id)
      -- NEW: same institution as the caller, unless cross-institution
      -- by design.
      and (
        exists (select 1 from caller_is_cross_institution_by_design)
        or public.institution_staff_has_current_standing(auth.uid(), pil.institution_id)
      )

    union all

    -- Every OTHER current-standing centre_manager/care_staff at any
    -- respite institution with an ACTIVE placement. The candidate LIST
    -- is deliberately wider than who may currently read/send (matching
    -- every other candidate branch's own posture) -- send_message()'s
    -- own sender-side check is what enforces activation for SENDING.
    select s.user_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           s.role
    from authorized, public.episodes_of_care e
    join public.institution_staff s on s.institution_id = e.institution_id
    join auth.users u on u.id = s.user_id
    where e.passport_id = p_passport_id
      and e.ended_at is null
      and s.role in ('centre_manager', 'care_staff')
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
      -- NEW: the second confirmed leak -- without this, a caller at
      -- ONE respite centre linked to this passport would see (and
      -- could message) staff at a DIFFERENT, unrelated respite centre
      -- also linked to it, purely because episodes_of_care allows more
      -- than one active placement at different institutions for the
      -- same child.
      and (
        exists (select 1 from caller_is_cross_institution_by_design)
        or public.institution_staff_has_current_standing(auth.uid(), e.institution_id)
      )
  )
  select recipient_id, full_name, role
  from candidates
  where recipient_id <> auth.uid();
$$;

grant execute on function public.get_message_recipient_candidates(uuid) to authenticated;
