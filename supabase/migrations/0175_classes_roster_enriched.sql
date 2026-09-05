-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Class management screen redesign (Directory -> Classes) -- the left
-- pane's class cards are being enriched so a principal can read the
-- shape of a class (who teaches it, whether it has a class SNA, whether
-- cover is active today) without opening it. get_institution_classes_
-- roster() (0129) only ever returned class_id/name/created_at/
-- teacher_count/child_count -- none of that is in the current shape,
-- confirmed by reading 0129's own live body directly (the only
-- migration that has ever touched this function).
--
-- CREATE OR REPLACE cannot change a RETURNS TABLE column list -- DROP +
-- CREATE, matching 0122/0125's own precedent for widening a roster RPC
-- the same way.
--
-- Four new columns, each a plain aggregate over data this RPC's caller
-- (an active institution staff member, same standing check as before)
-- already has ordinary access to via the RPCs ClassDetail.tsx itself
-- calls once a class is open -- this just aggregates it one level up,
-- to the list. Nothing here widens who can see what.
--
--   teacher_names        -- active class_teachers, comma-joined, in
--                            position order (matches the 3-slot order
--                            ClassDetail's own Teachers section uses)
--   class_sna_names       -- active class_sna_assignments, comma-joined
--   children_with_1to1    -- count of this class's active children who
--                            also have an active child_assignments row
--                            (a 1:1 SNA) -- a subset of child_count,
--                            never a separate roster
--   cover_today_names     -- staff with a non-revoked temporary_access
--                            grant for this class dated today (local,
--                            Europe/Dublin -- matching 0037/0105's own
--                            established basis for "today", not a bare
--                            current_date), comma-joined. Deliberately
--                            NOT filtered to before the cutoff time --
--                            a grant is "today's cover" for the whole
--                            day it names, same as 0105's own class-
--                            list queries treat it.
--
-- Names resolve the same way get_institution_staff_roster() (0125)
-- already does: auth.users.raw_user_meta_data/raw_app_meta_data ->>
-- 'full_name', joined by user_id -- not a new name-lookup pattern.

drop function if exists public.get_institution_classes_roster(uuid);

create function public.get_institution_classes_roster(p_institution_id uuid)
returns table (
  class_id uuid,
  name text,
  created_at timestamptz,
  teacher_count bigint,
  child_count bigint,
  teacher_names text,
  class_sna_names text,
  children_with_1to1 bigint,
  cover_today_names text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    c.id as class_id,
    c.name,
    c.created_at,
    (select count(*) from public.class_teachers ct where ct.class_id = c.id and ct.ended_at is null) as teacher_count,
    (select count(*) from public.class_children cc where cc.class_id = c.id and cc.ended_at is null) as child_count,
    (
      select string_agg(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'), ', ' order by ct.position)
      from public.class_teachers ct
      join auth.users u on u.id = ct.user_id
      where ct.class_id = c.id and ct.ended_at is null
    ) as teacher_names,
    (
      select string_agg(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'), ', ' order by cs.started_at)
      from public.class_sna_assignments cs
      join auth.users u on u.id = cs.user_id
      where cs.class_id = c.id and cs.ended_at is null
    ) as class_sna_names,
    (
      select count(*)
      from public.class_children cc
      join public.child_assignments ca on ca.passport_id = cc.passport_id and ca.ended_at is null
      where cc.class_id = c.id and cc.ended_at is null
    ) as children_with_1to1,
    (
      select string_agg(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'), ', ' order by ta.created_at)
      from public.temporary_access ta
      join auth.users u on u.id = ta.granted_to
      where ta.class_id = c.id
        and ta.revoked_at is null
        and ta.granted_for_date = (now() at time zone public.app_local_timezone())::date
    ) as cover_today_names
  from public.classes c
  where c.institution_id = p_institution_id
    and public.institution_staff_has_current_standing(auth.uid(), p_institution_id)
  order by c.name;
$$;

grant execute on function public.get_institution_classes_roster(uuid) to authenticated;
