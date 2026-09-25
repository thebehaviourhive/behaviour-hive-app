-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- THE CENTRE_MANAGER DASHBOARD BUILD, 25 Sept 2026. Found live, by this
-- build's own verification pass, not by review: a real centre_manager
-- opening the real "Write a handover" sheet on a respite-only child's
-- record saw "phone the school" -- ComposeMessageSheet.tsx's own two-
-- way institutionType ternary was fixed in the same pass (client-only,
-- no migration needed for that half), but the copy STILL read "school"
-- after that fix, because the underlying vocabulary resolution never
-- reached "respite_centre" in the first place.
--
-- get_passport_institution_vocabulary() (0201, PRD 5 Stage 1) predates
-- respite_centre as a concept entirely (0296, PRD 11 Stage 2) and was
-- never widened when it shipped -- confirmed by grep, this is still
-- the only definition. Its own caller-authorization gate has a real
-- branch for a parent (owns_passport), a school staff member with
-- class-derived access (has_child_access), an engaged clinician, and a
-- school/clinic principal -- and NO branch at all for centre_manager
-- or care_staff. A centre_manager calling this always fails every
-- branch and hits the function's own "no resolvable institution"
-- fallback (jsonb_build_object('type', 'school', ...)) before it ever
-- reaches the actual type-resolution logic below -- not because the
-- respite institution can't be found, but because the caller is never
-- even let past the front gate to look.
--
-- THE FIX: one additive branch, mirroring the existing principal
-- branch's own shape exactly, resolved via episodes_of_care (the
-- respite-specific relationship table -- passport_institution_links
-- alone says nothing about which STAFF may currently reach this
-- child, only that the institution itself is linked) rather than
-- passport_institution_links. Once past the gate, the TYPE RESOLUTION
-- logic underneath needed no change at all -- its own second fallback
-- (passport_institution_links, approved_by_parent = true) already
-- correctly resolves a respite-only child's real institution_id, since
-- onboard_clinic_client()'s respite branch (0297) already sets that
-- flag true on every row it creates (the same "compatibility default,
-- not a consent record" shape 0210's own header already documents for
-- the clinic case). Confirmed live: the gate was the ONLY broken piece.
--
-- A REAL, PRE-EXISTING, NARROWER ISSUE FOUND WHILE READING THIS
-- FUNCTION FOR THE FIX, FLAGGED HERE RATHER THAN SILENTLY FIXED OR
-- SILENTLY IGNORED, MATCHING THIS SCHEMA'S OWN STANDING PRACTICE: the
-- passport_institution_links fallback query (`limit 1`, no `order by`)
-- has no deterministic ordering. For a child linked to more than one
-- institution at once (a real, supported shape -- a school AND a
-- clinic, or a clinic AND a respite centre) this function can resolve
-- to WHICHEVER institution Postgres happens to read first, not
-- necessarily the one the CALLING staff member actually belongs to --
-- a caller who passes the (correctly institution-scoped) authorization
-- gate above could still be shown a DIFFERENT institution's own
-- vocabulary/overrides than their own. This is not new to this
-- migration and not specific to respite; it predates 0296 entirely and
-- was not reproduced or fixed here -- every fixture this build's own
-- verification used has exactly one institution link per child, so it
-- was never actually exercised. Recorded so it isn't rediscovered by
-- accident the way this schema's own four prior "unordered SELECT
-- INTO" instances all were.

create or replace function public.get_passport_institution_vocabulary(p_passport_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_institution_id uuid;
  v_type text;
begin
  if not (
    public.owns_passport(p_passport_id)
    or public.has_child_access(auth.uid(), p_passport_id)
    or (
      public.is_verified_clinician(auth.uid())
      and exists (
        select 1 from public.clinician_access ca
        where ca.passport_id = p_passport_id
          and ca.clinician_id = auth.uid()
          and ca.is_active = true
      )
    )
    or exists (
      select 1 from public.passport_institution_links pil
      join public.institution_staff s on s.institution_id = pil.institution_id
      where pil.passport_id = p_passport_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
    -- THE FIX: a respite centre_manager or care_staff, resolved via
    -- episodes_of_care (the real "is this child on our placement roster"
    -- relationship, same table get_my_centre_active_children() and
    -- every other respite read in this schema already anchors on) --
    -- never passport_institution_links directly, which only proves the
    -- INSTITUTION is linked, not that THIS caller currently belongs to it.
    or exists (
      select 1 from public.episodes_of_care eoc
      join public.institution_staff s on s.institution_id = eoc.institution_id
      where eoc.passport_id = p_passport_id
        and s.user_id = auth.uid()
        and s.role in ('centre_manager', 'care_staff')
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  ) then
    return jsonb_build_object('type', 'school', 'overrides', '{}'::jsonb);
  end if;

  select e.institution_id into v_institution_id
  from public.enrolments e
  where e.passport_id = p_passport_id
    and e.ended_at is null;

  if v_institution_id is null then
    select pil.institution_id into v_institution_id
    from public.passport_institution_links pil
    where pil.passport_id = p_passport_id
      and pil.approved_by_parent = true
    limit 1;
  end if;

  if v_institution_id is null then
    return jsonb_build_object('type', 'school', 'overrides', '{}'::jsonb);
  end if;

  select type into v_type from public.institutions where id = v_institution_id;

  return jsonb_build_object(
    'type', coalesce(v_type, 'school'),
    'overrides', coalesce((
      select jsonb_object_agg(o.key, o.value)
      from public.institution_vocabulary_overrides o
      where o.institution_id = v_institution_id
    ), '{}'::jsonb)
  );
end;
$$;

grant execute on function public.get_passport_institution_vocabulary(uuid) to authenticated;
