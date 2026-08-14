/* AFLS REBUILD -- Step 1: real item bank + multi-assessment model.

   The AFLS is conducted ON PAPER; this app is the transcription and
   results layer only. Three pieces:

   1. fba_instruments: AFLS item bank version-bumped from the
      placeholder (8 domains x 8 generic items, "SM Item 1" etc.) to
      the real 225-task bank transcribed from the paper protocol
      (scripts/afls/afls_items.json, pending clinical spot-check).
      Same versioning mechanism the table already had (version int +
      is_active bool, migration 0040) -- the old version=1 rows are
      set is_active=false ("inert"), never deleted, so the placeholder
      history stays inspectable. A later spot-check correction to item
      text/max/naRule is a data UPDATE to these rows, never a code
      change.

   2. afls_assessments: a new table replacing fba_afls_data's
      one-row-per-FBA shape with one row PER ASSESSMENT -- the paper
      protocol's own repeated-assessment design, and the foundation
      for a future re-assessment comparison view. scores is jsonb
      keyed by task code -> integer score (0..maxScore) or the literal
      string "NA".

   3. fba_afls_data (the OLD table) is DROPPED outright, not migrated.
      Confirmed test-data-only: no seed script (scripts/demo/seed.mjs)
      references it, and the scoring model itself is being fully
      replaced (old: a universal independent/assisted/unable/na
      4-state pick per item; new: a numeric 0..maxScore score per task,
      keyed by a different id scheme entirely -- "self-management-1"
      vs "SM1"). There is no meaningful translation between the two,
      and once the app-code changes in later steps land, nothing reads
      this table again. If real clinical scores were ever recorded
      against it, this migration should NOT be run as-is -- flagged
      here for the human running it to confirm before executing.

   RLS on afls_assessments mirrors fba_calm_cards (migration 0053)
   EXACTLY, not fba_afls_data's old pattern: full clinician CRUD via
   the same active+verified clinician_access join, DELIBERATELY
   WITHOUT an fr.status <> 'completed' guard on insert/update/delete.
   This is the brief's own "companion layer, like Calm Cards" ask --
   the paper assessment may be conducted and transcribed after the FBA
   is finalized, so entry stays open post-completion. Since this is a
   real standalone table (not a JSONB key inside fba_reports.content_data
   the way strategy tags are), a direct RLS policy is enough -- no
   SECURITY DEFINER companion RPC needed the way update_locked_strategy_tag
   was for migration 0055's tags-in-JSONB case.

   Parent SELECT stays gated on the PARENT fba_reports row's
   status='completed' (same as fba_afls_data always was) -- a parent
   never sees assessment data on an FBA that isn't finalized yet, even
   though the clinician can keep adding assessments before then.
   Teachers get no policy at all -- zero rows, deny-by-default, same
   as every other clinical FBA table. */


