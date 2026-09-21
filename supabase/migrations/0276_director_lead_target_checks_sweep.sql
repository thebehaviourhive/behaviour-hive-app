-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Item 3c's deliberate sweep, per Daniel's own instruction after 0275:
-- "five found by accident means there are more." Four more functions
-- found checking institution_staff.role = 'clinician' against a
-- TARGET (not the caller's own gate) that would refuse a verified
-- director or lead doing real clinical work -- PRD 10 section 4a's
-- "every clinical role is a practitioner." All four widened the same
-- way 0275 widened _clinician_authored_at_institution(): admit
-- 'clinician', 'clinical_lead', 'principal' wherever the check is
-- asking "is this TARGET a practising clinician at this clinic," never
-- "is this caller a director" (that check stays role = 'principal'
-- alone, unchanged, everywhere it already is).
--
-- 1. set_clinician_workspace_email() -- item 3a, Daniel's own report:
--    "Daniel cannot set his own as director... 'this clinician is not
--    an active clinician at your clinic'." The TARGET check refused a
--    director/lead setting their own Workspace email, or a director
--    setting a lead's.
-- 2. _is_verified_clinician_at_institution() -- strategy_bank's own
--    write-authorization helper (0238, institution-type hole closed in
--    0267 without ever widening this same check). A director/lead
--    adding or curating a strategy is refused.
-- 3. get_institution_draft_fbas() -- a director-dashboard "outstanding
--    work" bucket. A director/lead's own draft FBA never surfaced on
--    their own dashboard.
-- 4. get_institution_incomplete_assessments() -- same bucket family,
--    incomplete assessments.
--
-- A candidate checked and RULED OUT, worth recording so it isn't
-- rediscovered as a false alarm: update_clinician_last_review() (0037)
-- also gates on `new.logged_by_role = 'clinician'` -- looks identical
-- to the four above. It isn't one. abc_logs.logged_by_role has its own
-- CHECK constraint (0065) admitting only 'parent'/'class_teacher'/
-- 'clinician'/'sna' -- never 'principal'/'clinical_lead' -- and
-- ABCLogger's own `role` prop is passed explicitly by each call site,
-- not read from app_metadata.role. /clinician/log (the route a
-- director or lead doing clinical work actually uses) hardcodes
-- role="clinician" regardless of the real account's own role, so a
-- director/lead's own ABC entries are already correctly stamped
-- logged_by_role='clinician' today, and this trigger already fires for
-- them. Left unchanged.

create or replace function public.set_clinician_workspace_email(
  p_institution_id uuid,
  p_clinician_user_id uuid,
  p_workspace_email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_principal boolean;
  v_target_is_practitioner boolean;
  v_email text;
begin
  select exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and inst.status = 'verified'
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(auth.uid(), p_institution_id)
  ) into v_is_principal;

  if not v_is_principal then
    raise exception 'Only an active clinical director can set a clinician''s Workspace email.';
  end if;

  -- Widened: a director may set their OWN Workspace email (target =
  -- caller, both 'principal'), or a clinical_lead's, the same way they
  -- already set an ordinary practitioner's.
  select exists (
    select 1 from public.institution_staff s
    where s.institution_id = p_institution_id
      and s.user_id = p_clinician_user_id
      and s.role in ('clinician', 'clinical_lead', 'principal')
      and public.institution_staff_has_current_standing(p_clinician_user_id, p_institution_id)
  ) into v_target_is_practitioner;

  if not v_target_is_practitioner then
    raise exception 'This person is not an active practitioner at your clinic.';
  end if;

  v_email := lower(trim(p_workspace_email));
  if v_email is null or v_email = '' then
    raise exception 'A Workspace email is required.';
  end if;

  update public.clinicians
  set workspace_email = v_email
  where user_id = p_clinician_user_id;

  if not found then
    -- Genuinely correct now, not a consolation error: a director/lead
    -- target reaching this line has a real institution_staff row but
    -- has never picked a specialty (select_director_specialty()), so
    -- no clinicians row exists to update yet. Item 3b's own fix is
    -- what makes this discoverable rather than a dead end.
    raise exception 'No clinician profile exists for this person yet -- they need to set their specialty first.';
  end if;
end;
$$;

grant execute on function public.set_clinician_workspace_email(uuid, uuid, text) to authenticated;


create or replace function public._is_verified_clinician_at_institution(p_institution_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.user_id = auth.uid()
      and s.institution_id = p_institution_id
      and s.role in ('clinician', 'clinical_lead', 'principal')
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  );
$$;


create or replace function public.get_institution_draft_fbas(p_institution_id uuid)
returns table (
  fba_id uuid,
  passport_id uuid,
  child_name text,
  clinician_id uuid,
  clinician_name text,
  status text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select f.id, f.passport_id, p.child_name, f.clinician_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'), f.status, f.created_at
  from public.fba_reports f
  join public.passports p on p.id = f.passport_id
  join auth.users u on u.id = f.clinician_id
  where f.status <> 'completed'
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = p_institution_id
        and s.user_id = f.clinician_id
        and s.role in ('clinician', 'clinical_lead', 'principal')
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
    and exists (
      select 1 from public.institution_staff caller
      join public.institutions inst on inst.id = caller.institution_id
      where caller.institution_id = p_institution_id
        and caller.user_id = auth.uid()
        and caller.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(caller.user_id, caller.institution_id)
    )
  order by f.created_at desc;
$$;


create or replace function public.get_institution_incomplete_assessments(p_institution_id uuid)
returns table (
  assessment_id uuid,
  passport_id uuid,
  child_name text,
  clinician_id uuid,
  clinician_name text,
  instrument_name text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select a.id, a.passport_id, p.child_name, a.clinician_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'), ai.name, a.created_at
  from public.assessments a
  join public.passports p on p.id = a.passport_id
  join public.assessment_instruments ai on ai.id = a.instrument_id
  join auth.users u on u.id = a.clinician_id
  where a.completed_at is null
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = p_institution_id
        and s.user_id = a.clinician_id
        and s.role in ('clinician', 'clinical_lead', 'principal')
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
    and exists (
      select 1 from public.institution_staff caller
      join public.institutions inst on inst.id = caller.institution_id
      where caller.institution_id = p_institution_id
        and caller.user_id = auth.uid()
        and caller.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(caller.user_id, caller.institution_id)
    )
  order by a.created_at desc;
$$;
