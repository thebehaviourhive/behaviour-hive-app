-- AFLS domain comments (Change 3, 2026-08-21 brief): per-assessment,
-- per-domain free-text clinician narrative, keyed by domain code
-- (e.g. "SM"). Lives on afls_assessments itself, not a separate table
-- or fba_reports.content_data, so it inherits exactly the same RLS
-- posture as the scores it sits alongside -- no new policies needed,
-- the existing row-level policies (migration 0060) already cover
-- every column on this table, including this one: clinician CRUD on
-- their own FBAs' assessments (editable post-lock, companion layer,
-- same as Calm Cards), parent SELECT once the FBA is completed.
alter table public.afls_assessments
  add column domain_comments jsonb not null default '{}'::jsonb;

comment on column public.afls_assessments.domain_comments is
  'Free-text clinician narrative per domain, keyed by AFLS domain code (e.g. "SM"). Values are plain strings. A missing key means no comment recorded for that domain.';
