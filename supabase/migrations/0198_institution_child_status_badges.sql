-- Stage 7, item 1: completion icons on the principal's child cards in
-- Directory. ChildrenList.tsx's own get_institution_child_roster() call
-- returns exactly passport_id/child_name/enrolment_ended_at/
-- current_class_id (0129) -- shared across 11 other call sites, not
-- widened for principal-only badge fields, same reasoning 0160's own
-- comment gives for not widening has_child_access() itself.
--
-- One new bulk SECURITY DEFINER RPC instead, modeled on 0134's own
-- get_institution_restraints_needing_parent_call()/get_institution_
-- withdrawn_attestations() precedent -- one round trip for the whole
-- roster, not N+1. Three flags:
--   sectionAComplete   -- passports.section_a_complete, no principal
--                         SELECT policy exists on passports itself
--                         (confirmed, re-checked against every
--                         migration since 0160's own comment) so this
--                         has to be a definer function either way.
--   hasActiveClinician -- an EXISTS over clinician_access -- a table
--                         that DOES already have a principal-scoped
--                         SELECT policy (0123), but folding it into
--                         this same definer function is one round trip
--                         instead of two.
--   hasClaimedGuardian -- an EXISTS over passport_guardians, which has
--                         no principal branch at all (only "guardians
--                         can view their own link", 0113) -- definer
--                         required.
create or replace function public.get_institution_child_status_badges(p_institution_id uuid)
returns table (
  passport_id uuid,
  section_a_complete boolean,
  has_active_clinician boolean,
  has_claimed_guardian boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    coalesce(p.section_a_complete, false),
    exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = p.id and ca.is_active = true
    ),
    exists (
      select 1 from public.passport_guardians g
      where g.passport_id = p.id
    )
  from public.passports p
  join public.passport_institution_links pil on pil.passport_id = p.id
  where pil.institution_id = p_institution_id
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and s.deactivated_at is null
        and s.approved_at is not null
    );
$$;

grant execute on function public.get_institution_child_status_badges(uuid) to authenticated;
