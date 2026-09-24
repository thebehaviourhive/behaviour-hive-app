-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Found live during PRD 11 Stage 3's own verification, not by review:
-- a real care_staff session's own INSERT into abc_logs, chained with
-- `.select("id, stay_id")` (the ordinary PostgREST shape, needed to
-- confirm the write persisted the right stay), failed outright with
-- "permission denied for table abc_logs" -- not an RLS violation (the
-- negative controls in the same run correctly got "new row violates
-- row-level security policy," a different, expected message), and not
-- fixed by the row already passing every relevant RLS policy (proven
-- directly: the identical parent-authored row, .select("id") only,
-- succeeded; adding stay_id to that same select list was the only
-- change that broke it).
--
-- THE ROOT CAUSE: abc_logs has never had a table-wide SELECT grant to
-- authenticated. Migration 0021 replaced it with an EXPLICIT COLUMN
-- LIST grant (excluding clinical_notes) -- the one deliberate exception
-- in this schema to the "broad table grant, RLS handles row filtering"
-- pattern everywhere else, because that's the only way to keep one
-- column invisible while every OTHER column stays selectable once a
-- row passes RLS (0021's own header explains why a column-level REVOKE
-- alone can't do this when a wider table-level grant already exists).
--
-- The consequence, not obvious from reading abc_logs' own CREATE TABLE
-- statement or its RLS policies: a plain `ALTER TABLE ... ADD COLUMN`
-- does NOT make a new column selectable here, unlike every other table
-- in this schema. Nothing about that migration fails or warns -- the
-- column exists, is writable (INSERT/UPDATE grants ARE table-wide,
-- untouched by 0021), and is even readable by get_abc_logs() (SECURITY
-- DEFINER, runs as the function owner, bypasses this grant entirely) --
-- it just can't be read back by a raw client SELECT, including the
-- implicit one PostgREST performs whenever `.select()` is chained onto
-- `.insert()`/`.update()`. The error text ("permission denied") gives
-- no hint that the actual defect is a missing column grant rather than
-- a broken policy -- this codebase already has a standing entry for
-- exactly this shape of silent trap (0019's own "insert() failed with
-- a bare RLS violation... the actual defect is a missing column, not a
-- broken policy" incident, useAttachments.ts's uploaded_by omission --
-- same family, different table).
--
-- THREE COLUMNS MISSING FROM THIS GRANT, not one -- checked by grepping
-- every migration that ever ran `alter table public.abc_logs add
-- column` after 0021 and diffing against its own explicit list, not
-- assumed from stay_id alone:
--   - sensory_sought, sensory_avoided, sensory_sought_other,
--     sensory_avoided_other, perceived_function_other (migration 0067)
--   - screen_opened_at, first_input_at (migration 0173)
--   - stay_id (migration 0297, this session's own)
-- The first two gaps PREDATE this session by months and are unrelated
-- to PRD 11 -- found only because fixing stay_id required re-reading
-- 0021's own complete column list, which surfaced both immediately.
-- Fixed together, in the same statement, rather than fixing stay_id
-- alone and leaving the identical bug two more times over for someone
-- else to find independently.
--
-- The fix is the SAME REVOKE-then-GRANT shape 0021 itself used --
-- Postgres has no `GRANT SELECT (col) ON t TO role` that ADDS to an
-- existing column grant list incrementally in one statement; the clean
-- way to guarantee the final list is exactly right is to revoke and
-- reissue the complete list, the same discipline this schema already
-- applies to CHECK constraints and RLS policies (drop, then recreate
-- from the full current definition) applied here to a column grant.
revoke select on public.abc_logs from authenticated;

grant select (
  id,
  passport_id,
  logged_by,
  logged_by_role,
  incident_date,
  incident_time,
  duration_minutes,
  intensity,
  antecedents,
  antecedent_other,
  behaviours,
  behaviour_other,
  consequences,
  consequence_other,
  perceived_function,
  general_notes,
  is_draft,
  sync_status,
  created_at,
  updated_at,
  sensory_sought,
  sensory_avoided,
  sensory_sought_other,
  sensory_avoided_other,
  perceived_function_other,
  screen_opened_at,
  first_input_at,
  stay_id
) on public.abc_logs to authenticated;

notify pgrst, 'reload schema';
