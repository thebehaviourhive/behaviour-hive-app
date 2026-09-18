-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 7, Stage 2 -- file storage. Section 14. The first thing this app
-- has ever stored as an uploaded document -- incident PDFs are
-- generated on demand, passport sections are text, the FBA is
-- structured data. Nothing here reads from or writes to any existing
-- table beyond a read-only lookup against `assessments` for
-- authorization.
--
-- ***********************************************************************
-- THE FOURTH INSTANCE OF THE SAME BUG CLASS, CAUGHT BEFORE IT SHIPPED
-- THIS TIME. "A policy that looks up someone else runs under the
-- caller's own RLS" (CLAUDE.md's own entry, already hit three times:
-- clinical_lead_scope's write policy, its read policy, and
-- session_notes' own first-draft director-read policy). A storage
-- policy on storage.objects is no exception -- a raw EXISTS against
-- `attachments` inside a storage.objects policy would run under the
-- CALLING session's own RLS on `attachments`, not bypass it. Every
-- authorization check below -- both on storage.objects AND on
-- `attachments` itself -- goes through a SECURITY DEFINER helper,
-- never a raw subquery, so the single source of truth for "can this
-- caller reach this artefact's material" can never silently drift into
-- "only works when the lookup happens to resolve to the caller's own
-- row" the way the first three instances did.
-- ***********************************************************************
--
-- artefact_type/artefact_id, a closed enum plus a bare uuid -- NOT a
-- real per-type foreign key, deliberately, per Daniel's own confirmed
-- shape. Postgres cannot express a single FK column that references a
-- different table depending on a discriminator, so this trades away a
-- database-enforced referential guarantee for one generic pair every
-- future artefact type reuses without a new column or a widened CHECK.
-- What actually keeps this safe is that every helper below requires
-- the referenced row to EXIST AND pass live authorization -- a dangling
-- artefact_id (the row it pointed to since deleted) simply fails every
-- authorization check, the same outcome a FK's own ON DELETE CASCADE
-- would have produced by removing the attachment row outright. The
-- difference is an orphaned metadata row can persist (inert, never
-- readable by anyone) rather than being cleaned up automatically --
-- accepted here, not unnoticed.
--
-- uploaded_by already tolerates a non-clinician uploader (section 13a's
-- own parent-uploads-the-paper-form case) -- that is a COLUMN decision,
-- made now. The POLICY stays narrow: clinician-only, for Stage 2's own
-- first (and only) caller, exactly the same reason Stage 1 never built
-- the remote-send-to-parent completion mechanism -- that gets its own
-- stage and inherits this table rather than reshaping it.
--
-- RE-CHECKED ON EVERY READ, NEVER CACHED FROM UPLOAD TIME. Every helper
-- below queries `assessments` live, at call time -- there is no stored
-- "yes" anywhere. A discharged client's WISC-V PDF stops being
-- reachable the moment `assessments`' own access to that record does,
-- for the identical reason `session_notes`' own director-read already
-- re-derives standing live rather than trusting a snapshot.

-- ===========================================================================
-- attachments -- the generic bridge table. One row per uploaded file,
-- real typed metadata, never inferred from the storage object's own
-- path or name.
-- ===========================================================================

create table public.attachments (
  id uuid primary key default gen_random_uuid(),

  -- Closed enum -- only 'assessment' exists to attach to today. A BSP
  -- or session note widens this CHECK (one line) when that artefact
  -- exists; artefact_id's own meaning is resolved by the helpers below,
  -- dispatching on artefact_type, never by a database FK (see header).
  artefact_type text not null check (artefact_type in ('assessment')),
  artefact_id uuid not null,

  storage_path text not null unique,
  original_filename text not null,
  content_type text not null,
  size_bytes bigint not null,
  -- Tolerates a non-clinician uploader by design (section 13a's own
  -- parent-uploads-the-paper-form case) -- the INSERT policy below is
  -- what actually stays narrow for Stage 2, not this column.
  uploaded_by uuid not null references auth.users (id) on delete cascade,
  uploaded_at timestamptz not null default now()
);

create index attachments_artefact_idx on public.attachments (artefact_type, artefact_id);

-- content_type/size_bytes are best-effort DISPLAY metadata, not a
-- security boundary -- the bucket's own file_size_limit/
-- allowed_mime_types (below) are what Supabase Storage itself actually
-- enforces against the real uploaded bytes. A client lying about these
-- two columns cannot smuggle a larger or differently-typed file past
-- the bucket's own real limits.

-- ===========================================================================
-- The authorization helpers. Each SECURITY DEFINER, each dispatching on
-- artefact_type (one arm today: 'assessment'), each calling the
-- artefact's own live state -- never a raw EXISTS from a caller-scoped
-- context, and never a cached result. _caller_owns_artefact is the
-- single source of truth every other helper (and both attachments' own
-- table RLS and storage.objects' bridge policies) composes from --
-- when a future stage widens who may reach an assessment's material (a
-- director, eventually), or adds a second artefact_type, this is the
-- one place that changes, one arm at a time.
-- ===========================================================================

