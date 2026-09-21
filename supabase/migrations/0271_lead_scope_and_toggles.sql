-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 10 Stage 4 -- six RPCs. Five for the toggles (no write path
-- exists on institutions at all today -- confirmed by reading every
-- migration that touches it, no UPDATE policy anywhere, matching this
-- schema's own established one-RPC-per-setting shape for every other
-- institution-level setting, PRD 9's set_clinic_hours() and its
-- siblings). One for the lead scope editor's own save -- an atomic
-- REPLACE, never two raw client calls (delete, then insert), which
-- could leave a lead with an empty scope if the second call failed
-- after the first succeeded -- exactly the failure a scope editor must
-- not have.
--
-- set_clinical_lead_scope() re-implements _can_manage_clinical_lead_
-- scope()'s own two checks directly rather than relying on RLS to
-- catch them -- a SECURITY DEFINER function's own writes are not
-- subject to RLS, so the director-only check and the per-tag
-- institution/is_active validation both have to be explicit here, not
-- inherited from the table's own policy the way a raw client insert
-- would get them for free. Validate every tag first, then write --
-- same "the whole set is checked before any of it changes" discipline
-- set_episode_tags()/_replace_episode_tags() already established.
--
-- Both director-only checks in this migration (the toggles' own, and
-- set_clinical_lead_scope()'s own) additionally require inst.type =
-- 'clinic', belt and braces, matching 0266/0267's own two-independent-
-- layers posture -- these five columns and this table both mean
-- nothing for a school, and nothing here should ever admit one on the
-- strength of "nothing today can construct that case" alone.

-- ===========================================================================
-- 1. set_clinical_lead_scope() -- the scope editor's own save, atomic.
-- ===========================================================================

create or replace function public.set_clinical_lead_scope(
  p_institution_staff_id uuid,
  p_institution_tag_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_institution_id uuid;
  v_tag_id uuid;
  v_count integer := 0;
begin
  select institution_id into v_institution_id
  from public.institution_staff
  where id = p_institution_staff_id;

  if v_institution_id is null then
    raise exception 'Staff member not found.';
  end if;

  if not exists (
    select 1 from public.institution_staff director
    join public.institutions inst on inst.id = director.institution_id
    where director.institution_id = v_institution_id
      and director.user_id = auth.uid()
      and director.role = 'principal'
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
  ) then
    raise exception 'Only a clinical director can set a lead''s scope.';
  end if;

  if p_institution_tag_ids is not null then
    foreach v_tag_id in array p_institution_tag_ids
    loop
      if not exists (
        select 1 from public.institution_tags it
        where it.id = v_tag_id
          and it.institution_id = v_institution_id
          and it.is_active
      ) then
        raise exception 'One or more tags are not valid for this clinic.';
      end if;
    end loop;
  end if;

  delete from public.clinical_lead_scope where institution_staff_id = p_institution_staff_id;

  if p_institution_tag_ids is not null then
    foreach v_tag_id in array p_institution_tag_ids
    loop
      insert into public.clinical_lead_scope (institution_staff_id, institution_tag_id, created_by)
      values (p_institution_staff_id, v_tag_id, auth.uid());
      v_count := v_count + 1;
    end loop;
  end if;

  return v_count;
end;
$$;

grant execute on function public.set_clinical_lead_scope(uuid, uuid[]) to authenticated;

-- ===========================================================================
-- 2. The five toggle RPCs. Identical shape, one column each.
-- ===========================================================================

create or replace function public.set_lead_can_reassign_within_scope(p_institution_id uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'Only a clinical director can change this.';
  end if;

  update public.institutions set lead_can_reassign_within_scope = p_value where id = p_institution_id;
end;
$$;

grant execute on function public.set_lead_can_reassign_within_scope(uuid, boolean) to authenticated;

create or replace function public.set_lead_can_discharge_within_scope(p_institution_id uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'Only a clinical director can change this.';
  end if;

  update public.institutions set lead_can_discharge_within_scope = p_value where id = p_institution_id;
end;
$$;

grant execute on function public.set_lead_can_discharge_within_scope(uuid, boolean) to authenticated;

create or replace function public.set_lead_can_approve_non_scoping_tag_changes(p_institution_id uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'Only a clinical director can change this.';
  end if;

  update public.institutions set lead_can_approve_non_scoping_tag_changes = p_value where id = p_institution_id;
end;
$$;

grant execute on function public.set_lead_can_approve_non_scoping_tag_changes(uuid, boolean) to authenticated;

create or replace function public.set_practitioner_can_onboard(p_institution_id uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'Only a clinical director can change this.';
  end if;

  update public.institutions set practitioner_can_onboard = p_value where id = p_institution_id;
end;
$$;

grant execute on function public.set_practitioner_can_onboard(uuid, boolean) to authenticated;

create or replace function public.set_practitioner_can_discharge_own_clients(p_institution_id uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'Only a clinical director can change this.';
  end if;

  update public.institutions set practitioner_can_discharge_own_clients = p_value where id = p_institution_id;
end;
$$;

grant execute on function public.set_practitioner_can_discharge_own_clients(uuid, boolean) to authenticated;

-- ===========================================================================
-- 3. get_institution_toggles() -- a small read RPC so the Clinic page
--    doesn't need a raw client select against institutions for these
--    five columns specifically. institutions' own SELECT policy is
--    already `using (true)`, so this isn't closing a leak -- it exists
--    only so the client has one call returning exactly these five
--    booleans plus institution_id, matching the shape every other
--    settings row on that page already reads via a single query.
-- ===========================================================================

create or replace function public.get_institution_toggles(p_institution_id uuid)
returns table (
  lead_can_reassign_within_scope boolean,
  lead_can_discharge_within_scope boolean,
  lead_can_approve_non_scoping_tag_changes boolean,
  practitioner_can_onboard boolean,
  practitioner_can_discharge_own_clients boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    lead_can_reassign_within_scope,
    lead_can_discharge_within_scope,
    lead_can_approve_non_scoping_tag_changes,
    practitioner_can_onboard,
    practitioner_can_discharge_own_clients
  from public.institutions
  where id = p_institution_id;
$$;

grant execute on function public.get_institution_toggles(uuid) to authenticated;
