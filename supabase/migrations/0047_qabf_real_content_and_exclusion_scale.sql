/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   FBA MODULE — QABF real content + X/0/1/2/3 exclusion-aware scale. The
   QABF stays sendable (parent/teacher, blind completion) -- content +
   scale only, no workflow change. Same version-bump pattern as the FAI
   and MAS updates.

   Safety check (run before drafting this): SELECT id, fba_id, status
   FROM fba_instrument_requests WHERE instrument_type = 'qabf'; returned
   exactly ONE row, status = 'completed', zero in 'sent'/'in_progress' --
   the same pre-existing test response the FAI/MAS migrations found
   (same fba_id/recipient_id), not a real in-flight questionnaire. Left
   completely alone below.

   Version-bumped (version 2), not edited in place: version 1 (5-option
   placeholder "QABF Question N" items) is set is_active = false, not
   deleted -- the one existing completed test response keeps rendering
   against its own original version. No attribution, per the brief.

   The X option is a first-class stored answer, not null or zero -- the
   scale is literally ['X', '0', '1', '2', '3'], five real options. What
   "X" DOES with scoring (exclude from both the total and that
   category's possible maximum, computed per-response rather than as a
   fixed per-item constant) is a client-code change to
   instrumentScoring.ts, presented alongside this migration, not
   something this migration encodes -- the scale here is just data. */

update public.fba_instruments
  set is_active = false
  where instrument_type = 'qabf' and version = 1;

insert into public.fba_instruments (instrument_type, version, items, is_active)
values (
  'qabf',
  2,
  jsonb_build_array(
    jsonb_build_object('id', 'qabf-1', 'text', 'Engages in the behaviour to get attention', 'answer_type', 'rating_scale', 'category', 'Attention', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-2', 'text', 'Engages in the behaviour to escape work or learning situations.', 'answer_type', 'rating_scale', 'category', 'Escape', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-3', 'text', 'Engages in the behaviour as a form of "self-stimulation".', 'answer_type', 'rating_scale', 'category', 'Non-social function', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-4', 'text', 'Engages in the behaviour because he/she is in pain.', 'answer_type', 'rating_scale', 'category', 'Physical', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-5', 'text', 'Engages in the behaviour to get access to items such as preferred toys, food or beverages.', 'answer_type', 'rating_scale', 'category', 'Tangible', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-6', 'text', 'Engages in the behaviour because he/she likes to be reprimanded.', 'answer_type', 'rating_scale', 'category', 'Attention', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-7', 'text', 'Engages in the behaviour when asked to do something (brush teeth, work etc.)', 'answer_type', 'rating_scale', 'category', 'Escape', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-8', 'text', 'Engages in the behaviour even if he/she thinks no one is in the room.', 'answer_type', 'rating_scale', 'category', 'Non-social function', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-9', 'text', 'Engages in the behaviour more frequently when he/she is ill.', 'answer_type', 'rating_scale', 'category', 'Physical', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-10', 'text', 'Engages in the behaviour when you take something away from him/her.', 'answer_type', 'rating_scale', 'category', 'Tangible', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-11', 'text', 'Engages in the behaviour to draw attention to him/herself.', 'answer_type', 'rating_scale', 'category', 'Attention', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-12', 'text', 'Engages in the behaviour when he/she does not want to do something.', 'answer_type', 'rating_scale', 'category', 'Escape', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-13', 'text', 'Engages in the behaviour because there is nothing else to do.', 'answer_type', 'rating_scale', 'category', 'Non-social function', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-14', 'text', 'Engages in the behaviour when there is something bothering her/him physically.', 'answer_type', 'rating_scale', 'category', 'Physical', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-15', 'text', 'Engages in the behaviour when you have something he/she wants.', 'answer_type', 'rating_scale', 'category', 'Tangible', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-16', 'text', 'Engages in the behaviour to try and get a reaction from you.', 'answer_type', 'rating_scale', 'category', 'Attention', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-17', 'text', 'Engages in the behaviour to try to get people to leave him/her alone.', 'answer_type', 'rating_scale', 'category', 'Escape', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-18', 'text', 'Engages in the behaviour in a highly repetitive manner, ignoring his/her surroundings.', 'answer_type', 'rating_scale', 'category', 'Non-social function', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-19', 'text', 'Engages in the behaviour because she/he is physically uncomfortable.', 'answer_type', 'rating_scale', 'category', 'Physical', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-20', 'text', 'Engages in the behaviour when a peer has something he/she wants.', 'answer_type', 'rating_scale', 'category', 'Tangible', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-21', 'text', 'Does he/she seem to be saying "come see me" or "look at me" when engaging in the behaviour?', 'answer_type', 'rating_scale', 'category', 'Attention', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-22', 'text', 'Does he/she seem to be saying "leave me alone" or "stop asking me to do this" when engaging in the behaviour?', 'answer_type', 'rating_scale', 'category', 'Escape', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-23', 'text', 'Does he/she seem to enjoy the behaviour, even if no one is around?', 'answer_type', 'rating_scale', 'category', 'Non-social function', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-24', 'text', 'Does the behaviour seem to indicate to you that he/she is not feeling well?', 'answer_type', 'rating_scale', 'category', 'Physical', 'scale', jsonb_build_array('X', '0', '1', '2', '3')),
    jsonb_build_object('id', 'qabf-25', 'text', 'Does he/she seem to be saying "give me that (toy, item, food)" when engaging in the behaviour?', 'answer_type', 'rating_scale', 'category', 'Tangible', 'scale', jsonb_build_array('X', '0', '1', '2', '3'))
  ),
  true
);
