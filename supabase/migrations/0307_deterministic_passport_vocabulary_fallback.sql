-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- THE CENTRE_MANAGER DASHBOARD BUILD, item 4, 25 Sept 2026. 0306's own
-- header flagged this rather than fixing it: get_passport_institution_
-- vocabulary()'s second fallback (passport_institution_links,
-- approved_by_parent = true, `limit 1`, no `order by`) has no
-- deterministic ordering. Daniel's own instruction: this is not
-- hypothetical -- a child at a school, with a clinic, and attending a
-- respite centre has three real institution links, and that is
-- exactly the HSE scenario this app is being used for next.
-- Non-deterministic vocabulary on a real child's record is not
-- acceptable; decide the precedence deliberately and make it
-- deterministic.
--
-- WHY THIS FALLBACK IS REACHED AT ALL, WORTH STATING BEFORE THE FIX:
-- the FIRST query (against `enrolments`, `ended_at is null`) already
-- resolves deterministically and correctly to the school whenever an
-- active school enrolment exists -- `enrolments_one_active_per_child`
-- (0121) is a real unique partial index, so that query can never
-- return more than one row. For the school+clinic+respite example
-- above specifically, the FIRST query already wins and this second
-- fallback is never reached at all. It IS reached, genuinely
-- ambiguously, whenever a passport has NO active school enrolment and
-- is linked to more than one non-school institution -- clinic+respite
-- (a real, supported shape: a clinic refers a family to respite care)
-- being the most likely real case, not a hypothetical one either.
--
-- THE PRECEDENCE, DECIDED DELIBERATELY, NOT ALPHABETICAL OR ARBITRARY:
-- clinic before respite_centre. A clinic is ordinarily a family's
-- ongoing, primary treatment relationship; a respite centre is a
-- periodic, adjunct service layered on top of it (PRD 11's own framing
-- throughout -- a respite stay is scheduled and bounded, a clinic
-- engagement is the standing one). When a passport has no active
-- school link and is connected to both, the clinic's own vocabulary
-- ("your clinic", "your clinical team") is the one more likely to
-- match how the family actually thinks about the child's record.
-- Within the SAME type (two clinics, or two respite centres --
-- structurally possible, not excluded by any constraint), the
-- OLDEST link wins -- the family's longest-standing relationship of
-- that kind, the same "don't let the newest addition silently
-- override an established one" instinct the codebase already applies
-- elsewhere (e.g. institution_staff's own `order by created_at desc
-- limit 1` precedent, here inverted to ascending because the
-- LONGEST-standing relationship, not the most recent, is the one that
-- should describe the family's own vocabulary).
--
-- Nothing else about this function changes -- 0306's own centre_
-- manager/care_staff authorization branch, and every other fallback
-- and default, stay exactly as they are. This is purely the `order by`
-- 0306's own header already named as a known gap.

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
    -- THE FIX: a real, deliberate order by, replacing the previous
    -- unordered `limit 1`. See this migration's own header for why
    -- clinic precedes respite_centre, and why the tiebreaker within a
    -- type is the OLDEST link.
    select pil.institution_id into v_institution_id
    from public.passport_institution_links pil
    join public.institutions inst on inst.id = pil.institution_id
    where pil.passport_id = p_passport_id
      and pil.approved_by_parent = true
    order by
      case inst.type when 'clinic' then 0 when 'respite_centre' then 1 else 2 end,
      pil.created_at asc
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
