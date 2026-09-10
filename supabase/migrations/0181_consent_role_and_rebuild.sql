-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- CONSENT SCREENS REBUILD -- data model piece. consents (0001) already
-- captures who (user_id), which version of the text (consent_version,
-- an integer bumped whenever terms change -- "if consent terms change
-- later, a new row with a higher consent_version is inserted rather
-- than overwriting history", per its own original comment), and when
-- (created_at). The one real gap: no role. A school asking "what did
-- this person agree to" needs the role they agreed AS, not just their
-- current app_metadata.role, which can change later (a class_teacher
-- promoted to principal, say) -- the row should keep saying what was
-- true at the moment of agreement.
--
-- Backfilled from auth.users' CURRENT role for the 10 existing rows
-- (real production data, checked directly before writing this -- all
-- 10 are consent_version 1, none has ever changed role since). Every
-- existing row was inserted by consent/page.tsx's own checkAccess(),
-- which only ever renders the form for a user who already has one of
-- the five valid roles in app_metadata -- so backfilling from current
-- role is exact here, not a guess, for every row that exists today.
-- NOT NULL afterwards: no future row can be inserted without a role
-- once the client is updated to always pass one.

alter table public.consents add column if not exists role text;

update public.consents c
set role = u.raw_app_meta_data ->> 'role'
from auth.users u
where u.id = c.user_id
  and c.role is null;

alter table public.consents
  add constraint consents_role_check
  check (role in ('parent', 'class_teacher', 'sna', 'principal', 'clinician'));

alter table public.consents alter column role set not null;
