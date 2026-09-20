-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Fixes a real bug in 0258's own sweep_bookings_for_ended_episodes(),
-- found live by the discharge-sweep verification test, not by review:
-- its own `return query select * from public.cancel_booking_for_discharge(v_row.id)`
-- selects cancel_booking_for_discharge()'s FOUR columns
-- (google_calendar_id, google_event_id, travel_before_event_id,
-- travel_after_event_id) positionally into a FIVE-column return type
-- (booking_id uuid, plus those same four) -- Postgres lined up column 1
-- of the inner result (google_calendar_id, text) against column 1 of
-- the outer declaration (booking_id, uuid) and refused outright:
-- "Returned type text does not match expected type uuid in column 1."
-- Every real discharge would have hit this the first time the sweep
-- ever actually had something to cancel. Fixed by naming every column
-- explicitly, with v_row.id supplying the one column
-- cancel_booking_for_discharge() itself never returns.

create or replace function public.sweep_bookings_for_ended_episodes()
returns table (
  booking_id uuid,
  google_calendar_id text,
  google_event_id text,
  travel_before_event_id text,
  travel_after_event_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  for v_row in
    select b.id
    from public.bookings b
    join public.episodes_of_care e
      on e.passport_id = b.passport_id and e.institution_id = b.institution_id
    where b.cancelled_at is null
      and b.session_start_at > now()
      and e.ended_at is not null
  loop
    return query
    select v_row.id, c.google_calendar_id, c.google_event_id, c.travel_before_event_id, c.travel_after_event_id
    from public.cancel_booking_for_discharge(v_row.id) c;
  end loop;
end;
$$;

revoke all on function public.sweep_bookings_for_ended_episodes() from public, authenticated, anon;
grant execute on function public.sweep_bookings_for_ended_episodes() to service_role;
