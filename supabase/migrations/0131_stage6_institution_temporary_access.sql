-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 2, Stage 6 -- second and last new SQL of this PRD. The gap: a
-- principal cannot see every active temporary cover grant across the
-- school without opening each class in turn -- today the only read is
-- the raw, class-scoped table select on classes/[classId]. One new
-- function, no schema change, no new write path -- revoke_temporary_
-- access() (0105) already lets "the person who granted this, or the
-- institution's principal" revoke ANY grant at their institution, not
-- just ones tied to a class they teach, so the institution-wide view
-- needs no new write RPC, only a new read.
--
-- get_institution_temporary_access(p_institution_id, p_days_back
-- default 30) -- matches the naming/shape convention of the other
-- roster RPCs: grant_id (not bare id, the way class_id/passport_id
-- name their own entity), every name resolved inline (granted_to,
-- granted_by, revoked_by) rather than making the client cross-
-- reference a second roster fetch, class_name resolved inline too so
-- the institution-wide view doesn't need get_institution_classes_
-- roster() (0129) as a second call just to label each row.
--
-- "Active and recent past", not everything ever: every grant that is
-- still live (revoked_at is null -- covers today and any pre-scheduled
-- future date, since grant_temporary_access() only refuses a date
-- that's already passed, never restricts how far ahead one can be
-- scheduled) is always included regardless of age, and everything else
-- (revoked, or dated before today) is included only from the last
-- p_days_back days -- bounds an otherwise ever-growing table on a
-- live-status screen without ever hiding something still in effect.
-- access_tier is included even though it's currently always 'sna' (the
-- table's own check constraint) -- explicit on the row itself, not
-- left for the client to assume, matching Daniel's own instruction
-- that SNA-level access regardless of the role being covered is one of
-- the three things this surface must make plain.
--
-- Standing check only (institution_staff_has_current_standing()), no
-- role restriction -- matches temporary_access's own existing SELECT
-- policy exactly ("Active staff can view their institution's temporary
-- access grants", any active staff, not principal-only). This RPC is a
-- convenience aggregation over data that's already that broadly
-- readable; narrowing it to principal-only here would be a new,
-- unasked-for restriction inconsistent with the table's own policy.
--
-- is_currently_active -- the SAME window has_active_temporary_grant()
-- (0105) itself checks (not revoked, dated today, current local time
-- within 07:30-to-cutoff), computed inline against the row already in
-- hand rather than a second EXISTS lookup per row. "A list of grants
-- with dates" makes live-right-now and ended-at-cutoff look identical
-- at a glance -- this is the one fact the client needs to tell them
-- apart without re-deriving the school's own cutoff-time logic itself
-- (a second, client-side copy of that window check would be exactly
-- the kind of duplicated-logic risk this schema's own roster RPCs are
-- built to avoid).

create function public.get_institution_temporary_access(
  p_institution_id uuid,
  p_days_back integer default 30
)
returns table (
  grant_id uuid,
  class_id uuid,
  class_name text,
  granted_to uuid,
  granted_to_name text,
  granted_by uuid,
  granted_by_name text,
  granted_by_role text,
  access_tier text,
  granted_for_date date,
  reason text,
  created_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_by_name text,
  revocation_reason text,
  is_currently_active boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    t.id as grant_id,
    t.class_id,
    c.name as class_name,
    t.granted_to,
    coalesce(gt.raw_user_meta_data ->> 'full_name', gt.raw_app_meta_data ->> 'full_name') as granted_to_name,
    t.granted_by,
    coalesce(gb.raw_user_meta_data ->> 'full_name', gb.raw_app_meta_data ->> 'full_name') as granted_by_name,
    t.granted_by_role,
    t.access_tier,
    t.granted_for_date,
    t.reason,
    t.created_at,
    t.revoked_at,
    t.revoked_by,
    coalesce(rb.raw_user_meta_data ->> 'full_name', rb.raw_app_meta_data ->> 'full_name') as revoked_by_name,
    t.revocation_reason,
    (
      t.revoked_at is null
      and t.granted_for_date = (now() at time zone public.app_local_timezone())::date
      and (now() at time zone public.app_local_timezone())::time >= '07:30'::time
      and (now() at time zone public.app_local_timezone())::time < inst.temporary_access_cutoff_time
    ) as is_currently_active
  from public.temporary_access t
  join public.classes c on c.id = t.class_id
  join public.institutions inst on inst.id = t.institution_id
  join auth.users gt on gt.id = t.granted_to
  join auth.users gb on gb.id = t.granted_by
  left join auth.users rb on rb.id = t.revoked_by
  where t.institution_id = p_institution_id
    and (
      t.revoked_at is null
      or t.granted_for_date >= (now() at time zone public.app_local_timezone())::date - p_days_back
    )
    and public.institution_staff_has_current_standing(auth.uid(), p_institution_id)
  order by t.granted_for_date desc, t.created_at desc;
$$;

grant execute on function public.get_institution_temporary_access(uuid, integer) to authenticated;
