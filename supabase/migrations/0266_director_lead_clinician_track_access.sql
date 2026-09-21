-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- THE FBA REMAINS UNTOUCHED. STANDING. A clinical director or lead must
-- be able to write FBAs, deliver clinical work, and hold their own
-- caseload -- without a single line of any FBA file changing. The FBA
-- does not decide who gets in; useRequireRole("clinician") does. This
-- migration changes what that shared gate can answer, from the
-- database side, in two new functions -- the client-side half (the
-- gate itself, useRequireRole.ts) is a separate, purely client-side
-- change, since neither new function here is self-authorizing on its
-- own; each is called FROM the gate, not instead of it.
--
-- TWO INDEPENDENT LAYERS, NOT ONE -- Daniel's own correction, "belt and
-- braces": the gate-check function below (1) does not rely solely on
-- "nothing can create a verified clinicians row for a school
-- principal" (true today, by construction of function 2's own
-- institution-type check) -- it ALSO independently re-checks
-- institution type = clinic itself, so even a clinicians row that
-- reached 'verified' through some OTHER path (select_clinician_
-- specialty()'s own ungated insert, defaulting to 'pending', then a
-- human mistakenly running approve_clinician() against it -- both real,
-- if unlikely, and neither this migration's own concern to prevent)
-- still cannot admit a school principal, because the gate itself checks
-- the institution, not just the clinicians row.
--
-- 1. is_verified_clinic_director_or_lead() -- the gate-check itself.
--    Called by useRequireRole ONLY when a caller's own JWT role is
--    'principal' or 'clinical_lead' and the page they're trying to
--    reach requested "clinician" -- never for an ordinary clinician
--    (zero added query for the common case) and never for a school
--    principal in practice (see below), but checked here regardless of
--    who calls it, since the function itself is the second, independent
--    layer.

create or replace function public.is_verified_clinic_director_or_lead()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (
      select 1
      from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.user_id = auth.uid()
        and s.role in ('principal', 'clinical_lead')
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
    and public.is_verified_clinician(auth.uid());
$$;

grant execute on function public.is_verified_clinic_director_or_lead() to authenticated;

-- 2. select_director_specialty() -- the sibling function that creates
--    the verified clinicians row in the first place, mirroring 0222's
--    own reasoning exactly ("a clinic practitioner's own director-
--    approval IS their verification") for the one case 0222 never
--    covered: the director or lead themselves, who never passes through
--    approve_staff_join()'s own clinic branch as a TARGET (they ARE the
--    approver, or were approved as principal/clinical_lead, which has
--    nothing to do with clinician verification at all). Their own
--    current standing as principal/clinical_lead AT A CLINIC is the
--    identical kind of organisational vouching 0222 already accepted
--    for an ordinary practitioner -- applied here to the one role
--    0222's own branch structurally could never reach.
--
--    A pure EXISTS check, not a row resolution -- clinicians is not
--    institution-scoped (same global-per-user shape the independent
--    path already uses), so there is no institution_id to resolve or
--    store, which sidesteps this schema's own "unordered SELECT INTO
--    against institution_staff" trap entirely rather than needing to
--    guard against it.
--
--    domain_tags is deliberately NOT a parameter here -- the specialty
--    page's own existing save flow already writes it as a separate,
--    plain client UPDATE against clinicians (0235's own column grant,
--    RLS self-row policy from 0026) once the row exists, regardless of
--    which function created it. Reusing that unchanged, not duplicating
--    it into a second write path.

create or replace function public.select_director_specialty(p_specialty text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.user_id = auth.uid()
      and s.role in ('principal', 'clinical_lead')
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'Only a clinical director or clinical lead at a clinic can use this.';
  end if;

  insert into public.clinicians (user_id, specialty, verification_status, verification_route)
  values (auth.uid(), p_specialty, 'verified', 'organisation')
  on conflict (user_id) do update
    set specialty = excluded.specialty,
        verification_status = 'verified',
        verification_route = 'organisation';
end;
$$;

grant execute on function public.select_director_specialty(text) to authenticated;