-- ============================================================
-- AFLS real item bank -- version 2, one fba_instruments row per
-- domain (matches migration 0040's existing pattern). category
-- is the domain CODE (e.g. 'SM'), not the display name -- a
-- short, unambiguous grouping key across 225 rows. Domain
-- code -> display name is a small structural constant in code
-- (8 fixed domains from the paper protocol itself), not part of
-- this data. Each item carries maxScore (2 or 4, the task's own
-- 0..maxScore scale) and an optional naRule -- replacing the
-- placeholder's fixed 4-state qualitative scale entirely, since
-- the real protocol scores each task numerically against its
-- own scale, not a universal independent/assisted/unable/na set.
-- ============================================================

update public.fba_instruments
set is_active = false
where instrument_type = 'afls' and version = 1;

insert into public.fba_instruments (instrument_type, version, items, is_active)
values ('afls', 2, '[{"id": "SM1", "text": "Aggression towards others", "answer_type": "afls_scale", "category": "SM", "maxScore": 2}, {"id": "SM2", "text": "Self-injurious behavior", "answer_type": "afls_scale", "category": "SM", "maxScore": 2}, {"id": "SM3", "text": "Disruptive behavior", "answer_type": "afls_scale", "category": "SM", "maxScore": 2}, {"id": "SM4", "text": "Socially acceptable behavior in a variety of settings", "answer_type": "afls_scale", "category": "SM", "maxScore": 2}, {"id": "SM5", "text": "Follows directions from multiple caregivers", "answer_type": "afls_scale", "category": "SM", "maxScore": 2}, {"id": "SM6", "text": "Cooperates and obeys rules in multiple locations", "answer_type": "afls_scale", "category": "SM", "maxScore": 4}, {"id": "SM7", "text": "Remains calm when learner needs to stay seated", "answer_type": "afls_scale", "category": "SM", "maxScore": 4}, {"id": "SM8", "text": "Remains calm when there is a change in direction while walking or riding in car", "answer_type": "afls_scale", "category": "SM", "maxScore": 2}, {"id": "SM9", "text": "Remains calm when items are moved from a specific position", "answer_type": "afls_scale", "category": "SM", "maxScore": 2}, {"id": "SM10", "text": "Remains calm when required to wear different clothing, shoes, etc.", "answer_type": "afls_scale", "category": "SM", "maxScore": 2}, {"id": "SM11", "text": "Consumes a healthy variety of foods and eats foods as typically prepared", "answer_type": "afls_scale", "category": "SM", "maxScore": 2}, {"id": "SM12", "text": "Remains calm when loud or unexpected noises are present", "answer_type": "afls_scale", "category": "SM", "maxScore": 2}, {"id": "SM13", "text": "Remains calm when schedule changed, preferred items restricted, told No or made to wait", "answer_type": "afls_scale", "category": "SM", "maxScore": 4}, {"id": "SM14", "text": "Remains calm during suddenly occurring or unexpected events", "answer_type": "afls_scale", "category": "SM", "maxScore": 2}, {"id": "SM15", "text": "Remains calm when there is a change in common routine", "answer_type": "afls_scale", "category": "SM", "maxScore": 2}, {"id": "SM16", "text": "Remains calm when missing required items", "answer_type": "afls_scale", "category": "SM", "maxScore": 2}, {"id": "SM17", "text": "Remains calm when having trouble performing difficult or multiple step tasks", "answer_type": "afls_scale", "category": "SM", "maxScore": 2}, {"id": "SM18", "text": "Remains calm when group or friend makes decision that learner must follow", "answer_type": "afls_scale", "category": "SM", "maxScore": 2}, {"id": "SM19", "text": "Remains calm during hygiene and grooming routines", "answer_type": "afls_scale", "category": "SM", "maxScore": 2}, {"id": "SM20", "text": "Allows hair to be cut", "answer_type": "afls_scale", "category": "SM", "maxScore": 2}, {"id": "SM21", "text": "Refrains from touching others'' possessions", "answer_type": "afls_scale", "category": "SM", "maxScore": 2}, {"id": "SM22", "text": "Identifies major norms and rules in community settings and inappropriate behaviors", "answer_type": "afls_scale", "category": "SM", "maxScore": 2}, {"id": "SM23", "text": "Complies with various authority figures", "answer_type": "afls_scale", "category": "SM", "maxScore": 2}, {"id": "SM24", "text": "Takes appropriate action to deal with or report wrongdoing by others", "answer_type": "afls_scale", "category": "SM", "maxScore": 4}, {"id": "SM25", "text": "Asks for reasonable modifications in environment", "answer_type": "afls_scale", "category": "SM", "maxScore": 2}]'::jsonb, true);

insert into public.fba_instruments (instrument_type, version, items, is_active)
values ('afls', 2, '[{"id": "BC1", "text": "Follows instructions", "answer_type": "afls_scale", "category": "BC", "maxScore": 4}, {"id": "BC2", "text": "Follows sequence of instructions", "answer_type": "afls_scale", "category": "BC", "maxScore": 2}, {"id": "BC3", "text": "Uses communication device", "answer_type": "afls_scale", "category": "BC", "maxScore": 2, "naRule": "na_if_talks"}, {"id": "BC4", "text": "Spontaneous requests for items and activities", "answer_type": "afls_scale", "category": "BC", "maxScore": 4}, {"id": "BC5", "text": "Requests missing items needed for a task", "answer_type": "afls_scale", "category": "BC", "maxScore": 4}, {"id": "BC6", "text": "Requests help", "answer_type": "afls_scale", "category": "BC", "maxScore": 4}, {"id": "BC7", "text": "Requests information using What, Where, Who, and When", "answer_type": "afls_scale", "category": "BC", "maxScore": 4}, {"id": "BC8", "text": "Requests information using How and Why", "answer_type": "afls_scale", "category": "BC", "maxScore": 2}, {"id": "BC9", "text": "Labels common objects", "answer_type": "afls_scale", "category": "BC", "maxScore": 4}, {"id": "BC10", "text": "Labels common people", "answer_type": "afls_scale", "category": "BC", "maxScore": 4}, {"id": "BC11", "text": "Labels common actions", "answer_type": "afls_scale", "category": "BC", "maxScore": 4}, {"id": "BC12", "text": "Labels locations", "answer_type": "afls_scale", "category": "BC", "maxScore": 4}, {"id": "BC13", "text": "Labels adjectives", "answer_type": "afls_scale", "category": "BC", "maxScore": 4}, {"id": "BC14", "text": "Labels prepositions", "answer_type": "afls_scale", "category": "BC", "maxScore": 4}, {"id": "BC15", "text": "Answers questions regarding personal information", "answer_type": "afls_scale", "category": "BC", "maxScore": 4}, {"id": "BC16", "text": "Answers Where questions regarding home, school, and community", "answer_type": "afls_scale", "category": "BC", "maxScore": 4}, {"id": "BC17", "text": "Answers What questions regarding home, school, and community", "answer_type": "afls_scale", "category": "BC", "maxScore": 4}, {"id": "BC18", "text": "Names people and activities previously observed", "answer_type": "afls_scale", "category": "BC", "maxScore": 4}, {"id": "BC19", "text": "Reads simple words", "answer_type": "afls_scale", "category": "BC", "maxScore": 4}, {"id": "BC20", "text": "Functional community words, universal symbols, and safety signs", "answer_type": "afls_scale", "category": "BC", "maxScore": 2}, {"id": "BC21", "text": "Writes or types own name", "answer_type": "afls_scale", "category": "BC", "maxScore": 2}, {"id": "BC22", "text": "Spells dictated words by writing or typing", "answer_type": "afls_scale", "category": "BC", "maxScore": 4}]'::jsonb, true);

insert into public.fba_instruments (instrument_type, version, items, is_active)
values ('afls', 2, '[{"id": "DR1", "text": "Pants up and down", "answer_type": "afls_scale", "category": "DR", "maxScore": 4}, {"id": "DR2", "text": "Pants on and off", "answer_type": "afls_scale", "category": "DR", "maxScore": 4}, {"id": "DR3", "text": "Shoes on and off", "answer_type": "afls_scale", "category": "DR", "maxScore": 4}, {"id": "DR4", "text": "Boots on and off", "answer_type": "afls_scale", "category": "DR", "maxScore": 4}, {"id": "DR5", "text": "Socks on and off", "answer_type": "afls_scale", "category": "DR", "maxScore": 4}, {"id": "DR6", "text": "Ties shoes", "answer_type": "afls_scale", "category": "DR", "maxScore": 4}, {"id": "DR7", "text": "Pullover shirts on and off", "answer_type": "afls_scale", "category": "DR", "maxScore": 4}, {"id": "DR8", "text": "Buttoning shirts on and off", "answer_type": "afls_scale", "category": "DR", "maxScore": 4}, {"id": "DR9", "text": "Fastens buttons", "answer_type": "afls_scale", "category": "DR", "maxScore": 4}, {"id": "DR10", "text": "Buttons and unbuttons shirt sleeves", "answer_type": "afls_scale", "category": "DR", "maxScore": 4}, {"id": "DR11", "text": "Coat on and off", "answer_type": "afls_scale", "category": "DR", "maxScore": 4}, {"id": "DR12", "text": "Puts on various hats", "answer_type": "afls_scale", "category": "DR", "maxScore": 2}, {"id": "DR13", "text": "Puts on and takes off mittens", "answer_type": "afls_scale", "category": "DR", "maxScore": 4}, {"id": "DR14", "text": "Puts on and takes off gloves", "answer_type": "afls_scale", "category": "DR", "maxScore": 4}, {"id": "DR15", "text": "Unzips zippers", "answer_type": "afls_scale", "category": "DR", "maxScore": 2}, {"id": "DR16", "text": "Fastens and zips a zipper", "answer_type": "afls_scale", "category": "DR", "maxScore": 4}, {"id": "DR17", "text": "Fastens snaps", "answer_type": "afls_scale", "category": "DR", "maxScore": 4}, {"id": "DR18", "text": "Hooks and unhooks fasteners", "answer_type": "afls_scale", "category": "DR", "maxScore": 2}, {"id": "DR19", "text": "Attaches Velcro", "answer_type": "afls_scale", "category": "DR", "maxScore": 2}, {"id": "DR20", "text": "Puts on a belt", "answer_type": "afls_scale", "category": "DR", "maxScore": 4}, {"id": "DR21", "text": "Fastens and unfastens buckles on a belt", "answer_type": "afls_scale", "category": "DR", "maxScore": 4}, {"id": "DR22", "text": "Puts on clothing right-side out", "answer_type": "afls_scale", "category": "DR", "maxScore": 2}, {"id": "DR23", "text": "Adjusts clothing when needed", "answer_type": "afls_scale", "category": "DR", "maxScore": 2}, {"id": "DR24", "text": "Identifies clothes that do not fit properly", "answer_type": "afls_scale", "category": "DR", "maxScore": 2}, {"id": "DR25", "text": "Identifies clothes worn for different settings and occasions", "answer_type": "afls_scale", "category": "DR", "maxScore": 2}, {"id": "DR26", "text": "Wears shoes according to activity or weather", "answer_type": "afls_scale", "category": "DR", "maxScore": 2}, {"id": "DR27", "text": "Selects clothing appropriate to climate", "answer_type": "afls_scale", "category": "DR", "maxScore": 2}, {"id": "DR28", "text": "Matches clothing styles and colors", "answer_type": "afls_scale", "category": "DR", "maxScore": 2}, {"id": "DR29", "text": "Selects own clothes and dresses self", "answer_type": "afls_scale", "category": "DR", "maxScore": 4}, {"id": "DR30", "text": "Brings extra clothes as needed for an outing", "answer_type": "afls_scale", "category": "DR", "maxScore": 2}, {"id": "DR31", "text": "Selects clothes to pack for a trip", "answer_type": "afls_scale", "category": "DR", "maxScore": 4}, {"id": "DR32", "text": "Packs an overnight bag", "answer_type": "afls_scale", "category": "DR", "maxScore": 4}, {"id": "DR33", "text": "Bra on and off", "answer_type": "afls_scale", "category": "DR", "maxScore": 4, "naRule": "male_na"}, {"id": "DR34", "text": "Puts on and removes earrings", "answer_type": "afls_scale", "category": "DR", "maxScore": 4}, {"id": "DR35", "text": "Keeps earrings clean", "answer_type": "afls_scale", "category": "DR", "maxScore": 2}, {"id": "DR36", "text": "Puts on clip-on tie", "answer_type": "afls_scale", "category": "DR", "maxScore": 2}, {"id": "DR37", "text": "Ties a neck tie", "answer_type": "afls_scale", "category": "DR", "maxScore": 4}]'::jsonb, true);

insert into public.fba_instruments (instrument_type, version, items, is_active)
values ('afls', 2, '[{"id": "TL1", "text": "Consistent pre-toilet behavior", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL2", "text": "Correctly answers wet/dry/soiled", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL3", "text": "Expresses when wet", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL4", "text": "Expresses when soiled", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL5", "text": "Raises and lowers toilet seat before using toilet", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL6", "text": "Sits on toilet and keeps hands out of toilet water", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL7", "text": "Urinates in toilet", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL8", "text": "Defecates in toilet", "answer_type": "afls_scale", "category": "TL", "maxScore": 4}, {"id": "TL9", "text": "Sits on toilet until finished", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL10", "text": "Uses toilet paper", "answer_type": "afls_scale", "category": "TL", "maxScore": 4}, {"id": "TL11", "text": "Checks toilet paper is present prior to using toilet", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL12", "text": "Flushes toilet", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL13", "text": "Washes hands after using restroom", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL14", "text": "Remains dry on toileting schedule", "answer_type": "afls_scale", "category": "TL", "maxScore": 4}, {"id": "TL15", "text": "Asks to go to the bathroom", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL16", "text": "Independently stays dry during waking hours", "answer_type": "afls_scale", "category": "TL", "maxScore": 4}, {"id": "TL17", "text": "Stays dry at night", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL18", "text": "Uses the bathroom fan at home", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL19", "text": "Changes toilet paper roll when empty", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL20", "text": "Cleans urine that missed toilet", "answer_type": "afls_scale", "category": "TL", "maxScore": 4}, {"id": "TL21", "text": "Identifies restroom signs", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL22", "text": "Identifies vacant/occupied signs in public restrooms", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL23", "text": "Determines if a stall is vacant", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL24", "text": "Chooses appropriate stall", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL25", "text": "Flushes toilet if left unflushed by others prior to use", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL26", "text": "Uses toilet seat liners", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL27", "text": "Cleans a dirty public toilet seat", "answer_type": "afls_scale", "category": "TL", "maxScore": 4}, {"id": "TL28", "text": "Waits to enter single seat stall (no line)", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL29", "text": "Waits for next available urinal or stall (lineup required)", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL30", "text": "Closes stall door", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL31", "text": "Avoids conversation with strangers in public restrooms", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL32", "text": "Dries hands with towels, paper towels, and electric dryers in public", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL33", "text": "Uses toilet before long trip", "answer_type": "afls_scale", "category": "TL", "maxScore": 2}, {"id": "TL34", "text": "Puts on panty liner or pad on underwear", "answer_type": "afls_scale", "category": "TL", "maxScore": 4, "naRule": "male_na"}, {"id": "TL35", "text": "Changes and disposes of sanitary products", "answer_type": "afls_scale", "category": "TL", "maxScore": 4, "naRule": "male_na"}, {"id": "TL36", "text": "Identifies feminine hygiene product required", "answer_type": "afls_scale", "category": "TL", "maxScore": 2, "naRule": "male_na"}, {"id": "TL37", "text": "Counts out days of menstrual cycle and marks on calendar", "answer_type": "afls_scale", "category": "TL", "maxScore": 2, "naRule": "male_na"}, {"id": "TL38", "text": "Checks and changes pad as needed", "answer_type": "afls_scale", "category": "TL", "maxScore": 2, "naRule": "male_na"}, {"id": "TL39", "text": "Urinates in bowl while standing", "answer_type": "afls_scale", "category": "TL", "maxScore": 2, "naRule": "female_na"}, {"id": "TL40", "text": "Stands appropriately at urinal", "answer_type": "afls_scale", "category": "TL", "maxScore": 2, "naRule": "female_na"}, {"id": "TL41", "text": "Chooses correct urinal", "answer_type": "afls_scale", "category": "TL", "maxScore": 2, "naRule": "female_na"}]'::jsonb, true);

insert into public.fba_instruments (instrument_type, version, items, is_active)
values ('afls', 2, '[{"id": "GR1", "text": "Turns on and off sink faucet", "answer_type": "afls_scale", "category": "GR", "maxScore": 4}, {"id": "GR2", "text": "Washes hands", "answer_type": "afls_scale", "category": "GR", "maxScore": 2}, {"id": "GR3", "text": "Tolerates teeth being brushed by others", "answer_type": "afls_scale", "category": "GR", "maxScore": 4}, {"id": "GR4", "text": "Takes off and puts on cap of toothpaste", "answer_type": "afls_scale", "category": "GR", "maxScore": 4}, {"id": "GR5", "text": "Puts toothpaste on toothbrush", "answer_type": "afls_scale", "category": "GR", "maxScore": 4}, {"id": "GR6", "text": "Brushes teeth", "answer_type": "afls_scale", "category": "GR", "maxScore": 4}, {"id": "GR7", "text": "Rinses toothbrush", "answer_type": "afls_scale", "category": "GR", "maxScore": 2}, {"id": "GR8", "text": "Returns toothbrush and toothpaste to proper location", "answer_type": "afls_scale", "category": "GR", "maxScore": 2}, {"id": "GR9", "text": "Rinses sink", "answer_type": "afls_scale", "category": "GR", "maxScore": 2}, {"id": "GR10", "text": "Uses mouthwash", "answer_type": "afls_scale", "category": "GR", "maxScore": 4}, {"id": "GR11", "text": "Flosses teeth", "answer_type": "afls_scale", "category": "GR", "maxScore": 4}, {"id": "GR12", "text": "Completes oral hygiene process at least twice a day", "answer_type": "afls_scale", "category": "GR", "maxScore": 2}, {"id": "GR13", "text": "Regulates water temperature", "answer_type": "afls_scale", "category": "GR", "maxScore": 4}, {"id": "GR14", "text": "Washes and dries face", "answer_type": "afls_scale", "category": "GR", "maxScore": 4}, {"id": "GR15", "text": "Blows nose", "answer_type": "afls_scale", "category": "GR", "maxScore": 4}, {"id": "GR16", "text": "Combs or brushes hair", "answer_type": "afls_scale", "category": "GR", "maxScore": 4}, {"id": "GR17", "text": "Applies chap stick", "answer_type": "afls_scale", "category": "GR", "maxScore": 2}, {"id": "GR18", "text": "Applies lotion to body", "answer_type": "afls_scale", "category": "GR", "maxScore": 4}, {"id": "GR19", "text": "Clips and cleans fingernails", "answer_type": "afls_scale", "category": "GR", "maxScore": 4}, {"id": "GR20", "text": "Clips and cleans toenails", "answer_type": "afls_scale", "category": "GR", "maxScore": 4}, {"id": "GR21", "text": "Uses deodorant", "answer_type": "afls_scale", "category": "GR", "maxScore": 2}, {"id": "GR22", "text": "Uses bathroom mirror", "answer_type": "afls_scale", "category": "GR", "maxScore": 2}, {"id": "GR23", "text": "Cleans eyeglasses or sunglasses", "answer_type": "afls_scale", "category": "GR", "maxScore": 2}, {"id": "GR24", "text": "Packs toiletry bag for trip", "answer_type": "afls_scale", "category": "GR", "maxScore": 2}, {"id": "GR25", "text": "Shaves legs", "answer_type": "afls_scale", "category": "GR", "maxScore": 4, "naRule": "male_na"}, {"id": "GR26", "text": "Applies make-up", "answer_type": "afls_scale", "category": "GR", "maxScore": 2, "naRule": "male_na"}, {"id": "GR27", "text": "Removes make-up", "answer_type": "afls_scale", "category": "GR", "maxScore": 2, "naRule": "male_na"}, {"id": "GR28", "text": "Applies nail polish to fingernails and toenails", "answer_type": "afls_scale", "category": "GR", "maxScore": 4, "naRule": "male_na"}, {"id": "GR29", "text": "Shaves face", "answer_type": "afls_scale", "category": "GR", "maxScore": 4, "naRule": "female_na"}, {"id": "GR30", "text": "Cleans dental/orthodontic appliances", "answer_type": "afls_scale", "category": "GR", "maxScore": 4}, {"id": "GR31", "text": "Puts in and removes contact lenses", "answer_type": "afls_scale", "category": "GR", "maxScore": 4}, {"id": "GR32", "text": "Cares for contact lenses", "answer_type": "afls_scale", "category": "GR", "maxScore": 2}, {"id": "GR33", "text": "Applies acne medicine", "answer_type": "afls_scale", "category": "GR", "maxScore": 2}, {"id": "GR34", "text": "Puts in hearing aid(s)", "answer_type": "afls_scale", "category": "GR", "maxScore": 2}]'::jsonb, true);

insert into public.fba_instruments (instrument_type, version, items, is_active)
values ('afls', 2, '[{"id": "BT1", "text": "Ensures needed items are in bathroom", "answer_type": "afls_scale", "category": "BT", "maxScore": 2}, {"id": "BT2", "text": "Puts dirty clothes in hamper", "answer_type": "afls_scale", "category": "BT", "maxScore": 2}, {"id": "BT3", "text": "Operates shower or bathtub faucet", "answer_type": "afls_scale", "category": "BT", "maxScore": 2}, {"id": "BT4", "text": "Regulates water temperature", "answer_type": "afls_scale", "category": "BT", "maxScore": 4}, {"id": "BT5", "text": "Fills bath tub with water", "answer_type": "afls_scale", "category": "BT", "maxScore": 4}, {"id": "BT6", "text": "Washes body", "answer_type": "afls_scale", "category": "BT", "maxScore": 4}, {"id": "BT7", "text": "Rinses body in bathtub or shower", "answer_type": "afls_scale", "category": "BT", "maxScore": 4}, {"id": "BT8", "text": "Drains bathtub", "answer_type": "afls_scale", "category": "BT", "maxScore": 2}, {"id": "BT9", "text": "Keeps shower curtain/door closed", "answer_type": "afls_scale", "category": "BT", "maxScore": 2}, {"id": "BT10", "text": "Washes hair", "answer_type": "afls_scale", "category": "BT", "maxScore": 4}, {"id": "BT11", "text": "Dries body after bath or shower", "answer_type": "afls_scale", "category": "BT", "maxScore": 4}, {"id": "BT12", "text": "Hangs towel on rack or hook", "answer_type": "afls_scale", "category": "BT", "maxScore": 2}, {"id": "BT13", "text": "Blow dries hair", "answer_type": "afls_scale", "category": "BT", "maxScore": 2}]'::jsonb, true);

insert into public.fba_instruments (instrument_type, version, items, is_active)
values ('afls', 2, '[{"id": "HS1", "text": "Remains in area", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS2", "text": "Practices water safety", "answer_type": "afls_scale", "category": "HS", "maxScore": 4}, {"id": "HS3", "text": "Finds side of pool and hangs on", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS4", "text": "Doggie paddles", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS5", "text": "Floats in water", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS6", "text": "Labels things that could be hot", "answer_type": "afls_scale", "category": "HS", "maxScore": 4}, {"id": "HS7", "text": "Checks to see if things are hot", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS8", "text": "Receptively identifies poisonous or dangerous household materials", "answer_type": "afls_scale", "category": "HS", "maxScore": 4}, {"id": "HS9", "text": "States difference between friend, acquaintance, and stranger", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS10", "text": "Keeps doors shut and locked when stranger knocks", "answer_type": "afls_scale", "category": "HS", "maxScore": 4}, {"id": "HS11", "text": "States various dangerous situations", "answer_type": "afls_scale", "category": "HS", "maxScore": 4}, {"id": "HS12", "text": "Locates and retrieves first-aid kit", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS13", "text": "Stops bleeding of minor cuts", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS14", "text": "Puts on bandage", "answer_type": "afls_scale", "category": "HS", "maxScore": 4}, {"id": "HS15", "text": "Treats minor burns", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS16", "text": "Treats burns with burn lotion", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS17", "text": "Seeks assistance for serious cuts, burns, or injuries", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS18", "text": "Retrieves and uses flashlight", "answer_type": "afls_scale", "category": "HS", "maxScore": 4}, {"id": "HS19", "text": "Reports smoke and fire", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS20", "text": "Responds to smoke detectors and fire alarms", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS21", "text": "States how to exit in case of fire", "answer_type": "afls_scale", "category": "HS", "maxScore": 4}, {"id": "HS22", "text": "Calls 911 and reports key facts", "answer_type": "afls_scale", "category": "HS", "maxScore": 4}, {"id": "HS23", "text": "Protects self from the sun", "answer_type": "afls_scale", "category": "HS", "maxScore": 4}, {"id": "HS24", "text": "Applies hand sanitizer", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS25", "text": "Maintains hydration", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS26", "text": "Reports pain level on smiley chart", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS27", "text": "Verbally reports pain", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS28", "text": "Determines if fever is present", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS29", "text": "Swallows liquid medicine", "answer_type": "afls_scale", "category": "HS", "maxScore": 4}, {"id": "HS30", "text": "Swallows pills", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS31", "text": "Cooperates with physical examinations", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS32", "text": "Cooperates with dental examination and teeth cleaning", "answer_type": "afls_scale", "category": "HS", "maxScore": 4}, {"id": "HS33", "text": "Receptive medicine identification", "answer_type": "afls_scale", "category": "HS", "maxScore": 4}, {"id": "HS34", "text": "Expressive identification of non-prescription medicine", "answer_type": "afls_scale", "category": "HS", "maxScore": 4}, {"id": "HS35", "text": "Describes medicines used for symptoms", "answer_type": "afls_scale", "category": "HS", "maxScore": 4}, {"id": "HS36", "text": "States conditions requiring a doctor", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS37", "text": "Avoids allergens", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS38", "text": "Informs others of personal medical conditions, allergies, etc.", "answer_type": "afls_scale", "category": "HS", "maxScore": 2}, {"id": "HS39", "text": "Uses asthma inhaler", "answer_type": "afls_scale", "category": "HS", "maxScore": 4}]'::jsonb, true);

insert into public.fba_instruments (instrument_type, version, items, is_active)
values ('afls', 2, '[{"id": "NR1", "text": "Goes to bed when told", "answer_type": "afls_scale", "category": "NR", "maxScore": 4}, {"id": "NR2", "text": "Goes to bed at set time", "answer_type": "afls_scale", "category": "NR", "maxScore": 4}, {"id": "NR3", "text": "Gathers desired bedtime items", "answer_type": "afls_scale", "category": "NR", "maxScore": 4}, {"id": "NR4", "text": "Closes drapes or windows", "answer_type": "afls_scale", "category": "NR", "maxScore": 2}, {"id": "NR5", "text": "Turns on or plugs in night light", "answer_type": "afls_scale", "category": "NR", "maxScore": 2}, {"id": "NR6", "text": "Turns off lights", "answer_type": "afls_scale", "category": "NR", "maxScore": 2}, {"id": "NR7", "text": "Falls asleep without an adult present", "answer_type": "afls_scale", "category": "NR", "maxScore": 2}, {"id": "NR8", "text": "Sleeps in own bed all night", "answer_type": "afls_scale", "category": "NR", "maxScore": 2}, {"id": "NR9", "text": "Straightens bed in morning", "answer_type": "afls_scale", "category": "NR", "maxScore": 2}, {"id": "NR10", "text": "Sets alarm clock", "answer_type": "afls_scale", "category": "NR", "maxScore": 2}, {"id": "NR11", "text": "Follows all steps to get ready for bed", "answer_type": "afls_scale", "category": "NR", "maxScore": 2}, {"id": "NR12", "text": "Independently goes to bed at appropriate time", "answer_type": "afls_scale", "category": "NR", "maxScore": 2}, {"id": "NR13", "text": "Sleeps for an adequate amount of time", "answer_type": "afls_scale", "category": "NR", "maxScore": 2}, {"id": "NR14", "text": "Gets up independently in the morning when the alarm rings", "answer_type": "afls_scale", "category": "NR", "maxScore": 2}]'::jsonb, true);

-- ============================================================
-- 2. afls_assessments -- multi-assessment model, one row per
--    transcribed paper assessment
-- ============================================================

create table public.afls_assessments (
  id uuid primary key default gen_random_uuid(),
  fba_id uuid not null references public.fba_reports (id) on delete cascade,
  -- Editable -- paper assessments are transcribed retrospectively, so
  -- the date scored on paper rarely matches the date it's typed in.
  assessment_date date not null default current_date,
  -- Pre-filled with the authoring clinician's own name client-side,
  -- but editable free text (not a foreign key to clinicians) -- a
  -- different person may have actually administered the paper
  -- protocol than the clinician transcribing it.
  assessor_name text not null default '',
  -- {task_code: integer_score | "NA"}. Unscored tasks are simply
  -- absent from this object -- partial assessments are valid, per the
  -- brief ("unscored tasks allowed").
  scores jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index afls_assessments_fba_id_idx on public.afls_assessments (fba_id);

drop trigger if exists set_afls_assessments_updated_at on public.afls_assessments;
create trigger set_afls_assessments_updated_at
  before update on public.afls_assessments
  for each row
  execute function public.set_updated_at();

alter table public.afls_assessments enable row level security;

-- ============================================================
-- Clinician: full CRUD on assessments belonging to their OWN FBAs.
-- Same active + verified clinician_access check every other clinical
-- FBA table uses, reached via a join since this table has no
-- clinician_id column of its own -- DELIBERATELY WITHOUT fba_reports'
-- "status <> 'completed'" guard (see header comment: companion layer,
-- same posture as fba_calm_cards).
-- ============================================================

create policy "Clinicians can view their own AFLS assessments"
  on public.afls_assessments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.fba_reports fr
      where fr.id = afls_assessments.fba_id
        and fr.clinician_id = auth.uid()
        and public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = fr.passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
    )
  );

