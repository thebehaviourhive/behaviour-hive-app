/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SECURITY FIX (C-01) -- a revoked teacher (passport_access.is_active =
   false) currently keeps full read access to a child's core passport data
   and full write access to the strategy ledger and daily updates, because
   these 7 policies (all from migration 0009) only ever checked that *a*
   passport_access row exists for (passport_id, teacher_id) -- never that
   it's still active. The is_active column itself wasn't added until a
   later migration (0014) and these 7 original policies were never
   revisited. abc_logs (0019) and every clinician policy (0026) already
   check is_active correctly -- this backports the exact same pattern.

   Every one of the 7 ALTER POLICY statements below makes exactly ONE
   change: it adds `and pa.is_active = true` (or the equivalent outer
   condition) to the existing EXISTS check. Nothing else in any of these
   policies is touched -- same tables, same joins, same auth.uid()
   comparisons, same policy names. ALTER POLICY is used deliberately
   instead of DROP + CREATE POLICY so the diff is as narrow as the SQL
   language allows: it can only ever redefine a policy that already
   exists under that exact name, it cannot rename, retarget, or recreate
   one from scratch. */

-- 1. passports SELECT
alter policy "Teachers with granted access can view a passport"
  on public.passports
  using (
    exists (
      select 1 from public.passport_access pa
      where pa.passport_id = passports.id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
    )
  );

-- 2. passport_section_b SELECT
alter policy "Teachers with granted access can view section B"
  on public.passport_section_b
  using (
    exists (
      select 1 from public.passport_access pa
      where pa.passport_id = passport_section_b.passport_id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
    )
  );

-- 3. passport_section_c SELECT
alter policy "Teachers with granted access can view section C"
  on public.passport_section_c
  using (
    exists (
      select 1 from public.passport_access pa
      where pa.passport_id = passport_section_c.passport_id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
    )
  );

-- 4. passport_section_d SELECT
alter policy "Teachers with granted access can view section D"
  on public.passport_section_d
  using (
    exists (
      select 1 from public.passport_access pa
      where pa.passport_id = passport_section_d.passport_id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
    )
  );

-- 5. morning_checkins SELECT
alter policy "Teachers with granted access can view morning check-ins"
  on public.morning_checkins
  using (
    exists (
      select 1 from public.passport_access pa
      where pa.passport_id = morning_checkins.passport_id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
    )
  );

-- 6. strategy_ledger INSERT
alter policy "Teachers can insert ledger entries for passports they can access"
  on public.strategy_ledger
  with check (
    auth.uid() = submitted_by
    and exists (
      select 1 from public.passport_access pa
      where pa.passport_id = strategy_ledger.passport_id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
    )
  );

-- 7. teacher_updates INSERT
alter policy "Teachers can insert updates for passports they can access"
  on public.teacher_updates
  with check (
    auth.uid() = teacher_id
    and exists (
      select 1 from public.passport_access pa
      where pa.passport_id = teacher_updates.passport_id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
    )
  );
