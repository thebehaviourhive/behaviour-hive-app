/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   FBA MODULE — MAS real content + 7-point scale. The MAS stays sendable
   (parent/teacher, blind completion) -- this is content + scale data
   only, no workflow change.

   Safety check (run before drafting this): SELECT id, fba_id, status
   FROM fba_instrument_requests WHERE instrument_type = 'mas'; returned
   exactly ONE row, status = 'completed', zero in 'sent'/'in_progress' --
   the same pre-existing test response the Open-Ended FAI migration
   found (same fba_id/recipient_id), not a real in-flight questionnaire.
   Left completely alone below.

   No code change needed for the scoring/chart engine: scoreInstrument-
   ByCategory() already derives an answer's point value from
   `item.scale.indexOf(answer)`, and getCategoryMaxScores() already sums
   `item.scale.length - 1` per item rather than assuming a fixed range --
   both already fully data-driven per the ORIGINAL Stage 2 design (see
   instrumentScoring.ts's own comment). Moving MAS from 5 options to 7
   is therefore pure DATA: give each item the real 7-label scale below,
   and every point value (0-6) and category max (4 items x 6 = 24) falls
   out of the existing generic code with no changes -- QABF's 5-option
   items are untouched, since this only touches the MAS row.

   Version-bumped (version 2), not edited in place, same pattern as the
   Open-Ended FAI update: version 1 (5-option placeholder "MAS Question
   N" items) is set is_active = false, not deleted, so the one existing
   completed test response keeps rendering against its own original
   version. No attribution for this instrument, per the brief. */

update public.fba_instruments
  set is_active = false
  where instrument_type = 'mas' and version = 1;

insert into public.fba_instruments (instrument_type, version, items, is_active)
values (
  'mas',
  2,
  jsonb_build_array(
    jsonb_build_object('id', 'mas-1', 'text', 'Would the behaviour occur continuously if this person was left alone for long periods of time?', 'answer_type', 'rating_scale', 'category', 'Sensory', 'scale', jsonb_build_array('Never', 'Almost Never', 'Seldom', 'Half the Time', 'Usually', 'Almost Always', 'Always')),
    jsonb_build_object('id', 'mas-2', 'text', 'Does the behaviour occur following a request to perform a difficult task?', 'answer_type', 'rating_scale', 'category', 'Escape', 'scale', jsonb_build_array('Never', 'Almost Never', 'Seldom', 'Half the Time', 'Usually', 'Almost Always', 'Always')),
    jsonb_build_object('id', 'mas-3', 'text', 'Does the behaviour seem to occur in response to your talking to another person in the room/area?', 'answer_type', 'rating_scale', 'category', 'Attention', 'scale', jsonb_build_array('Never', 'Almost Never', 'Seldom', 'Half the Time', 'Usually', 'Almost Always', 'Always')),
    jsonb_build_object('id', 'mas-4', 'text', 'Does the behaviour ever occur to get a toy, food, or an activity that this person has been told he/she can''t have?', 'answer_type', 'rating_scale', 'category', 'Tangible', 'scale', jsonb_build_array('Never', 'Almost Never', 'Seldom', 'Half the Time', 'Usually', 'Almost Always', 'Always')),
    jsonb_build_object('id', 'mas-5', 'text', 'Would the behaviour occur repeatedly, in the same way, for long periods of time if the person was alone? (e.g. rocking back and forth for over an hour.)', 'answer_type', 'rating_scale', 'category', 'Sensory', 'scale', jsonb_build_array('Never', 'Almost Never', 'Seldom', 'Half the Time', 'Usually', 'Almost Always', 'Always')),
    jsonb_build_object('id', 'mas-6', 'text', 'Does the behaviour occur when any request is made of this person?', 'answer_type', 'rating_scale', 'category', 'Escape', 'scale', jsonb_build_array('Never', 'Almost Never', 'Seldom', 'Half the Time', 'Usually', 'Almost Always', 'Always')),
    jsonb_build_object('id', 'mas-7', 'text', 'Does the behaviour occur whenever you stop attending to this person?', 'answer_type', 'rating_scale', 'category', 'Attention', 'scale', jsonb_build_array('Never', 'Almost Never', 'Seldom', 'Half the Time', 'Usually', 'Almost Always', 'Always')),
    jsonb_build_object('id', 'mas-8', 'text', 'Does the behaviour occur when you take away a favourite food, toy, or activity?', 'answer_type', 'rating_scale', 'category', 'Tangible', 'scale', jsonb_build_array('Never', 'Almost Never', 'Seldom', 'Half the Time', 'Usually', 'Almost Always', 'Always')),
    jsonb_build_object('id', 'mas-9', 'text', 'Does it appear to you that the person enjoys doing the behaviour? (it feels, tastes, looks, smells, sounds pleasing).', 'answer_type', 'rating_scale', 'category', 'Sensory', 'scale', jsonb_build_array('Never', 'Almost Never', 'Seldom', 'Half the Time', 'Usually', 'Almost Always', 'Always')),
    jsonb_build_object('id', 'mas-10', 'text', 'Does this person seem to do the behaviour to upset or annoy you when you are trying to get him/her to do what you ask?', 'answer_type', 'rating_scale', 'category', 'Escape', 'scale', jsonb_build_array('Never', 'Almost Never', 'Seldom', 'Half the Time', 'Usually', 'Almost Always', 'Always')),
    jsonb_build_object('id', 'mas-11', 'text', 'Does this person seem to do the behaviour to upset or annoy you when you are not paying attention to him/her? (e.g. you are in another room or interacting with another person).', 'answer_type', 'rating_scale', 'category', 'Attention', 'scale', jsonb_build_array('Never', 'Almost Never', 'Seldom', 'Half the Time', 'Usually', 'Almost Always', 'Always')),
    jsonb_build_object('id', 'mas-12', 'text', 'Does the behaviour stop occurring shortly after you give the person food, toy, or requested activity?', 'answer_type', 'rating_scale', 'category', 'Tangible', 'scale', jsonb_build_array('Never', 'Almost Never', 'Seldom', 'Half the Time', 'Usually', 'Almost Always', 'Always')),
    jsonb_build_object('id', 'mas-13', 'text', 'When the behaviour is occurring does this person seem calm and unaware of anything else going on around her/him?', 'answer_type', 'rating_scale', 'category', 'Sensory', 'scale', jsonb_build_array('Never', 'Almost Never', 'Seldom', 'Half the Time', 'Usually', 'Almost Always', 'Always')),
    jsonb_build_object('id', 'mas-14', 'text', 'Does the behaviour stop occurring shortly after (one to five minutes) you stop working with or making demands of this person?', 'answer_type', 'rating_scale', 'category', 'Escape', 'scale', jsonb_build_array('Never', 'Almost Never', 'Seldom', 'Half the Time', 'Usually', 'Almost Always', 'Always')),
    jsonb_build_object('id', 'mas-15', 'text', 'Does this person seem, to do the behaviour to get you to spend some time with her/him?', 'answer_type', 'rating_scale', 'category', 'Attention', 'scale', jsonb_build_array('Never', 'Almost Never', 'Seldom', 'Half the Time', 'Usually', 'Almost Always', 'Always')),
    jsonb_build_object('id', 'mas-16', 'text', 'Does the behaviour seem to occur when this person has been told that he/she can''t do something he/she wanted to do?', 'answer_type', 'rating_scale', 'category', 'Tangible', 'scale', jsonb_build_array('Never', 'Almost Never', 'Seldom', 'Half the Time', 'Usually', 'Almost Always', 'Always'))
  ),
  true
);