create policy "Clinicians can create AFLS assessments on their own FBAs"
  on public.afls_assessments
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.fba_reports fr
      where fr.id = afls_assessments.fba_id
        and fr.clinician_id = auth.uid()
        and public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = fr.passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
    )
  );

create policy "Clinicians can update their own AFLS assessments"
  on public.afls_assessments
  for update
  to authenticated
  using (
    exists (
      select 1 from public.fba_reports fr
      where fr.id = afls_assessments.fba_id
        and fr.clinician_id = auth.uid()
        and public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = fr.passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
    )
  )
  with check (
    exists (
      select 1 from public.fba_reports fr
      where fr.id = afls_assessments.fba_id
        and fr.clinician_id = auth.uid()
        and public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = fr.passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
    )
  );

create policy "Clinicians can delete their own AFLS assessments"
  on public.afls_assessments
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.fba_reports fr
      where fr.id = afls_assessments.fba_id
        and fr.clinician_id = auth.uid()
        and public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = fr.passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
    )
  );

-- ============================================================
-- Parent: SELECT only, only once the FBA is finalized (status =
-- 'completed') -- same gate fba_afls_data always used. No parent
-- INSERT/UPDATE/DELETE policy exists, so RLS denies those outright.
-- ============================================================

create policy "Parents can view AFLS assessments for their completed FBAs"
  on public.afls_assessments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.fba_reports fr
      where fr.id = afls_assessments.fba_id
        and fr.status = 'completed'
        and public.owns_passport(fr.passport_id)
    )
  );

-- No policy at all for teachers -- RLS defaults to deny, exactly like
-- fba_afls_data / fba_calm_cards / every other clinical FBA table.


-- ============================================================
-- 3. Retire the old placeholder-era AFLS table (test data only --
--    see header comment for why this is a DROP, not a migration).
-- ============================================================

drop table if exists public.fba_afls_data;
