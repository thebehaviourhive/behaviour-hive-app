-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 3, Stage 1 (widened): a claimed guardian can read but not write
-- any of Sections A/B/C/D. Section A's own version of this is worse
-- than a blocked write -- it's live data corruption, reachable by an
-- ordinary tap: passport/dashboard's own "+ Add diagnoses" and "About
-- Your Child" edit links send ANY guardian to section-a unconditionally
-- (0117's "by direct URL" framing undersold this), where the existing
-- onConflict:"user_id" upsert finds no row matching a claimed
-- passport's null user_id and creates a SECOND, orphaned passport.
-- B/C/D fail differently -- passport_id is NOT NULL on all three
-- section tables, so the equivalent write there is a loud constraint
-- violation, not a silent duplicate -- still broken, not corrupting.
--
-- passports.UPDATE moves to owns_passport(id), no user_id check in
-- WITH CHECK -- that column carries dual-write-trigger/legacy meaning
-- (sync_passport_guardian_from_user_id(), 0113), not "who wrote this
-- edit"; forcing every UPDATE to rewrite it would silently reassign
-- that meaning on every claimed-guardian save. INSERT stays
-- untouched -- no passport_guardians row can exist before the very
-- first insert, so owns_passport() has nothing to check yet.
--
-- Section B/C/D's three policies each move to owns_passport(passport_
-- id); INSERT/UPDATE also require user_id = auth.uid(), safe here (no
-- trigger attached to these tables' own user_id) and correct: it
-- re-attributes the row to whichever guardian most recently wrote it,
-- the same own-contributor semantics as morning_checkins. By the time
-- anyone writes to a section table the passport (and its guardian row)
-- already exists -- self-created via the dual-write trigger, claimed
-- via redeem_passport_claim_code()'s own guardian insert -- so there's
-- no chicken-and-egg problem the way there is for passports' own
-- INSERT.
--
-- Deliberately NOT included here: dropping passport_section_b/c/d's
-- stale unique(user_id) constraints (confirmed still live, empirically,
-- against the running database -- both unique(user_id) and
-- unique(passport_id) exist simultaneously right now). That drop is
-- its own follow-up migration, after the client's onConflict retarget
-- (user_id -> passport_id) is deployed and confirmed -- dropping it
-- alongside this migration would leave any in-flight old client build
-- upserting against a constraint that no longer exists.
--
-- Live policy names confirmed against pg_policies before this ran, not
-- assumed from migration files -- 0085 is the standing reason why.

alter policy "Users can update their own passport"
  on public.passports
  using (public.owns_passport(id))
  with check (public.owns_passport(id));

alter policy "Users can view their own section B record"
  on public.passport_section_b
  using (public.owns_passport(passport_id));

alter policy "Users can insert their own section B record"
  on public.passport_section_b
  with check (public.owns_passport(passport_id) and user_id = auth.uid());

alter policy "Users can update their own section B record"
  on public.passport_section_b
  using (public.owns_passport(passport_id))
  with check (public.owns_passport(passport_id) and user_id = auth.uid());

alter policy "Users can view their own section C record"
  on public.passport_section_c
  using (public.owns_passport(passport_id));

alter policy "Users can insert their own section C record"
  on public.passport_section_c
  with check (public.owns_passport(passport_id) and user_id = auth.uid());

alter policy "Users can update their own section C record"
  on public.passport_section_c
  using (public.owns_passport(passport_id))
  with check (public.owns_passport(passport_id) and user_id = auth.uid());

alter policy "Users can view their own section D record"
  on public.passport_section_d
  using (public.owns_passport(passport_id));

alter policy "Users can insert their own section D record"
  on public.passport_section_d
  with check (public.owns_passport(passport_id) and user_id = auth.uid());

alter policy "Users can update their own section D record"
  on public.passport_section_d
  using (public.owns_passport(passport_id))
  with check (public.owns_passport(passport_id) and user_id = auth.uid());
