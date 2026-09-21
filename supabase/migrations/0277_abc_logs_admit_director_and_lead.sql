-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- The ABC question Daniel flagged as a possible blocker after 0276,
-- answered through the real flow (see the verification this migration
-- ships with, run live before and after): abc_logs_logged_by_role_check
-- (0065) admits only 'parent', 'class_teacher', 'clinician', 'sna' --
-- never 'principal', never 'clinical_lead'. /clinician/log/page.tsx's
-- own <ABCLogger role="clinician" /> is HARDCODED, not derived from the
-- real caller -- so a director or lead logging an observation on their
-- own caseload client had the insert succeed, but misattributed: the
-- row was stamped logged_by_role='clinician', a role they don't
-- actually hold at institution_staff. Daniel's own framing: "either
-- needs fixing" -- a refusal would have been the wrong fix (a director
-- must be able to record observations on their own clients), and a
-- silent misattribution is the wrong fix too. The real fix is both
-- halves: the CHECK constraint must admit the real value, and the
-- client must send it.
--
-- This is also why update_clinician_last_review() (0037) belongs in
-- the SAME migration, not a separate one -- Daniel's own point 2. That
-- trigger only bumps clinician_access.last_review_date `if new.
-- logged_by_role = 'clinician'`. Once the CHECK constraint admits
-- 'principal'/'clinical_lead' AND the client sends the real value (this
-- migration's own client-side half, committed alongside it), a
-- director/lead's own ABC entries will genuinely carry their real role
-- -- and without widening this trigger too, their own caseload's review
-- date would stop being bumped by their own logging, the exact bug the
-- earlier (wrong) analysis concluded couldn't happen. It can, once the
-- misattribution is fixed -- which is exactly why the two questions are
-- linked, not independent.
--
-- A THIRD layer, found only by reading the live RLS policy rather than
-- stopping at the CHECK constraint: "Clinicians can insert abc logs for
-- passports they access" (0029, live, no later override) requires
-- `logged_by_role = 'clinician'` LITERALLY in its own WITH CHECK,
-- independent of the table's CHECK constraint. Widening the constraint
-- alone would have left a director/lead's own correctly-attributed
-- insert refused outright by RLS -- the "fails" branch of Daniel's own
-- two-way framing, reintroduced one layer down from where the
-- constraint fix closed it. Widened here too, in the same migration,
-- so neither half of the fix ships without the other.

alter table public.abc_logs
  drop constraint if exists abc_logs_logged_by_role_check;
alter table public.abc_logs
  add constraint abc_logs_logged_by_role_check
  check (logged_by_role in ('parent', 'class_teacher', 'clinician', 'sna', 'principal', 'clinical_lead'));

drop policy if exists "Clinicians can insert abc logs for passports they access" on public.abc_logs;
create policy "Clinicians can insert abc logs for passports they access"
  on public.abc_logs
  for insert
  to authenticated
  with check (
    auth.uid() = logged_by
    and logged_by_role in ('clinician', 'principal', 'clinical_lead')
    and public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = abc_logs.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

create or replace function public.update_clinician_last_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.logged_by_role in ('clinician', 'clinical_lead', 'principal') then
    update public.clinician_access
    set last_review_date = (now() at time zone 'Europe/Dublin')::date
    where passport_id = new.passport_id
      and clinician_id = new.logged_by
      and is_active = true;
  end if;
  return new;
end;
$$;
