-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- REAL BUG, NOW FIXED: fetchApprovedInstitutionPhone()
-- (src/lib/messages/institutionPhone.ts) could show the wrong school's
-- emergency contact number. Its old query was passport_id +
-- approved_by_parent = true, .limit(1), with no institution_id
-- scoping -- when a child has approved links to two institutions,
-- Postgres row order decided which phone number came back, not any
-- defined fact.
--
-- The fix resolves via the passport's CURRENT ACTIVE ENROLMENT instead
-- of an approval flag -- enrolments_one_active_per_child (migration
-- 0121) is a real unique partial index (`on enrolments (passport_id)
-- where ended_at is null`), confirmed live just now, not assumed --
-- CLAUDE.md's own note claiming "Stage 6's one-active-enrolment
-- constraint doesn't exist yet" was itself stale; the constraint has
-- existed since 0121. "Which institution is this child currently at"
-- is a real, unique fact once an enrolment exists; the old
-- approved_by_parent flag was never more than "was this link approved
-- at some point," which multiple institutions can equally satisfy at
-- once.
--
-- Falls back to the old approved-link behaviour only when no enrolment
-- row exists at all (pre-0121 data, or a link that never became a real
-- enrolment) -- rare, and still best-effort by the function's own
-- original design ("a missing link or missing phone just means the
-- footer falls back to plain text, never a blocker").
--
-- Moved from a raw client query to a SECURITY DEFINER RPC for a second
-- reason, not just the scoping bug: enrolments' own SELECT policy
-- (0121) is staff-only ("Active institution staff can view
-- enrolments") -- a parent or clinician calling this directly would
-- get zero rows back, RLS-silent, exactly the embedded-join/RLS gotcha
-- CLAUDE.md already documents. A parent, a teacher/SNA with child
-- access, a verified engaged clinician, or a principal at a linked
-- institution can all call this; anyone else gets null, the same
-- silent-and-harmless outcome this helper has always had for a missing
-- link -- this is a best-effort UI convenience, not a security
-- boundary, so it degrades rather than raises.

create or replace function public.get_approved_institution_phone(p_passport_id uuid)
returns text
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_institution_id uuid;
  v_phone text;
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
  ) then
    return null;
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
    return null;
  end if;

  select phone into v_phone from public.institutions where id = v_institution_id;
  return v_phone;
end;
$$;

grant execute on function public.get_approved_institution_phone(uuid) to authenticated;
