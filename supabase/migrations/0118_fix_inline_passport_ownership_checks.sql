-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 1, Stage 5, Step 3 -- the sweep asked for after 0117: three sites
-- were already named during Stage 5's own Step 0 recon as inlining
-- "is this the passport's own owner" via a raw
-- `p.user_id = auth.uid()` check against public.passports, rather than
-- calling owns_passport() -- meaning migration 0113's rewrite (which
-- moved owns_passport() from checking passports.user_id to checking
-- passport_guardians) never touched them at all. A fresh, independent
-- sweep of the whole schema (not just re-confirming the three) found no
-- others -- these three are the complete list.
--
-- Two of the three are LIVE, reachable today by a real claimed-passport
-- guardian through the deployed app's ordinary parent flows, not
-- theoretical:
--   - "Teachers and the child's parent can view an update" (teacher_
--     updates SELECT) is queried directly by parent-dashboard/page.tsx
--     (the afternoon update card) and passport/progress/page.tsx (the
--     daily-patterns timeline, via useDailyPatterns.ts) -- both real,
--     both about to be touched by this same Step 3's own client
--     migration. Left unfixed, a claimed guardian would get their
--     passport resolved correctly and then see the teacher-update card
--     silently render as "nothing submitted today" even when something
--     was -- found and fixed BEFORE that client work landed, not
--     mid-migration.
--   - get_teacher_name() is only reachable today via a client call
--     gated behind that same (now-fixed) teacher_updates read, so it
--     was never independently exploitable through the current UI --
--     still fixed here, since it's directly callable via
--     supabase.rpc() by any authenticated user regardless of what the
--     UI currently gates it behind.
--   - "Teachers and the child's parent can view ledger entries"
--     (strategy_ledger SELECT) has no live client SELECT path at all
--     today (the only client reference is an INSERT, from the
--     teacher's own passport page) -- a real instance of the same bug,
--     currently dormant, fixed alongside the other two rather than
--     left for whenever a parent-facing ledger view gets built.

alter policy "Teachers and the child's parent can view an update"
  on public.teacher_updates
  using (
    auth.uid() = teacher_id
    or public.owns_passport(teacher_updates.passport_id)
  );

alter policy "Teachers and the child's parent can view ledger entries"
  on public.strategy_ledger
  using (
    auth.uid() = submitted_by
    or public.owns_passport(strategy_ledger.passport_id)
    or public.has_class_teacher_access(auth.uid(), strategy_ledger.passport_id)
  );

create or replace function public.get_teacher_name(p_teacher_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    u.raw_user_meta_data ->> 'full_name',
    u.raw_app_meta_data ->> 'full_name'
  )
  from auth.users u
  where u.id = p_teacher_id
    and exists (
      select 1
      from public.teacher_updates tu
      join public.passports p on p.id = tu.passport_id
      where tu.teacher_id = p_teacher_id
        and (auth.uid() = tu.teacher_id or public.owns_passport(p.id))
    );
$$;

grant execute on function public.get_teacher_name(uuid) to authenticated;
