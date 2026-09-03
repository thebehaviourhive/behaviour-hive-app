-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Support Button, item 7's own dependency -- "an incident being logged
-- that references it" can only auto-satisfy follow-up if we know WHICH
-- alert an incident is about. incidents.support_button_pressed (0153)
-- is a plain boolean and can't say that -- a real gap once two alerts
-- can be open at once, which is not hypothetical (a school having a bad
-- afternoon is exactly when it needs to be right).
--
-- ITS OWN MIGRATION, deliberately separate from 0157/0158, per Daniel's
-- own instruction. Only one existing caller of support_button_pressed
-- grepped and confirmed before writing this:
-- src/app/teacher/incidents/[incidentId]/page.tsx -- a plain yes/no
-- pill, saved immediately on change. Its meaning is UNCHANGED here --
-- still "was the Support Button pressed", still independently settable
-- -- this migration only ADDS an optional link to a specific alert
-- alongside it, enforced consistent by the check constraint below
-- (can't link an alert without the boolean also being true). No
-- backfill: existing support_button_pressed = true rows predate this
-- column and have no way to know which alert they meant, so they stay
-- linked to nothing, same as before this migration -- "we don't know
-- which one" is more honest than guessing.

alter table public.incidents
  add column support_alert_id uuid references public.support_alerts (id) on delete set null;

alter table public.incidents
  add constraint incidents_support_alert_requires_pressed
  check (support_alert_id is null or support_button_pressed = true);

-- Used by get_institution_outstanding_support_alerts() (0157) to check
-- "has any non-draft incident already referenced this alert" -- and by
-- the incident page's own candidate-alert picker to know which alerts
-- are still unlinked. Partial on support_alert_id is not null since
-- most incidents never reference one.
create index incidents_support_alert_id_idx
  on public.incidents (support_alert_id)
  where support_alert_id is not null;
