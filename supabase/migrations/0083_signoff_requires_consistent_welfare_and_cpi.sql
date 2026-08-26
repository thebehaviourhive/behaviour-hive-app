/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SCHOOL INCIDENT LOG -- the sign-off consistency gate, agreed in chat:
   sign-off is the correctness boundary (matches immutability, debrief,
   attestation staleness -- the one gate a client can't route around), a
   UI guard at point-of-change is a nicety on top, not a substitute.

   THREE CHECKS, ONE NEW TRIGGER, ALONGSIDE THE EXISTING THREE
   (guard_incident_immutability, guard_signoff_requires_debrief,
   guard_signoff_requires_current_attestations) -- a distinct concern
   from all three, so its own trigger, not folded into one of them.
   Fires only on the same teacher_signed_at null -> not-null transition
   they already fire on; after that, immutability already blocks any
   further change to the rows these checks read, so there's nothing to
   re-check at countersign.

   NOT security definer, unlike 0080's guards -- and that's a
   considered choice, not the same gap 0079 fixed. Those triggers
   failed because the caller (a principal granting to a DIFFERENT
   person) had no RLS path to that OTHER person's institution_staff
   row. Here, the caller signing off is always the incident's own
   creator or owning teacher, who already has full SELECT visibility
   into every table these checks read (incident_injuries,
   incident_body_marks, incident_injury_types, incident_actions,
   incident_action_types, restrictive_practices) via can_view_incident()
   on THIS SAME incident -- proven already working by the existing
   debrief/attestation guards, which aren't security definer either.

   1. anyone_injured vs incident_injuries existence. true requires at
      least one row; false requires zero. null (never answered) passes
      through untouched -- agreed in chat: treated the same way a
      missing attestation already is in this module, recorded honestly
      as absent rather than forced. The UI side of "allowed through
      must not mean invisible" (surfacing an unanswered gate on a
      pre-sign-off summary, printing "not recorded" rather than blank
      or No on export) is a client/export concern for whenever those
      screens exist -- neither exists yet, so it isn't built here; this
      migration only makes sure the schema keeps holding the
      distinction, which 0081 already established.

   2. skin_broken vs injury type. Any body mark on this incident whose
      skin_broken is not null must have an injury_type_id that actually
      resolves to 'Bite' -- catches a mark whose type was changed away
      from Bite after skin_broken was set.

   3. CPI ticked vs restrictive_practices existing -- ONE symmetric
      check, not two, because both directions in chat turned out to be
      the same biconditional: an is_restraint action present on this
      incident without any restrictive_practices row (ticking the new
      dedicated control writes the action but a record is only created
      by explicitly clicking "+ Add a restrictive practice record" --
      the fourth case, found live in Part 4's own shipped code), OR a
      restrictive_practices row existing while no is_restraint action is
      selected (unticking the control after a record was saved -- the
      original case this whole migration started from). Either shape is
      the same fact out of step with the other; one query catches both,
      with a message naming which direction is wrong. */

create or replace function public.guard_signoff_requires_consistent_records()
returns trigger
language plpgsql
as $$
declare
  v_injury_count integer;
  v_has_restraint_action boolean;
  v_has_rp_record boolean;
begin
  if new.teacher_signed_at is not null and old.teacher_signed_at is null then

    -- 1. anyone_injured vs incident_injuries.
    select count(*) into v_injury_count from public.incident_injuries where incident_id = new.id;

    if new.anyone_injured is true and v_injury_count = 0 then
      raise exception 'Cannot sign off -- "Was a student or staff member injured?" is answered Yes but no injury record exists.';
    end if;

    if new.anyone_injured is false and v_injury_count > 0 then
      raise exception 'Cannot sign off -- "Was a student or staff member injured?" is answered No but % injury record(s) still exist. Remove them or change the answer.', v_injury_count;
    end if;

    -- 2. skin_broken vs injury type.
    if exists (
      select 1
      from public.incident_body_marks bm
      join public.incident_injuries inj on inj.id = bm.injury_id
      join public.incident_injury_types it on it.id = bm.injury_type_id
      where inj.incident_id = new.id
        and bm.skin_broken is not null
        and it.value <> 'Bite'
    ) then
      raise exception 'Cannot sign off -- a body mark records whether skin was broken, but its injury type is no longer Bite.';
    end if;

    -- 3. CPI ticked vs a restrictive practice record existing -- symmetric.
    select exists (
      select 1 from public.incident_actions ia
      join public.incident_action_types iat on iat.id = ia.action_type_id
      where ia.incident_id = new.id and iat.is_restraint
    ) into v_has_restraint_action;

    select exists (
      select 1 from public.restrictive_practices where incident_id = new.id
    ) into v_has_rp_record;

    if v_has_restraint_action and not v_has_rp_record then
      raise exception 'Cannot sign off -- "CPI / restraint used" is ticked but no restrictive practice record exists.';
    end if;

    if v_has_rp_record and not v_has_restraint_action then
      raise exception 'Cannot sign off -- a restrictive practice record exists but "CPI / restraint used" is not ticked.';
    end if;

  end if;

  return new;
end;
$$;

drop trigger if exists guard_signoff_requires_consistent_records on public.incidents;
create trigger guard_signoff_requires_consistent_records
  before update on public.incidents
  for each row
  execute function public.guard_signoff_requires_consistent_records();
