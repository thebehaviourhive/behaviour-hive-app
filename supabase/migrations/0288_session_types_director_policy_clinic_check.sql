-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- 0287's own item 6 fix was incomplete on session_types, found by the
-- exact adversarial test the fix itself calls for: a real school
-- principal, a fake row inserted for their own institution_id, their
-- own real session attempting to read it. strategy_bank correctly
-- refused; session_types did not.
--
-- Why: session_types has TWO policies that can each independently admit
-- a SELECT -- the plain "Institution staff can view..." policy 0287
-- already fixed, and this one, "Directors can manage...", declared
-- `for all` (0281). Postgres OR-combines every permissive policy that
-- covers a given command; a `for all` policy covers SELECT too, so
-- fixing only the SELECT-specific policy left this second one standing,
-- ungated by institution type, and a principal reading through IT
-- never touched the fixed policy at all. strategy_bank never had this
-- shape -- its own write policies are INSERT-only and UPDATE-only, no
-- `for all`, so its SELECT policy was the only thing governing SELECT
-- and 0287's fix was already complete there.
--
-- Fixed the same way as every other helper in this build: the type
-- check goes directly into the policy's own predicate, in both USING
-- and WITH CHECK, not left to convention.

drop policy if exists "Directors can manage their own institution's session types" on public.session_types;
create policy "Directors can manage their own institution's session types"
  on public.session_types for all to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = session_types.institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  )
  with check (
    exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = session_types.institution_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
  );
