-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 5 Stage 6, Step 3 -- select_clinician_specialty()'s own reset-to-
-- pending-on-change logic (0029) is correct for the independent path
-- and wrong for a clinic practitioner, and it would have shipped
-- unhandled if not caught here. A specialty change genuinely means
-- "re-review this new claim" when Behaviour Hive is the one reviewing
-- it; it means nothing of the kind when a director's own approval is
-- the verification (0222) -- a practitioner correcting their own
-- specialty has no bearing on whether their director still vouches for
-- them. Left as-is, the first clinic practitioner who corrected a typo
-- in their own specialty would have silently un-verified themselves --
-- exactly the shape of bug that presents as "the app randomly stopped
-- working for her," with nothing in the UI to explain why.
--
-- THE FIX: the reset only ever fires when verification_route is
-- anything OTHER than 'organisation' -- null (never verified at all
-- yet, the ordinary first-verification case) or 'behaviour_hive' (the
-- independent path, where re-review on a genuine change is exactly the
-- point) keep the existing behaviour unchanged. 'organisation' never
-- resets, regardless of how many times the specialty changes.

create or replace function public.select_clinician_specialty(p_specialty text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.clinicians (user_id, specialty)
  values (auth.uid(), p_specialty)
  on conflict (user_id) do update
    set specialty = excluded.specialty,
        verification_status = case
          when public.clinicians.verification_route = 'organisation' then public.clinicians.verification_status
          when public.clinicians.specialty is distinct from excluded.specialty then 'pending'
          else public.clinicians.verification_status
        end;
end;
$$;

grant execute on function public.select_clinician_specialty(text) to authenticated;
