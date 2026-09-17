-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 5 Stage 3, Step 2 -- onboarding, both paths. Two separate
-- functions on purpose, matching create_school_passport()'s own
-- established split between "child doesn't exist yet" and the
-- genuinely different "already-existing passport" case:
--
-- onboard_clinic_client() -- a brand-new client, no passport, no
-- passport_institution_links row for this clinic (or any institution)
-- yet. Mirrors create_school_passport()/enrol_child() (0113/0121)
-- exactly: passport + passport_institution_links + episode, one
-- transaction.
--
-- reopen_clinic_episode() -- a client who was ALREADY linked to THIS
-- clinic before (a real former episode exists, now ended) and is
-- returning. Requires an existing passport_institution_links row for
-- (passport, institution) -- refuses otherwise, deliberately: a
-- passport that exists but was never linked to THIS clinic (e.g.
-- transferring in from a school, or from a different clinic) is the
-- cross-organisation case PRD 8 owns, not this. The school side's own
-- equivalent ("transfer-in") stays exactly as parked as 0121 left it --
-- this is not that, and does not touch enrolments at all.
--
-- AUTHORIZATION, both functions, identical: director (role='principal')
-- and admin (role='clinic_admin') always; practitioner (role='clinician')
-- only when institutions.practitioner_can_onboard is true (0207's own
-- toggle, default false). clinical_lead is NOT an onboarder -- PRD
-- section 5's own description of a lead's capabilities is reassign/
-- discharge/approve-tag-changes within scope; onboarding is never named
-- among them, and this migration does not invent it. institutions.type
-- = 'clinic' is checked explicitly in both -- role='principal'/
-- 'clinician' can exist at either institution type, and without this
-- check a SCHOOL principal could call a clinic-shaped function against
-- their own school's institution_id and have it silently succeed.
--
-- ONE DELIBERATE DEPARTURE from create_school_passport()'s own literal
-- text: standing is checked via institution_staff_has_current_standing()
-- (0105), not hand-written deactivated_at/approved_at conditions --
-- create_school_passport() itself still hand-writes them (written
-- before 0105 existed), but CLAUDE.md's own standing rule is explicit
-- that NEW code always calls the helper. Not fixing the older function
-- here; just not repeating its now-outdated shape in new code.
--
-- approved_by_parent = true on the passport_institution_links insert:
-- same compatibility-default reasoning create_school_passport() already
-- established and CLAUDE.md's own "A COLUMN NAME IS A CLAIM" entry
-- documents for that function -- a clinic onboarding its own client has
-- no parent to seek approval from either, and the flag is what keeps
-- the link visible to gates written when it meant real parental
-- consent. Commented at the write site, per that entry's own
-- instruction, not just remembered.

create or replace function public.onboard_clinic_client(
  p_institution_id uuid,
  p_client_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_passport_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if coalesce(trim(p_client_name), '') = '' then
    raise exception 'A client name is required.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and inst.status = 'verified'
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
      and (
        s.role in ('principal', 'clinic_admin')
        or (s.role = 'clinician' and inst.practitioner_can_onboard)
      )
  ) then
    raise exception 'Only a clinical director, admin, or (where enabled) a practitioner can onboard a new client.';
  end if;

  insert into public.passports (child_name, passport_status)
  values (trim(p_client_name), 'not_started')
  returning id into v_passport_id;

  -- approved_by_parent = true here is a compatibility default, not a
  -- consent record -- see this migration's own header and CLAUDE.md's
  -- "A COLUMN NAME IS A CLAIM" entry. A clinic onboarding its own
  -- client has no parent to seek approval from.
  insert into public.passport_institution_links (passport_id, institution_id, approved_by_parent, parent_approved_at)
  values (v_passport_id, p_institution_id, true, null);

  insert into public.episodes_of_care (passport_id, institution_id, started_by)
  values (v_passport_id, p_institution_id, auth.uid());

  return v_passport_id;
end;
$$;

grant execute on function public.onboard_clinic_client(uuid, text) to authenticated;

create or replace function public.reopen_clinic_episode(
  p_institution_id uuid,
  p_passport_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_episode_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and inst.status = 'verified'
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
      and (
        s.role in ('principal', 'clinic_admin')
        or (s.role = 'clinician' and inst.practitioner_can_onboard)
      )
  ) then
    raise exception 'Only a clinical director, admin, or (where enabled) a practitioner can reopen an episode.';
  end if;

  if not exists (
    select 1 from public.passport_institution_links pil
    where pil.passport_id = p_passport_id
      and pil.institution_id = p_institution_id
  ) then
    raise exception 'This client has never been linked to your organisation. Use onboarding for a new client.';
  end if;

  if exists (
    select 1 from public.episodes_of_care
    where passport_id = p_passport_id
      and institution_id = p_institution_id
      and ended_at is null
  ) then
    raise exception 'This client already has an active episode of care at your organisation.';
  end if;

  insert into public.episodes_of_care (passport_id, institution_id, started_by)
  values (p_passport_id, p_institution_id, auth.uid())
  returning id into v_episode_id;

  return v_episode_id;
end;
$$;

grant execute on function public.reopen_clinic_episode(uuid, uuid) to authenticated;
