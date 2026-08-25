/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SCHOOL INCIDENT LOG -- the debrief sign-off gate, actually enforced.

   incident_debriefs (0068) and incidents.debrief_required (0068) have
   existed since Phase 1, but nothing has ever stopped a teacher signing
   off an incident that required a debrief and never got one -- the same
   gap the attestation gate closed for attestations (0070) existed here
   too, just never closed. This migration closes it the same way: a
   BEFORE UPDATE trigger on incidents, firing only on the
   teacher_signed_at null -> not-null transition, rejecting the write if
   debrief_required is true and no COMPLETED debrief exists.

   "Completed" means incident_debriefs.completed_at is set -- not just a
   row existing. A debrief row can exist in a part-filled, still-being-
   written state (matching every other stage-two table's own pattern:
   save fields as you go, nothing is final until it says so); only an
   explicit completion should be able to satisfy a legal sign-off gate,
   the same reasoning the attestation gate applies to a fresh
   attestation vouching for the CURRENT account rather than an old one.

   If debrief_required is false, this trigger's condition is never true
   -- the incident proceeds to sign-off without a debrief, exactly as
   specified. */

create or replace function public.guard_signoff_requires_debrief()
returns trigger
language plpgsql
as $$
begin
  if new.teacher_signed_at is not null and old.teacher_signed_at is null then
    if new.debrief_required and not exists (
      select 1 from public.incident_debriefs d
      where d.incident_id = new.id and d.completed_at is not null
    ) then
      raise exception 'Cannot sign off -- this incident requires a debrief, and none has been completed.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_signoff_debrief on public.incidents;
create trigger guard_signoff_debrief
  before update on public.incidents
  for each row
  execute function public.guard_signoff_requires_debrief();
