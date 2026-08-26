/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SCHOOL INCIDENT LOG -- two more post-thumb-test fixes. 0080 already
   ran, so this is its own migration rather than folded in, as agreed.

   =====================================================================
   1. "BITE (SKIN BROKEN)" SPLIT INTO TWO FACTS
   =====================================================================
   Whether skin was broken in a bite is clinically and legally material
   (infection risk, seriousness) and was previously unrecordable as its
   own fact -- combined into one seeded value, a bite that DIDN'T break
   skin had no honest option. incident_injury_types.value renamed from
   'Bite (skin broken)' to 'Bite' (the row's id is unchanged, so nothing
   that already references it by id breaks). incident_body_marks gains
   skin_broken boolean, nullable, no default -- only meaningful when the
   mark's own injury type is Bite; null for every other type. The
   client asks this only when Bite is selected -- not enforced here as
   a cross-column check, since that would mean re-deriving "is this
   mark a bite" from injury_type_id at the database layer for a fact
   the UI already knows at the point it asks the question. Flagging
   that as a deliberate choice, not an oversight.

   =====================================================================
   2. "ANSWERED NO" MUST NOT LOOK LIKE "NOT ANSWERED"
   =====================================================================
   Two Yes/No facts on this form are legal facts, not UI conveniences --
   "was anyone injured" and "NCSE report complete" -- and both idioms
   this migration touches were built the wrong way: `boolean not null
   default false`. On a legal record, an unticked box and a deliberate
   "No" must never be the same bit. Fixed to plain nullable boolean, no
   default -- three real states (true / false / null), not two.

     incidents.anyone_injured (new)     -- the paper form's own gate,
                                           "Was a student or staff
                                           member injured?", one answer
                                           for the whole incident, not
                                           per-child/per-staff-member.
                                           No consistency trigger against
                                           incident_injuries row count is
                                           added here -- that's a UI-flow
                                           guarantee (ask the gate first,
                                           only allow adding a record once
                                           it's Yes), not a database one;
                                           flagging this as a real design
                                           choice for Part 5's build to
                                           honour, not an omission.
     restrictive_practices.ncse_report_complete
                                         -- was `not null default false`.
                                           Both existing production rows
                                           happen to be true, so nothing
                                           is lost -- but note plainly:
                                           any PAST row that was actually
                                           false because nobody had
                                           answered yet, versus false
                                           because someone genuinely
                                           ticked "No", is now
                                           indistinguishable from before
                                           this fix landed. This migration
                                           can't recover a distinction
                                           that was never recorded; it
                                           only stops losing it going
                                           forward.

   Two more, found while fixing the two above, same bug, same section of
   the form, not explicitly asked for -- flagging rather than silently
   including or silently leaving them broken:

     incident_injuries.first_aider_called
     incident_injuries.doctor_ambulance_called
                                         -- also `not null default
                                           false` today. "First Aider
                                           called?" and "Doctor/
                                           Ambulance called?" are both
                                           Yes/No questions on the same
                                           welfare section as NCSE, same
                                           reasoning applies. Existing
                                           production data checked
                                           first: 5 incident_injuries
                                           rows, mix of true/false on
                                           both columns, nothing lost by
                                           the type change. Included
                                           here since it's the same fix,
                                           same migration, essentially
                                           free -- say if this should
                                           have been asked separately
                                           rather than folded in.

   Client-side, all of these move from a plain checkbox (which can only
   ever mean checked/unchecked, i.e. two states) to a genuine three-way
   Yes/No control with nothing pre-selected -- Part 4 (NCSE), Part 5
   (the injury gate), Part 7 (first aider / doctor-ambulance) build
   this. Export rendering ("No" for an answered No, "not recorded" for
   null) is not built yet -- no export exists for incidents at all yet
   in this app -- but the schema now holds the distinction correctly for
   whenever that's built. */


-- =====================================================================
-- 1. Bite / skin broken.
-- =====================================================================

update public.incident_injury_types
  set value = 'Bite'
  where value = 'Bite (skin broken)';

alter table public.incident_body_marks add column skin_broken boolean;


-- =====================================================================
-- 2. Nullable, no default -- "answered No" vs "not recorded".
-- =====================================================================

alter table public.incidents add column anyone_injured boolean;

alter table public.restrictive_practices alter column ncse_report_complete drop not null;
alter table public.restrictive_practices alter column ncse_report_complete drop default;

alter table public.incident_injuries alter column first_aider_called drop not null;
alter table public.incident_injuries alter column first_aider_called drop default;
alter table public.incident_injuries alter column doctor_ambulance_called drop not null;
alter table public.incident_injuries alter column doctor_ambulance_called drop default;
