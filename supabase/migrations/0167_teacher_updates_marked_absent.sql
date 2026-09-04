-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Bulk EOD update, part 1 of 2 (client half follows in the same PR) --
-- the "absent" concept. Checked first, per instruction: neither
-- morning_checkins nor teacher_updates (nor anything else in this
-- schema) has any existing attendance/absence concept to reuse --
-- confirmed by reading both tables' live columns directly, not
-- assumed. This is genuinely new, not a second meaning for something
-- that already exists.
--
-- marked_absent is its own explicit column, not inferred from
-- settled_state/energy_level being null -- those are ALREADY nullable
-- (0007's own table never required them), so a row with everything
-- null is indistinguishable from "nobody filled it in" without a real
-- marker. That is precisely the failure this needs to not be: an
-- absence must be RECORDED, not represented as an absence of data.
--
-- A row is EITHER a real end-of-day account OR an absence marker,
-- never a confused mix of both -- enforced by the new constraint, not
-- just a convention client code is trusted to follow.
--
-- Deliberately still teacher_updates, not a new table: the existing
-- "has this child been handled today" check everywhere it's asked
-- (teacher/passport/[passportId]'s own hasSubmittedEodToday, the new
-- bulk flow's own remaining-children query) is already "does a
-- teacher_updates row exist for this passport+teacher+today" -- an
-- absence marked this way is correctly treated as "handled" by every
-- one of those checks for free, with no second query to keep in sync.

alter table public.teacher_updates
  add column marked_absent boolean not null default false;

alter table public.teacher_updates
  add constraint teacher_updates_absent_has_no_wellbeing_content
  check (
    not marked_absent
    or (settled_state is null and energy_level is null and flags is null and heads_up is null)
  );
