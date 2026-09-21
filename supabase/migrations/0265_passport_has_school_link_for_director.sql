-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Tier 1 item 2, one level deeper, 21 Sept 2026. Caught before shipping,
-- not after: the Incidents tab's own visibility decision (hide for a
-- clinic-only child, show for one who also attends a school) needs to
-- know whether a passport links to ANY school -- but passport_
-- institution_links' own "Teachers can view links for their
-- institution" policy (0014) is scoped to `s.institution_id =
-- passport_institution_links.institution_id`, the caller's OWN
-- institution only. A clinic director querying that table directly for
-- a shared child would only ever see the clinic's own row, never the
-- school's -- exactly this file's own standing "a policy that looks up
-- someone else runs under the caller's own RLS" gotcha, here hitting a
-- raw client-side SELECT rather than a policy, but the identical
-- structural cause: a caller cannot see across an institution boundary
-- through an ordinarily-scoped read.
--
-- A single boolean SECURITY DEFINER RPC, matching this schema's own
-- established shape for "does X exist, authorized by Y" checks --
-- deliberately not reusing get_institution_incidents_for_director()'s
-- own empty-vs-populated result as a proxy, since a school-attached
-- child with zero countersigned/non-withheld incidents would otherwise
-- be indistinguishable from a genuinely clinic-only child, and those
-- are different facts (Daniel's own explicit instruction: hide the tab
-- only for "clinic-only... no school attached", never for "attached but
-- nothing to show yet").

create or replace function public.get_passport_has_school_link(
  p_passport_id uuid,
  p_institution_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  -- A single boolean expression, not a WHERE-gated SELECT -- always
  -- returns exactly one real true/false row, never zero rows (which a
  -- WHERE-gated form would silently collapse to NULL for an
  -- unauthorized caller, a worse failure shape than an explicit false).
  select
    exists (
      select 1 from public.institution_staff s
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
    and exists (
      select 1
      from public.passport_institution_links pil
      join public.institutions inst on inst.id = pil.institution_id
      where pil.passport_id = p_passport_id
        and inst.type = 'school'
    );
$$;

grant execute on function public.get_passport_has_school_link(uuid, uuid) to authenticated;
