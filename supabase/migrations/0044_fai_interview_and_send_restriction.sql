/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   FBA MODULE — Open-Ended Interview correction: converts the "Open-Ended
   Functional Assessment Interview" from a sendable questionnaire (nobody
   has ever used it for real) to a clinician-transcribed form completed
   live inside the FBA workspace. This migration only touches the
   instrument item bank and the sendable-request table's own guardrail --
   the clinician's actual interview answers will live in fba_reports.
   content_data (Step 2, client code), the same JSONB blob every other
   section's structured content already lives in. No new table needed.

   Two changes:

   1. fba_instruments gains a nullable `attribution` column (text). Not
      open_ended-specific -- future QABF/MAS attributions can use the
      same column. Purely additive.

   2. The REAL 24-item Open-Ended FAI content ships as a NEW version (2)
      of the open_ended row, not an edit of the existing version-1 row.
      Version 1 (10 placeholder "Interview Question N" items) is set
      is_active = false, not deleted -- it stays inert but intact, so
      the one existing completed test response (checked live below)
      keeps rendering exactly as it does today, unaffected.

   Safety check (run before drafting this): SELECT id, fba_id, status
   FROM fba_instrument_requests WHERE instrument_type = 'open_ended';
   returned exactly ONE row, status = 'completed', zero in
   'sent'/'in_progress' -- confirming nobody has an open_ended
   questionnaire actively in flight. That row is left completely alone.

   Judgment call: rather than a client-only restriction, the
   fba_instrument_requests.instrument_type CHECK constraint is narrowed
   to ('qabf', 'mas') so no future INSERT of an open_ended row can
   succeed through ANY path -- the existing Send Questionnaire UI, a
   different client, or a raw API call -- matching "enforce in the
   send RPC/insert path too". This uses NOT VALID: Postgres skips
   re-validating EXISTING rows against the narrowed constraint (which
   matters here, since one completed open_ended row already exists and
   a validating ADD CONSTRAINT would otherwise fail outright), while
   still fully enforcing it on every INSERT/UPDATE from this point on. */

alter table public.fba_instruments
  add column if not exists attribution text;

alter table public.fba_instrument_requests
  drop constraint if exists fba_instrument_requests_instrument_type_check;

alter table public.fba_instrument_requests
  add constraint fba_instrument_requests_instrument_type_check
  check (instrument_type in ('qabf', 'mas'))
  not valid;

update public.fba_instruments
  set is_active = false
  where instrument_type = 'open_ended' and version = 1;

insert into public.fba_instruments (instrument_type, version, items, is_active, attribution)
values (
  'open_ended',
  2,
  jsonb_build_array(
    jsonb_build_object('id', 'fai-1', 'text', 'Today''s Date', 'answer_type', 'date'),
    jsonb_build_object('id', 'fai-2', 'text', 'Child''s Name and Age', 'answer_type', 'free_text'),
    jsonb_build_object('id', 'fai-3', 'text', 'Respondent''s Name', 'answer_type', 'free_text'),
    jsonb_build_object('id', 'fai-4', 'text', 'Respondent''s Relation to Child', 'answer_type', 'free_text'),
    jsonb_build_object('id', 'fai-5', 'text', 'Relevant Background Information', 'answer_type', 'free_text'),
    jsonb_build_object('id', 'fai-6', 'text', 'Describe his/her language abilities:', 'answer_type', 'free_text'),
    jsonb_build_object('id', 'fai-7', 'text', 'Describe his/her play skills and preferred toys or leisure activities:', 'answer_type', 'free_text'),
    jsonb_build_object('id', 'fai-8', 'text', 'What else does he/she prefer?', 'answer_type', 'free_text'),
    jsonb_build_object('id', 'fai-9', 'text', 'What are the problem behaviours? What do they look like?', 'answer_type', 'free_text'),
    jsonb_build_object('id', 'fai-10', 'text', 'What is the single-most concerning problem behaviour?', 'answer_type', 'free_text'),
    jsonb_build_object('id', 'fai-11', 'text', 'What are the top 3 most concerning problem behaviours? Are there other behaviours of concern?', 'answer_type', 'free_text'),
    jsonb_build_object('id', 'fai-12', 'text', 'Describe the range of intensities of the problem behaviours and the extent to which he/she or others may be hurt or injured from the problem behaviour.', 'answer_type', 'free_text'),
    jsonb_build_object('id', 'fai-13', 'text', 'Do the different types of problem behaviour tend to occur in bursts or clusters and/or does any type of problem behaviour typically precede another type of problem behaviour (e.g., yells preceding hits)?', 'answer_type', 'free_text'),
    jsonb_build_object('id', 'fai-14', 'text', 'Under what conditions or situations are the problem behaviours most likely to occur?', 'answer_type', 'free_text'),
    jsonb_build_object('id', 'fai-15', 'text', 'Do the problem behaviours reliably occur during any particular activities?', 'answer_type', 'free_text'),
    jsonb_build_object('id', 'fai-16', 'text', 'What seems to trigger the problem behaviour?', 'answer_type', 'free_text'),
    jsonb_build_object('id', 'fai-17', 'text', 'Does problem behaviour occur when you break routines or interrupt activities? If so, describe.', 'answer_type', 'free_text'),
    jsonb_build_object('id', 'fai-18', 'text', 'Does the problem behaviour occur when it appears that he/she won''t get his/her way? If so, describe.', 'answer_type', 'free_text'),
    jsonb_build_object('id', 'fai-19', 'text', 'How do you and others react or respond to the problem behaviour?', 'answer_type', 'free_text'),
    jsonb_build_object('id', 'fai-20', 'text', 'What do you and others do to calm him/her down once he/she engaged in the problem behaviour?', 'answer_type', 'free_text'),
    jsonb_build_object('id', 'fai-21', 'text', 'What do you and others do to distract him/her from engaging in the problem behaviour?', 'answer_type', 'free_text'),
    jsonb_build_object('id', 'fai-22', 'text', 'What do you think he/she is trying to communicate with his/her problem behaviour, if anything?', 'answer_type', 'free_text'),
    jsonb_build_object('id', 'fai-23', 'text', 'Do you think this problem behaviour is a form of self stimulation? If so, what gives you that impression?', 'answer_type', 'free_text'),
    jsonb_build_object('id', 'fai-24', 'text', 'Why do you think he/she is engaging in the problem behaviour?', 'answer_type', 'free_text')
  ),
  true,
  'Developed by Gregory P. Hanley, Ph.D., BCBA-D (Developed August, 2002; Revised: August, 2009)'
);