create or replace function public._caller_owns_artefact(p_artefact_type text, p_artefact_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case p_artefact_type
    when 'assessment' then exists (
      select 1 from public.assessments a
      where a.id = p_artefact_id
        and a.clinician_id = auth.uid()
    )
    else false
  end;
$$;

grant execute on function public._caller_owns_artefact(text, uuid) to authenticated;

-- Read access to an artefact's own material has never depended on
-- whether the record is completed (assessments' own SELECT policy has
-- no completed_at condition) -- only WRITES lock. This is the write-
-- side check: author, AND not completed, matching assessments' own
-- UPDATE policy exactly, so an attachment can never be added to or
-- removed from a record after it's locked -- the same Silo 1 symmetry
-- "locked once completed" already gives every other field.
create or replace function public._caller_can_modify_artefact_attachments(p_artefact_type text, p_artefact_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case p_artefact_type
    when 'assessment' then exists (
      select 1 from public.assessments a
      where a.id = p_artefact_id
        and a.clinician_id = auth.uid()
        and a.completed_at is null
    )
    else false
  end;
$$;

grant execute on function public._caller_can_modify_artefact_attachments(text, uuid) to authenticated;

-- The two storage-side helpers exist only because storage.objects has
-- no artefact_id column of its own to check directly -- only the
-- object's own `name` (its storage path). Both resolve through
-- `attachments` to find the owning artefact, then delegate to the two
-- helpers above -- never re-deriving the authorization predicate a
-- second time, so there is exactly one definition of "current" to keep
-- correct.
create or replace function public._attachment_storage_path_is_readable(p_storage_path text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.attachments att
    where att.storage_path = p_storage_path
      and public._caller_owns_artefact(att.artefact_type, att.artefact_id)
  );
$$;

grant execute on function public._attachment_storage_path_is_readable(text) to authenticated;

create or replace function public._attachment_storage_path_is_deletable(p_storage_path text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.attachments att
    where att.storage_path = p_storage_path
      and public._caller_can_modify_artefact_attachments(att.artefact_type, att.artefact_id)
  );
$$;

grant execute on function public._attachment_storage_path_is_deletable(text) to authenticated;

-- ===========================================================================
-- attachments' own table RLS. Every check goes through the same two
-- helpers storage.objects uses below -- not a raw EXISTS against
-- assessments, even though (checked directly) a raw self-referential
-- EXISTS would happen to work correctly today, for the identical
-- reason the first three instances of this bug happened to work for
-- the one caller nobody needed to worry about. Built through the
-- helper from the start so it can never drift the way those three did.
-- ===========================================================================

alter table public.attachments enable row level security;

create policy "Callers can list attachments on artefacts they own"
  on public.attachments for select to authenticated
  using (public._caller_owns_artefact(artefact_type, artefact_id));

create policy "Clinicians can record an attachment on their own uncompleted assessment"
  on public.attachments for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and artefact_type = 'assessment'
    and public._caller_can_modify_artefact_attachments(artefact_type, artefact_id)
  );

create policy "Callers can remove an attachment from an artefact they can still modify"
  on public.attachments for delete to authenticated
  using (public._caller_can_modify_artefact_attachments(artefact_type, artefact_id));

-- No UPDATE policy -- an attachment's own metadata is immutable.
-- Correcting a wrong upload is delete-and-reupload, a fresh row with
-- its own uploaded_at, not an edit to an existing one.

-- ===========================================================================
-- The bucket. Private -- never public; every read goes through a
-- signed URL, generated fresh per view (client-side discipline, not
-- enforceable here), never cached or stored. Size/type limits below
-- are PROVISIONAL -- Daniel to confirm the actual Supabase plan/storage
-- quota before these are treated as final; 25MB comfortably covers a
-- scanned paper form or a typical psych report PDF without committing
-- to a number nobody has checked against the real account yet.
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clinical-attachments',
  'clinical-attachments',
  false,
  26214400,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/heic']
)
on conflict (id) do nothing;

-- ===========================================================================
-- storage.objects policies, scoped to this one bucket. Path convention:
-- <artefact_type>/<artefact_id>/<generated-filename> --
-- storage.foldername(name)'s own first two segments are the type and
-- id, parsed and validated at INSERT time (a malformed uuid segment
-- fails the cast with a clear Postgres error, refused, not silently
-- accepted). No `attachments` row exists yet at INSERT time -- the file
-- lands in Storage first, the app inserts the matching `attachments`
-- row as a second, separate call, itself gated by attachments' own
-- INSERT policy above. SELECT/DELETE, by contrast, resolve through the
-- now-existing `attachments` row via its own storage_path.
-- ===========================================================================

create policy "Clinicians can upload attachments to their own uncompleted assessments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'clinical-attachments'
    and public._caller_can_modify_artefact_attachments(
      (storage.foldername(name))[1],
      ((storage.foldername(name))[2])::uuid
    )
  );

create policy "Callers can read attachments on artefacts they own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'clinical-attachments'
    and public._attachment_storage_path_is_readable(name)
  );

create policy "Callers can delete attachments on artefacts they can still modify"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'clinical-attachments'
    and public._attachment_storage_path_is_deletable(name)
  );

-- No UPDATE policy on storage.objects for this bucket -- no in-place
-- overwrite of an existing path; a corrected file is a genuinely new
-- object with its own new `attachments` row, matching the "immutable
-- metadata, never edited" rule above.

-- ===========================================================================
-- NOT BUILT, PER DANIEL'S OWN INSTRUCTION -- recorded so it is not
-- invented differently later:
--
-- Cross-boundary sharing. Clinic-only is the PERMANENT default this
-- stage establishes, not a placeholder. The shape a future "share this
-- specific file with a school" action would need: a real, explicit
-- shared_with_school_at timestamptz (plus who set it) on `attachments`
-- itself, set only by a director's own deliberate write -- never
-- inferred from the owning artefact's own sharing state, matching
-- passport_clinical_content's own established split between a raw log
-- and a clinician's typed, published guidance. Storage RLS would need
-- its own read branch checking that column, in addition to (not
-- instead of) the author's own current-standing check above. Nothing
-- here builds that branch.
-- ===========================================================================
