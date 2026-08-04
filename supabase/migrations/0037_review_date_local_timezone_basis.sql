/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   BUG FIX (D-13) -- two places compute "today" for
   clinician_access.last_review_date using current_date, which evaluates
   in the Postgres session's timezone (UTC by default on Supabase). A
   clinician logging an ABC entry between local midnight and 1am during
   BST (UTC 23:00-00:00 the previous day) gets last_review_date stamped
   with yesterday's date from a UK/Ireland user's point of view. Low
   stakes given 14-90 day cadences, but this is the exact server-side
   now()/current_date-in-UTC-vs-client-local-time pattern worth fixing
   consistently rather than leaving two silently-differing instances.

   Fix: both the column default and the review-bumping trigger now derive
   "today" from `(now() at time zone 'Europe/Dublin')::date` instead of
   bare current_date -- a documented, DST-aware local basis (Ireland's
   named IANA zone handles the GMT/BST transition correctly on its own),
   rather than the session's arbitrary UTC default. This matches the
   client-side fix to isReviewDue() (clinician dashboard), which now
   parses lastReviewDate as a local calendar date rather than via
   new Date(string) (UTC-midnight parsing). */

alter table public.clinician_access
  alter column last_review_date set default (now() at time zone 'Europe/Dublin')::date;

create or replace function public.update_clinician_last_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.logged_by_role = 'clinician' then
    update public.clinician_access
    set last_review_date = (now() at time zone 'Europe/Dublin')::date
    where passport_id = new.passport_id
      and clinician_id = new.logged_by
      and is_active = true;
  end if;
  return new;
end;
$$;
