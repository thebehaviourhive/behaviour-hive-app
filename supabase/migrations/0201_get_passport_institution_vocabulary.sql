-- PRD 5 Stage 1. Every passport/child-scoped surface that displays a
-- role label (ABC logger, FBA sections, the parent's own team card)
-- needs the OWNING institution's type and vocabulary overrides -- but
-- enrolments' own SELECT policy is staff-only ("Active institution
-- staff can view enrolments"), so a parent or clinician session
-- reading it directly gets zero rows back, RLS-silent -- the exact
-- embedded-join/RLS gotcha CLAUDE.md already documents. Mirrors
-- get_approved_institution_phone()'s own resolution and auth shape
-- exactly (0182): current active enrolment first, falling back to an
-- approved institution link when no enrolment row exists.
--
-- Best-effort, same posture as get_approved_institution_phone(): a
-- passport with no resolvable institution returns school defaults
-- (type 'school', no overrides) rather than raising -- every real
-- institution today is a school, so this is never observably wrong,
-- only a graceful floor for the rare case of no link at all.
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
