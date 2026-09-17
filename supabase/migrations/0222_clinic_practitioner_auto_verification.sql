-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 5 Stage 6, Step 2 -- THE FIX ITSELF. A clinic practitioner joining
-- by organisation code, approved by their director, now becomes a real,
-- usable clinician: their own institution_staff approval IS their
-- verification, exactly as a principal's approval already is for a
-- class teacher -- no separate credential review, because there is no
-- credential to review; the clinic itself already passed Behaviour
-- Hive's own manual institution-verification gate (CLAUDE.md's own
-- "institution creation being manual is deliberate" entry).
--
-- 'unspecified' -- a genuine placeholder, not a guess. specialty is
-- NOT NULL with a CHECK restricted to six real clinical specialties;
-- the clinicians row this migration creates has to satisfy that at
-- INSERT time, before the practitioner has ever been asked what their
-- own specialty is. Defaulting to 'behavioural_psychologist' (the one
-- specialty the independent-verification path actually supports) would
-- be a false claim about a real person's real qualification -- exactly
-- the "column name is a claim" failure mode this file already has an
-- entry for for approved_by_parent. 'unspecified' says plainly that
-- nothing has been asserted yet, until the practitioner sets their own
-- via select_clinician_specialty() (0223 makes that call safe for this
-- path specifically).
--
-- approve_staff_join() -- same signature, same behaviour for every
-- existing role/institution-type combination. The new branch fires
-- ONLY when the approved row is role='clinician' at a type='clinic'
-- institution -- a school's own class_teacher/sna approvals, and every
-- other clinic role (clinical_lead, clinic_admin, principal), are
-- completely unaffected. Upsert, not insert, on the small chance a
-- clinicians row already exists for this user (the independent path,
-- pre-existing before they ever joined a clinic by code) -- their own
-- specialty and any independent verification history stay untouched;
-- only verification_status/verification_route are forced to
-- 'verified'/'organisation' if they weren't already independently
-- verified. A person who is BOTH an independently-verified clinician
-- AND now director-approved at a clinic keeps whichever verification is
-- stronger -- once 'verified' by either route, joining a clinic can
-- never un-verify them.

do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'public.clinicians'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%specialty%in%';

  if v_constraint_name is not null then
    execute format('alter table public.clinicians drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table public.clinicians add constraint clinicians_specialty_check
  check (specialty in (
    'clinical_psychologist',
    'behavioural_psychologist',
    'educational_psychologist',
    'gp',
    'slt',
    'ot',
    'unspecified'
  ));

create or replace function public.approve_staff_join(p_institution_staff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.institution_staff;
  v_caller_is_active_principal boolean;
  v_institution_type text;
begin
  select * into v_target from public.institution_staff where id = p_institution_staff_id;

  if not found then
    raise exception 'Staff join request not found.';
  end if;

  if v_target.approved_at is not null then
    raise exception 'This request has already been approved.';
  end if;

  if v_target.rejected_at is not null then
    raise exception 'This request has already been rejected.';
  end if;

  select exists (
    select 1
    from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.user_id = auth.uid()
      and s.institution_id = v_target.institution_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) into v_caller_is_active_principal;

  if not v_caller_is_active_principal then
    raise exception 'Only an active principal at this institution can approve staff here.';
  end if;

  update public.institution_staff
  set approved_at = now(), approved_by = auth.uid(), approval_source = 'principal'
  where id = p_institution_staff_id;

  -- THE FIX: a clinic practitioner's own director-approval IS their
  -- verification. Fires only for role='clinician' at a type='clinic'
  -- institution -- every other role/institution-type combination is
  -- unaffected.
  if v_target.role = 'clinician' then
    select type into v_institution_type from public.institutions where id = v_target.institution_id;

    if v_institution_type = 'clinic' then
      insert into public.clinicians (user_id, specialty, verification_status, verification_route)
      values (v_target.user_id, 'unspecified', 'verified', 'organisation')
      on conflict (user_id) do update
        set verification_status = case
              when public.clinicians.verification_status = 'verified' then public.clinicians.verification_status
              else 'verified'
            end,
            verification_route = case
              when public.clinicians.verification_status = 'verified' then public.clinicians.verification_route
              else 'organisation'
            end;
    end if;
  end if;

  return jsonb_build_object('approved', true);
end;
$$;

grant execute on function public.approve_staff_join(uuid) to authenticated;
