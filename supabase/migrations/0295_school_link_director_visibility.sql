-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Closes the director notification gap recorded during the cross-
-- organisation link build (0294): team_linked reaches an engaged
-- clinician's own activity feed, but a director who isn't personally
-- on the case learns nothing at all -- not a toast, not a dashboard
-- row, not a line on the client's own record. Found live: a real
-- school link existed and the director's own client page showed no
-- trace of it anywhere.
--
-- THREE PIECES, each answering a distinct part of Daniel's own ask:
--
-- 1. get_passport_linked_schools_for_director() WIDENED to return
-- linked_at (pil.created_at) alongside institution_id/institution_name
-- -- it already existed (0274, feeding GrantManagementSection's own
-- "Share with a School" picker) and already resolves exactly the right
-- set (schools linked to a passport the caller directs a CLINIC for),
-- so this is the one function BOTH new client-side pieces below reuse,
-- not two separate lookups drifting apart. DROP+CREATE, matching this
-- schema's own standing rule for a RETURNS TABLE shape change.
--
-- 2. get_institution_school_links_pending_sharing_decision(p_institution_id)
-- -- the new Outstanding Work bucket. NOT a notification log (this
-- schema's own "QUERY LIVE STATE, NOT AN EVENT LOG" rule) -- a standing
-- fact, computed fresh every read: this clinic's own clients who now
-- have a real school link and for whom this clinic has proposed
-- NOTHING yet (zero cross_organisation_grants rows at all, matching
-- GrantManagementSection's own identical, already-shipped "nothing
-- shared yet" predicate exactly -- one fact, read the same way in both
-- places). Self-clearing the moment the director proposes a single
-- grant for that passport, whatever its eventual status -- proposing
-- is the director having looked and acted, not "confirmed by the
-- parent." A director who looks and deliberately decides not to
-- propose anything will keep seeing this row -- a genuine, disclosed
-- trade-off, not an oversight: "nothing shared yet" stays literally
-- true until something changes, and this bucket says exactly that,
-- nothing more. One row per CHILD (the standing "organised by client,
-- never by staff" constraint), school names aggregated when a child is
-- linked to more than one.
--
-- 3. Nothing new needed for the client record's own "Linked Schools"
-- section -- it reuses function 1 directly, client-side only
-- (LinkedSchoolsSection.tsx).

drop function if exists public.get_passport_linked_schools_for_director(uuid);

create function public.get_passport_linked_schools_for_director(p_passport_id uuid)
returns table (
  institution_id uuid,
  institution_name text,
  linked_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select i.id, i.name, pil.created_at
  from public.passport_institution_links pil
  join public.institutions i on i.id = pil.institution_id
  where pil.passport_id = p_passport_id
    and i.type = 'school'
    and exists (
      select 1
      from public.passport_institution_links pil2
      join public.institutions clinic_inst on clinic_inst.id = pil2.institution_id
      where pil2.passport_id = p_passport_id
        and clinic_inst.type = 'clinic'
        and public._is_director_of_institution(pil2.institution_id)
    )
  order by i.name;
$$;

grant execute on function public.get_passport_linked_schools_for_director(uuid) to authenticated;

create or replace function public.get_institution_school_links_pending_sharing_decision(p_institution_id uuid)
returns table (
  passport_id uuid,
  child_name text,
  school_names text,
  linked_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    p.child_name,
    string_agg(distinct s_inst.name, ', ' order by s_inst.name),
    min(s_pil.created_at)
  from public.passport_institution_links clinic_pil
  join public.passports p on p.id = clinic_pil.passport_id
  join public.passport_institution_links s_pil on s_pil.passport_id = clinic_pil.passport_id
  join public.institutions s_inst on s_inst.id = s_pil.institution_id and s_inst.type = 'school'
  where clinic_pil.institution_id = p_institution_id
    and public._is_director_of_institution(p_institution_id)
    and not exists (
      select 1 from public.cross_organisation_grants g
      where g.passport_id = p.id
        and g.granting_institution_id = p_institution_id
    )
  group by p.id, p.child_name
  order by min(s_pil.created_at) desc;
$$;

grant execute on function public.get_institution_school_links_pending_sharing_decision(uuid) to authenticated;
