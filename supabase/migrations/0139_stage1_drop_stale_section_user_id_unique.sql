-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 3, Stage 1 Step 1b -- drops the three stale unique(user_id)
-- constraints on passport_section_b/c/d, superseded by unique(passport_id)
-- (migration 0113). Deliberately the SECOND of two separate deploys: the
-- client retarget (598745a) that stopped writing onConflict: "user_id"
-- against these tables is confirmed deployed to production and live-
-- verified in the browser, including the exact two-guardian last-writer
-- scenario these tables now serve. Dropping this constraint before that
-- client shipped would have broken every parent's save in the window
-- between; that risk is now closed.
--
-- Constraint names confirmed live against pg_constraint before this file
-- was written (Daniel, 2026-08-31) -- not assumed from the unnamed
-- `unique (user_id)` table-creation syntax in 0003/0004/0005.

alter table public.passport_section_b drop constraint passport_section_b_user_id_key;
alter table public.passport_section_c drop constraint passport_section_c_user_id_key;
alter table public.passport_section_d drop constraint passport_section_d_user_id_key;
