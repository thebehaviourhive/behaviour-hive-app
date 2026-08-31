-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 3, Stage 5 follow-up. Confirmed via a live pg_policies query
-- (Daniel, 2026-08-31): "Users can view their own check-ins" is still
-- (auth.uid() = user_id) after 0144 ran -- get_todays_checkin() was
-- created successfully (proven by CHECK AAA's own RPC-based assertions
-- passing), but this specific ALTER POLICY statement did not take
-- effect. Re-presented standalone so it's unambiguous what ran and
-- what didn't. Idempotent -- safe to run even if some earlier attempt
-- partially applied.

alter policy "Users can view their own check-ins"
  on public.morning_checkins
  using (
    public.owns_passport(morning_checkins.passport_id)
  );
