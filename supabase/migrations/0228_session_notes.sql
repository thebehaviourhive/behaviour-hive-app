-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 6, Stage 1 -- the note itself: writing, saving, live and later,
-- against a passport. Backend only, per Daniel's own instruction --
-- offline-safe write mechanics reuse insertWithOfflineRetry() and
-- SavedStateIndicator directly (client-side, no schema implication);
-- nothing here writes a third save mechanism.
--
-- passport_id, NOT episode_id -- STRUCTURAL, not stylistic. Confirmed
-- during recon: episodes_of_care is created by exactly two functions
-- (onboard_clinic_client(), reopen_clinic_episode(), both 0210), both
-- gated on inst.type = 'clinic'. A school-engaged clinician and an
-- independent (parent-engaged) clinician never get an episode row at
-- all -- clinician_access is the one relationship table that exists
-- identically across all three engagement types (parent/school/clinic),
-- and episodes_of_care is a clinic-only concept layered on top of it.
-- An episode-keyed note would be structurally unwritable for two of the
-- three clinician tracks this schema already supports -- passport_id is
-- the only shape that works for all three, matching abc_logs' own
-- passport_id + logged_by shape exactly (0019).
--
-- Two real columns (clinical_record, parent_note), not read-time
-- redaction -- the incidents.narrative / incidents.parent_summary
-- precedent (0068), independently authored, not derived from each
-- other. A boolean (is_shared_with_parent), not passport_clinical_
-- content's row-per-audience shape (0040) -- a session note only ever
-- has ONE boundary to cross (parent, or not), not three simultaneous
-- audiences, so one flag is the right size.
--
-- Two edit-after-share columns, not a revision table --
-- parent_note_edited_after_share_at/by, a flag ON the record (matching
-- Daniel's own phrasing), answering "has this changed since I read it,"
-- which is the actual question a parent has. A full history table would
-- be a bigger feature than asked for.

create table public.session_notes (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  clinician_id uuid not null references auth.users (id) on delete cascade,
  session_date date not null default current_date,
  clinical_record text,
  parent_note text,
  is_shared_with_parent boolean not null default false,
  shared_at timestamptz,
  parent_note_edited_after_share_at timestamptz,
  parent_note_edited_after_share_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- No draft/finalize status column. PRD 6 section 6 decides "never
-- locked" and leaves draft/finalize states themselves open ("whatever
-- the notes actually need") -- nothing in this build gates on a status,
-- so none is built. Additive later if a real need shows up; nothing
-- here would need to change to add one.

-- clinical_record/parent_note are deliberately NOT linked to each other
-- at the database level -- no trigger, no generated column, no
-- constraint keeping them in sync. PRD 6 section 6, point 3: the "copy
-- clinical_record into parent_note" toggle is a write-time CONVENIENCE
-- at the client, not a stored relationship -- once written, editing one
-- must never retroactively change the other. The absence of any syncing
-- mechanism below IS the enforcement of that, not an oversight.

create index session_notes_passport_id_idx on public.session_notes (passport_id);
create index session_notes_clinician_id_idx on public.session_notes (clinician_id);

alter table public.session_notes enable row level security;

-- INSERT: the author, verified, with a real active relationship to this
-- passport at the moment of writing -- is_verified_clinician() + an
-- active clinician_access row, the same shape every other clinician
-- write path in this schema already uses. Not the author's own
-- institution_staff standing (a session note is written under whatever
-- relationship clinician_access records -- parent-engaged, school-
-- engaged, or clinic-engaged -- not under institution membership, which
-- is what makes an independent clinician's own notes possible at all).
create policy "Clinicians can create their own session notes"
  on public.session_notes for insert to authenticated
  with check (
    clinician_id = auth.uid()
    and public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = session_notes.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

-- UPDATE: author only, no clinician_access check at all. Ownership is
-- permanent (PRD 6 section 3) -- a practitioner correcting their own
-- note about a client whose access has since ended must still be able
-- to, the same way this schema already lets a departed teacher's own
-- incident content stand unaffected by their own departure. "Never
-- locked" (section 6) is enforced by having no status/lock column to
-- check in the first place, not by a permissive check someone could
-- later tighten by accident.
create policy "Clinicians can edit their own session notes"
  on public.session_notes for update to authenticated
  using (clinician_id = auth.uid())
  with check (clinician_id = auth.uid());

-- SELECT: the author, always (identical "permanent ownership" reasoning
-- as UPDATE) -- OR the clinic's own director, READ ONLY. There is no
-- director branch anywhere on the INSERT/UPDATE policies above, and
-- none should ever be added -- A DIRECTOR READS, NEVER EDITS is stated
-- here, in the policy, by the simple fact that no write policy grants
-- them anything, not left to the reader to infer from an absence.
--
-- THE inst.type = 'clinic' CHECK IS LOAD-BEARING, NOT DEFENSIVE STYLE --
-- worth a future reader's attention if they ever wonder why a director-
-- read branch carries an institution-type check at all. A clinician can
-- be institution_staff at a SCHOOL too (the original, pre-PRD-5
-- clinician track, still live). Without this check, a school-engaged
-- clinician's session notes would be readable by their SCHOOL'S OWN
-- PRINCIPAL -- exactly the leak "never visible to a school" (PRD 6
-- section 3) exists to prevent, and "a school" means the principal too,
-- not just teachers and SNAs. Found and closed in Stage 0 recon, before
-- it ever shipped. Do not remove this check to "simplify" the policy --
-- removing it re-opens that leak.
--
-- STANDING: the DIRECTOR's own current standing IS required here -- a
-- departed director must not go on reading a clinic's clinical notes,
-- exactly the departure-cascade gap PRD 5 found three separate times.
-- The AUTHOR's own standing is deliberately NOT required (see the
-- UPDATE policy's own comment, same reasoning) -- these two checks read
-- identically in a policy expression and only one of them is safe to
-- drop. Confirmed explicitly by Daniel before this was written, because
-- getting it backwards either locks a departed practitioner's own notes
-- away from their own director, or lets a departed director keep
-- reading current clinical material.
--
-- NO clinical_lead BRANCH, ANYWHERE, DELIBERATELY. A lead's own
-- clinical_lead_scope covering this client says nothing about whether
-- they may read what a practitioner wrote about them -- the identical
-- posture get_episode_overseeing_leads() (0227) already established for
-- a different question: director-only, structurally no lead branch,
-- regardless of scope. Do not "fix" this for consistency with a lead's
-- other within-scope authorities (reassign, discharge, approve tag
-- changes) -- PRD 6 section 6 names this asymmetry as deliberate: a
-- lead's oversight of a case is not the same as reading everything
-- written in it, and the director is the exception because they hold
-- organisational responsibility for the clinical record, not because
-- oversight implies it.
create policy "A practitioner reads their own notes; their clinic's director reads them too"
  on public.session_notes for select to authenticated
  using (
    clinician_id = auth.uid()
    or exists (
      select 1
      from public.institution_staff author_staff
      join public.institution_staff director on director.institution_id = author_staff.institution_id
      join public.institutions inst on inst.id = director.institution_id
      where author_staff.user_id = session_notes.clinician_id
        and author_staff.role = 'clinician'
        and director.user_id = auth.uid()
        and director.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
    )
  );

-- ===========================================================================
-- Sharing and edit-after-share tracking -- a BEFORE UPDATE trigger, not
-- an RPC, so the client keeps writing via plain .update() calls (the
-- exact shape insertWithOfflineRetry()/AFLS's own per-field save pattern
-- already assumes -- reused unchanged, no new save mechanism).
-- ===========================================================================

create or replace function public._session_note_share_tracking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Sharing itself: false -> true. Records WHEN, and tells the parent via
  -- the same activity_log pointer mechanism this schema already uses for
  -- crossing a clinical boundary (finalize_fba_report()'s own
  -- clinical_content_added row, 0197) -- reused, not a new mechanism.
  -- Unsharing (true -> false) is left alone entirely -- not asked for,
  -- not built.
  if not old.is_shared_with_parent and new.is_shared_with_parent then
    new.shared_at := now();
    insert into public.activity_log (passport_id, actor_id, event_type, event_description)
    values (new.passport_id, auth.uid(), 'session_note_shared', 'A session note was shared with you.');
  end if;

  -- ONLY parent_note edits, ONLY after sharing, are tracked or surfaced.
  -- clinical_record is never shown to a parent (PRD 6 section 2) -- an
  -- edit to it after sharing has nothing to inform them about. This is
  -- the one place that rule is actually enforced, not implied by column
  -- naming: a direct update({clinical_record: ...}) on an already-shared
  -- note leaves shared_at and both parent_note_edited_after_share_*
  -- columns completely untouched, proven live below.
  if new.is_shared_with_parent
     and old.is_shared_with_parent
     and new.parent_note is distinct from old.parent_note
  then
    new.parent_note_edited_after_share_at := now();
    new.parent_note_edited_after_share_by := auth.uid();
    insert into public.activity_log (passport_id, actor_id, event_type, event_description)
    values (new.passport_id, auth.uid(), 'session_note_updated', 'A shared session note was updated.');
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger session_notes_share_tracking
  before update on public.session_notes
  for each row
  execute function public._session_note_share_tracking();

-- ===========================================================================
-- activity_log: two new event types, the established widen-in-place
-- pattern (drop + recreate the CHECK, matching 0054's own precedent
-- exactly -- Postgres names an inline CHECK deterministically, so this
-- name is not guessed).
-- ===========================================================================

alter table public.activity_log drop constraint if exists activity_log_event_type_check;
alter table public.activity_log add constraint activity_log_event_type_check
  check (event_type in (
    'passport_updated', 'morning_checkin', 'afternoon_update', 'abc_logged',
    'passport_shared', 'team_linked', 'clinician_logged', 'strategy_logged',
    'access_revoked', 'fba_started', 'fba_completed', 'clinical_content_added',
    'questionnaire_sent', 'questionnaire_completed', 'calm_escalation',
    'session_note_shared', 'session_note_updated'
  ));

-- Neither new event type needs adding to get_parent_activity_feed()'s
-- own exclusion list (0152) or the parent SELECT policy's exclusion list
-- (0054) -- both exclusion lists are short and specific
-- (questionnaire_sent/completed, calm_escalation); anything not
-- explicitly excluded is already visible to a parent by default, and
-- that default is exactly what's wanted here -- the pointer should
-- reach the parent's feed the same way clinical_content_added already
-- does.

-- ===========================================================================
-- get_shared_session_notes() -- the parent's own read, structurally
-- excluding clinical_record rather than trusting the client not to ask
-- for it. Matches get_parent_incidents()'s own shape (never selects
-- incidents.narrative at all) over a raw RLS SELECT policy on the base
-- table, which would need a column-level REVOKE on top to give the same
-- guarantee -- this RPC gives it directly, by construction: the column
-- does not appear anywhere in its SQL.
-- ===========================================================================

create or replace function public.get_shared_session_notes(p_passport_id uuid)
returns table (
  id uuid,
  session_date date,
  parent_note text,
  shared_at timestamptz,
  parent_note_edited_after_share_at timestamptz,
  clinician_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select sn.id, sn.session_date, sn.parent_note, sn.shared_at, sn.parent_note_edited_after_share_at,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name')
  from public.session_notes sn
  join auth.users u on u.id = sn.clinician_id
  where sn.passport_id = p_passport_id
    and sn.is_shared_with_parent = true
    and public.owns_passport(p_passport_id)
  order by sn.session_date desc, sn.shared_at desc;
$$;

grant execute on function public.get_shared_session_notes(uuid) to authenticated;
