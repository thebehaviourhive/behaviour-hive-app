-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 10 Stage 2 -- the tag catalog gains a real editor. Three RPCs,
-- all director-only, all direct action -- matching institution_tags'
-- own established write posture (0213: "director-only, direct action,
-- no request queue -- that's Stage 5's own territory, for CHANGES to an
-- EPISODE's tags, not for defining the catalog itself").
--
-- WHY RENAME NEEDS RPCS AND RETIRE/RESTORE DOES NOT, IN PRINCIPLE, BUT
-- BUILT AS ONE HERE ANYWAY, PER DANIEL'S OWN NAMED LIST: a plain client
-- `.update({is_active})` would already work under institution_tags' own
-- `for all` director-only policy -- there is no collision risk in
-- toggling a boolean. Rename is different: it can collide with the
-- unique(institution_id, dimension, value) constraint, and a raw
-- Postgres duplicate-key error is not a message a director should ever
-- see. set_institution_tag_active() is built as a real RPC regardless,
-- for the same reason rename is one -- one consistent surface for every
-- catalog mutation, not a mix of raw updates and RPCs depending on
-- whether a given operation happens to need one.
--
-- WHY THE FK NORMALISATION (0226) IS WHAT MAKES RENAME SAFE AT ALL:
-- episode_tags.institution_tag_id and clinical_lead_scope.institution_
-- tag_id both reference institution_tags.id, never a copy of its own
-- (dimension, value) text. A rename is a single UPDATE against
-- institution_tags alone -- every episode and every lead's scope that
-- references the renamed row "follows" the rename automatically,
-- because neither ever stored the old text in the first place.
--
-- THE COLLISION MESSAGE, PER DANIEL'S OWN DECISION: renaming into a
-- name that already exists at this institution under the same
-- dimension refuses -- worded differently depending on whether the
-- existing row is active ("already exists") or retired ("was
-- previously retired -- restore it instead"), since those are
-- different, actionable situations for the director, not one generic
-- conflict.

-- ===========================================================================
-- 1. rename_institution_tag_value() -- a single row's own value text.
-- ===========================================================================

create or replace function public.rename_institution_tag_value(
  p_tag_id uuid,
  p_new_value text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tag public.institution_tags;
  v_new_value text;
  v_collision public.institution_tags;
begin
  select * into v_tag from public.institution_tags where id = p_tag_id;
  if not found then
    raise exception 'Tag not found.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    where s.institution_id = v_tag.institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'Only a clinical director can rename a tag value.';
  end if;

  v_new_value := trim(p_new_value);
  if v_new_value = '' then
    raise exception 'A value is required.';
  end if;

  if v_new_value = v_tag.value then
    return;
  end if;

  select * into v_collision
  from public.institution_tags
  where institution_id = v_tag.institution_id
    and dimension = v_tag.dimension
    and value = v_new_value
    and id <> p_tag_id;

  if found then
    if v_collision.is_active then
      raise exception 'A tag "%" already exists under "%".', v_new_value, v_tag.dimension;
    else
      raise exception '"%" under "%" was previously retired. Restore it instead of renaming into it.', v_new_value, v_tag.dimension;
    end if;
  end if;

  update public.institution_tags
  set value = v_new_value
  where id = p_tag_id;
end;
$$;

grant execute on function public.rename_institution_tag_value(uuid, text) to authenticated;

-- ===========================================================================
-- 2. rename_institution_tag_dimension() -- bulk, every value under a
--    dimension name at one institution. Validates every value against
--    the target dimension name FIRST, then writes -- the same
--    "validate the whole set, then write" discipline set_episode_tags()
--    already established (0214), so a real multi-value rename never
--    fails halfway through with some values renamed and others not.
-- ===========================================================================

create or replace function public.rename_institution_tag_dimension(
  p_institution_id uuid,
  p_old_dimension text,
  p_new_dimension text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_dimension text := trim(p_old_dimension);
  v_new_dimension text;
  v_row public.institution_tags;
  v_collision public.institution_tags;
  v_count integer := 0;
begin
  if not exists (
    select 1 from public.institution_staff s
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'Only a clinical director can rename a tag dimension.';
  end if;

  v_new_dimension := trim(p_new_dimension);
  if v_new_dimension = '' then
    raise exception 'A dimension name is required.';
  end if;

  if not exists (
    select 1 from public.institution_tags
    where institution_id = p_institution_id and dimension = v_old_dimension
  ) then
    raise exception 'No such dimension.';
  end if;

  if v_new_dimension = v_old_dimension then
    return 0;
  end if;

  for v_row in
    select * from public.institution_tags
    where institution_id = p_institution_id and dimension = v_old_dimension
  loop
    select * into v_collision
    from public.institution_tags
    where institution_id = p_institution_id
      and dimension = v_new_dimension
      and value = v_row.value;

    if found then
      if v_collision.is_active then
        raise exception 'A tag "%" already exists under "%".', v_row.value, v_new_dimension;
      else
        raise exception '"%" under "%" was previously retired. Resolve that conflict before renaming the whole dimension into it.', v_row.value, v_new_dimension;
      end if;
    end if;
  end loop;

  update public.institution_tags
  set dimension = v_new_dimension
  where institution_id = p_institution_id and dimension = v_old_dimension;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.rename_institution_tag_dimension(uuid, text, text) to authenticated;

-- ===========================================================================
-- 3. set_institution_tag_active() -- retire (false) or restore (true).
--    No collision risk either direction, unlike rename -- built as a
--    real RPC anyway, per this migration's own header.
-- ===========================================================================

create or replace function public.set_institution_tag_active(
  p_tag_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tag public.institution_tags;
begin
  select * into v_tag from public.institution_tags where id = p_tag_id;
  if not found then
    raise exception 'Tag not found.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    where s.institution_id = v_tag.institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'Only a clinical director can retire or restore a tag.';
  end if;

  update public.institution_tags
  set is_active = p_is_active
  where id = p_tag_id;
end;
$$;

grant execute on function public.set_institution_tag_active(uuid, boolean) to authenticated;
