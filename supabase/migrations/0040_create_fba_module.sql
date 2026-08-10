/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   FBA MODULE — STAGE 1 OF 3: data model + RLS for the FBA workspace
   (Step 2, client code, follows once this is confirmed run). Stages 2
   (questionnaire engine, ABC integration, charts) and 3 (completion,
   parent review, passport extraction, PDF) build on this schema later —
   nothing here is provisional, it's the real shape from day one.

   Strictly additive: no existing table, column, policy, or function is
   altered in a way that removes or restricts anything a parent, teacher,
   or existing clinician feature already relies on. Every change here
   either creates something new, or narrowly widens something (a CHECK
   constraint gaining a value, a feed function gaining an event type) —
   the same discipline as every migration since the security audit.

   FIVE NEW TABLES, in dependency order:
     1. fba_reports              -- one row per FBA; the parent record
     2. fba_afls_data            -- one row per FBA; AFLS scoring, keyed to it
     3. fba_instrument_requests  -- QABF/MAS/interview sent to a recipient
     4. fba_instruments          -- the data-driven question banks (seeded)
     5. passport_clinical_content -- generic extraction target for Stage 3

   SEVEN JUDGMENT CALLS made beyond the brief's literal tables/RLS bullets,
   flagged here rather than silently decided:

   1. AFLS item bank lives in fba_instruments too, as a fourth
      instrument_type ('afls'), not a sixth table. The brief asks for
      "the same data-driven pattern" for AFLS items but only names five
      tables total and fba_afls_data's own columns are scores only (no
      room for item text/domain). Reusing fba_instruments' existing
      {id, text, answer_type, category} item shape for AFLS domains
      (category = domain name, answer_type = 'afls_scale') satisfies
      "same data-driven pattern" literally without inventing an
      unlisted table. fba_instrument_requests.instrument_type is
      untouched by this — AFLS is clinician-self-scored inside the
      workspace (Step 2, Section 11), never sent to a recipient, so it
      never needs to appear there.

   2. A partial unique index enforces "one active FBA per child" at the
      database level, not just the UI's disabled-button message the
      brief describes. Defense in depth for exactly the same reason the
      security audit added it everywhere else: a disabled button is a
      UI nicety, not a guarantee, and two concurrent drafts for one
      child would corrupt the "which one is current" assumption every
      later stage depends on.

   3. "No UPDATE may succeed on a completed row" is enforced via the
      UPDATE policy's USING clause (checked against the OLD row) rather
      than a trigger. WITH CHECK alone can't do this — it only
      validates the NEW row, so an update that keeps status='completed'
      would still pass WITH CHECK even though it should never have been
      reachable at all. USING is evaluated against the existing row
      before the update is even attempted, so requiring status <>
      'completed' there blocks every update attempt on an already-
      completed row outright, while still allowing the one legitimate
      transition (in_progress -> completed) since the OLD row isn't
      completed yet at that point.

   4. fba_instrument_requests' recipient keeps SELECT on their own past
      requests/responses even after being revoked from the passport
      entirely (no passport_access.is_active re-check on that policy).
      The brief says responses "persist... clinical record" when a
      recipient is later revoked -- read here as meaning their own
      answer stays theirs to see, not just that the row isn't deleted.
      This mirrors fba_reports/fba_afls_data being retained-but-
      unreachable for a revoked CLINICIAN (the record survives) while
      keeping the ANSWERING party's own read access to what they
      personally submitted, which is a different, narrower thing than
      clinical case access.

   5. get_teacher_activity_feed() is not modified at all, on purpose.
      Its existing "not exists (select 1 from clinicians c where
      c.user_id = al.actor_id)" clause already excludes every event a
      clinician actor produces, before event_type is even considered —
      fba_started/fba_completed will always be clinician-authored, so
      they're excluded by a mechanism that already existed, not a new
      one. Touching this function for values it already can't leak
      would be a no-op with extra risk.

   6. Parent visibility of fba_started/fba_completed is closed off by
      narrowing the parent's existing activity_log SELECT policy
      (ALTER POLICY, adding one condition -- the same minimal-diff
      pattern used throughout the security audit), not a new RPC. The
      parent dashboard reads activity_log directly today, with no
      allow-list the way the teacher/clinician feeds have one — without
      this, inserting an fba_started row would make it visible to the
      parent immediately, contradicting "Parent visibility comes with
      Stage 3; exclude from the parent feed for now." Stage 3 removes
      this condition when parent visibility is meant to switch on.

   7. get_clinician_fbas(): a convenience read RPC for Step 2's Active |
      Completed list, mirroring get_clinician_passports() /
      get_passport_clinicians() (migration 0026) exactly rather than
      leaving Step 2 to hand-join fba_reports and passports client-side.
      SECURITY DEFINER, so it re-checks clinician_id/active-link/verified
      itself rather than relying on fba_reports' own RLS (which SECURITY
      DEFINER bypasses) — the same shape as every other convenience
      function in this schema. */


-- ============================================================
-- 1. fba_reports -- one row per FBA
-- ============================================================

create table public.fba_reports (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  clinician_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'in_progress', 'completed')),
  content_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index fba_reports_passport_id_idx on public.fba_reports (passport_id);
create index fba_reports_clinician_id_idx on public.fba_reports (clinician_id);

-- Judgment call #2: one active (draft/in_progress) FBA per child,
-- enforced at the database, not just the UI's disabled-button message.
create unique index fba_reports_one_active_per_passport
  on public.fba_reports (passport_id)
  where status in ('draft', 'in_progress');

drop trigger if exists set_fba_reports_updated_at on public.fba_reports;
create trigger set_fba_reports_updated_at
  before update on public.fba_reports
  for each row
  execute function public.set_updated_at();

-- Forward-compatible groundwork for Stage 3's Finalize action: whenever
-- a row's status actually transitions to 'completed', stamp
-- completed_at automatically rather than trusting every future call
-- site to set it by hand.
create or replace function public.set_fba_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists set_fba_reports_completed_at on public.fba_reports;
create trigger set_fba_reports_completed_at
  before update on public.fba_reports
  for each row
  execute function public.set_fba_completed_at();

alter table public.fba_reports enable row level security;

-- Clinician: full access on own rows, only with an active + verified
-- link to the passport. UPDATE additionally requires the row not
-- already be completed (judgment call #3).
create policy "Clinicians can view their own linked FBAs"
  on public.fba_reports
  for select
  to authenticated
  using (
    clinician_id = auth.uid()
    and public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = fba_reports.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

create policy "Clinicians can create FBAs for their own linked passports"
  on public.fba_reports
  for insert
  to authenticated
  with check (
    clinician_id = auth.uid()
    and public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = fba_reports.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

create policy "Clinicians can update their own linked FBAs while not completed"
  on public.fba_reports
  for update
  to authenticated
  using (
    status <> 'completed'
    and clinician_id = auth.uid()
    and public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = fba_reports.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  )
  with check (
    clinician_id = auth.uid()
    and public.is_verified_clinician(auth.uid())
    and exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = fba_reports.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
  );

-- Parent: read-only, and only once completed -- never a draft, never a
-- write. Revocation note: because the clinician-side policies above all
-- require an ACTIVE clinician_access row, a revoked clinician loses all
-- access to their own past FBAs immediately, even though the rows
-- themselves are retained (clinical record) and become reachable again
-- if the parent re-links the same clinician. This is deliberate, not a
-- gap: the record isn't deleted, it's just correctly unreachable while
-- the parent has withdrawn that clinician's access.
create policy "Parents can view completed FBAs for their own passport"
  on public.fba_reports
  for select
  to authenticated
  using (
    status = 'completed'
    and public.owns_passport(fba_reports.passport_id)
  );

-- No policy at all for class_teacher -- zero access, by omission. RLS
-- denies anything without a matching permissive policy, so this is the
-- enforcement, not a comment about intent.


-- ============================================================
-- 2. fba_afls_data -- AFLS scoring, one row per FBA
-- ============================================================

create table public.fba_afls_data (
  id uuid primary key default gen_random_uuid(),
  fba_id uuid not null unique references public.fba_reports (id) on delete cascade,
  scores_data jsonb not null default '{}'::jsonb,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fba_afls_data_fba_id_idx on public.fba_afls_data (fba_id);

drop trigger if exists set_fba_afls_data_updated_at on public.fba_afls_data;
create trigger set_fba_afls_data_updated_at
  before update on public.fba_afls_data
  for each row
  execute function public.set_updated_at();

alter table public.fba_afls_data enable row level security;

-- Same shape as fba_reports' own policies, but reached through fba_id
-- since this table has no passport_id/clinician_id of its own -- and
-- the completed-lock checks the PARENT fba_reports row's status, since
-- this table has no status column of its own either.
create policy "Clinicians can view AFLS data for their own linked FBAs"
  on public.fba_afls_data
  for select
  to authenticated
  using (
    exists (
      select 1 from public.fba_reports fr
      join public.clinician_access ca on ca.passport_id = fr.passport_id
      where fr.id = fba_afls_data.fba_id
        and fr.clinician_id = auth.uid()
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
        and public.is_verified_clinician(auth.uid())
    )
  );

create policy "Clinicians can insert AFLS data for their own linked FBAs"
  on public.fba_afls_data
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.fba_reports fr
      join public.clinician_access ca on ca.passport_id = fr.passport_id
      where fr.id = fba_afls_data.fba_id
        and fr.clinician_id = auth.uid()
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
        and public.is_verified_clinician(auth.uid())
    )
  );

create policy "Clinicians can update AFLS data while the FBA isn't completed"
  on public.fba_afls_data
  for update
  to authenticated
  using (
    exists (
      select 1 from public.fba_reports fr
      join public.clinician_access ca on ca.passport_id = fr.passport_id
      where fr.id = fba_afls_data.fba_id
        and fr.status <> 'completed'
        and fr.clinician_id = auth.uid()
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
        and public.is_verified_clinician(auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.fba_reports fr
      join public.clinician_access ca on ca.passport_id = fr.passport_id
      where fr.id = fba_afls_data.fba_id
        and fr.clinician_id = auth.uid()
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
        and public.is_verified_clinician(auth.uid())
    )
  );

create policy "Parents can view AFLS data for their completed FBAs"
  on public.fba_afls_data
  for select
  to authenticated
  using (
    exists (
      select 1 from public.fba_reports fr
      where fr.id = fba_afls_data.fba_id
        and fr.status = 'completed'
        and public.owns_passport(fr.passport_id)
    )
  );


-- ============================================================
-- 3. fba_instruments -- data-driven question banks (seeded below)
-- ============================================================

create table public.fba_instruments (
  id uuid primary key default gen_random_uuid(),
  instrument_type text not null
    check (instrument_type in ('qabf', 'mas', 'open_ended', 'afls')),
  version integer not null default 1,
  items jsonb not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index fba_instruments_type_active_idx
  on public.fba_instruments (instrument_type, is_active);

alter table public.fba_instruments enable row level security;

-- Read-only for every authenticated role; only service_role (bypasses
-- RLS) can ever write here -- replacing item text with real clinical
-- wording later is a data UPDATE, never a code change, exactly as
-- asked, and it happens the same way institutions.status is verified
-- today: directly, by a human, outside the client's reach entirely.
create policy "Authenticated users can read active instruments"
  on public.fba_instruments
  for select
  to authenticated
  using (true);


-- ============================================================
-- 4. fba_instrument_requests -- QABF/MAS/interview sent to a recipient
-- ============================================================

create table public.fba_instrument_requests (
  id uuid primary key default gen_random_uuid(),
  fba_id uuid not null references public.fba_reports (id) on delete cascade,
  passport_id uuid not null references public.passports (id) on delete cascade,
  instrument_type text not null
    check (instrument_type in ('qabf', 'mas', 'open_ended')),
  recipient_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'sent'
    check (status in ('sent', 'in_progress', 'completed')),
  responses_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index fba_instrument_requests_fba_id_idx on public.fba_instrument_requests (fba_id);
create index fba_instrument_requests_recipient_id_idx on public.fba_instrument_requests (recipient_id);

alter table public.fba_instrument_requests enable row level security;

create policy "Clinicians can create instrument requests for their own linked FBAs"
  on public.fba_instrument_requests
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.fba_reports fr
      join public.clinician_access ca on ca.passport_id = fr.passport_id
      where fr.id = fba_instrument_requests.fba_id
        and fr.clinician_id = auth.uid()
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
        and public.is_verified_clinician(auth.uid())
    )
  );

create policy "Clinicians can view requests on their own linked FBAs"
  on public.fba_instrument_requests
  for select
  to authenticated
  using (
    exists (
      select 1 from public.fba_reports fr
      join public.clinician_access ca on ca.passport_id = fr.passport_id
      where fr.id = fba_instrument_requests.fba_id
        and fr.clinician_id = auth.uid()
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
        and public.is_verified_clinician(auth.uid())
    )
  );

-- Judgment call #4: a recipient keeps SELECT on their own request even
-- after being revoked from the passport entirely -- their own past
-- answer stays theirs to see. No passport_access re-check here,
-- deliberately.
create policy "Recipients can view their own instrument requests"
  on public.fba_instrument_requests
  for select
  to authenticated
  using (recipient_id = auth.uid());

-- Column-scoped write: a recipient may only ever change responses_data
-- and status on their own request -- never fba_id, passport_id,
-- instrument_type, or who it was sent to. Same mechanism as
-- clinicians.review_cadence_days (migration 0026): revoke the broad
-- table-level grant, then grant back only the two columns that are
-- genuinely theirs to change.
revoke update on public.fba_instrument_requests from authenticated;
grant update (responses_data, status) on public.fba_instrument_requests to authenticated;

create policy "Recipients can update their own responses"
  on public.fba_instrument_requests
  for update
  to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());


-- ============================================================
-- 5. passport_clinical_content -- generic extraction target (Stage 3
--    populates it; the shape exists now so Stage 3 is additive too)
-- ============================================================

create table public.passport_clinical_content (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  author_role text not null,
  source_document_type text not null,
  source_document_id uuid not null,
  item_type text not null
    check (item_type in ('trigger', 'setting_event', 'strategy_home', 'strategy_school', 'strategy_shared')),
  content jsonb not null,
  created_at timestamptz not null default now()
);

create index passport_clinical_content_passport_id_idx on public.passport_clinical_content (passport_id);
create index passport_clinical_content_source_idx
  on public.passport_clinical_content (source_document_type, source_document_id);

alter table public.passport_clinical_content enable row level security;

create policy "Parents can view clinical content for their own passport"
  on public.passport_clinical_content
  for select
  to authenticated
  using (public.owns_passport(passport_clinical_content.passport_id));

create policy "Verified linked clinicians can view all clinical content"
  on public.passport_clinical_content
  for select
  to authenticated
  using (
    exists (
      select 1 from public.clinician_access ca
      where ca.passport_id = passport_clinical_content.passport_id
        and ca.clinician_id = auth.uid()
        and ca.is_active = true
    )
    and public.is_verified_clinician(auth.uid())
  );

-- Mirrors the C-01 backport (migration 0032) exactly: active
-- passport_access only. Teachers see the school-relevant subset only --
-- 'strategy_home' never reaches this policy, by the item_type filter,
-- not by trusting the client to hide it.
create policy "Teachers with active access can view school-relevant clinical content"
  on public.passport_clinical_content
  for select
  to authenticated
  using (
    item_type in ('strategy_school', 'strategy_shared', 'trigger', 'setting_event')
    and exists (
      select 1 from public.passport_access pa
      where pa.passport_id = passport_clinical_content.passport_id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
    )
  );

-- No INSERT/UPDATE/DELETE policy for any client role -- Stage 3's
-- extraction runs through a SECURITY DEFINER RPC (bypasses RLS by
-- design, same as every other write-restricted table in this schema),
-- not a direct client insert. Nothing writes here yet.


-- ============================================================
-- 6. activity_log -- new event types, feed wiring, parent visibility
-- ============================================================

alter table public.activity_log drop constraint if exists activity_log_event_type_check;
alter table public.activity_log add constraint activity_log_event_type_check
  check (event_type in (
    'passport_updated',
    'morning_checkin',
    'afternoon_update',
    'abc_logged',
    'passport_shared',
    'team_linked',
    'clinician_logged',
    'strategy_logged',
    'access_revoked',
    'fba_started',
    'fba_completed'
  ));

-- Clinician feed: additive OR-branch only, gains the two new types.
create or replace function public.get_clinician_activity_feed(
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  passport_id uuid,
  child_name text,
  event_type text,
  event_description text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select al.id, al.passport_id, p.child_name, al.event_type, al.event_description, al.created_at
  from public.activity_log al
  join public.passports p on p.id = al.passport_id
  join public.clinician_access ca on ca.passport_id = al.passport_id
  where ca.clinician_id = auth.uid()
    and ca.is_active = true
    and public.is_verified_clinician(auth.uid())
    and al.event_type in ('abc_logged', 'passport_updated', 'clinician_logged', 'team_linked', 'access_revoked', 'fba_started', 'fba_completed')
  order by al.created_at desc
  limit p_limit offset p_offset;
$$;

-- get_teacher_activity_feed() is INTENTIONALLY not touched -- see
-- judgment call #5 above. Its existing actor-is-a-clinician exclusion
-- already blocks fba_started/fba_completed with no changes needed.

-- Judgment call #6: narrows the parent's existing direct-table-read
-- policy so fba_started/fba_completed don't reach the parent feed yet.
-- Stage 3 removes this condition when parent visibility switches on.
alter policy "Parents can view activity for their own passport"
  on public.activity_log
  using (
    public.owns_passport(passport_id)
    and event_type not in ('fba_started', 'fba_completed')
  );


-- ============================================================
-- 7. get_clinician_fbas() -- convenience read RPC for the Active |
--    Completed list (Step 2), mirroring get_clinician_passports()
-- ============================================================

create or replace function public.get_clinician_fbas()
returns table (
  fba_id uuid,
  passport_id uuid,
  child_name text,
  status text,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select fr.id, fr.passport_id, p.child_name, fr.status, fr.updated_at
  from public.fba_reports fr
  join public.passports p on p.id = fr.passport_id
  join public.clinician_access ca on ca.passport_id = fr.passport_id
  where fr.clinician_id = auth.uid()
    and ca.clinician_id = auth.uid()
    and ca.is_active = true
    and public.is_verified_clinician(auth.uid())
  order by fr.updated_at desc;
$$;

grant execute on function public.get_clinician_fbas() to authenticated;


-- ============================================================
-- 8. Seed data -- QABF (25 items / 5 categories), MAS (16 items / 4
--    categories), Open-Ended Interview (10 items, free text), AFLS
--    (8 domains, 8 items each). Item text is deliberately generic
--    placeholder text ("QABF Question 1" etc.) -- replacing it with
--    real clinical wording later is one UPDATE per instrument row,
--    never a code change, per the brief.
-- ============================================================

insert into public.fba_instruments (instrument_type, version, items, is_active)
values (
  'qabf',
  1,
  (
    select jsonb_agg(
      jsonb_build_object(
        'id', 'qabf-' || n,
        'text', 'QABF Question ' || n,
        'answer_type', 'rating_scale',
        'scale', jsonb_build_array('Never', 'Rarely', 'Sometimes', 'Often', 'Always'),
        'category', (array['Attention', 'Escape', 'Physical', 'Tangible', 'Non-social'])[((n - 1) % 5) + 1]
      )
      order by n
    )
    from generate_series(1, 25) as n
  ),
  true
);

insert into public.fba_instruments (instrument_type, version, items, is_active)
values (
  'mas',
  1,
  (
    select jsonb_agg(
      jsonb_build_object(
        'id', 'mas-' || n,
        'text', 'MAS Question ' || n,
        'answer_type', 'rating_scale',
        'scale', jsonb_build_array('Never', 'Rarely', 'Sometimes', 'Often', 'Always'),
        'category', (array['Sensory', 'Escape', 'Attention', 'Tangible'])[((n - 1) % 4) + 1]
      )
      order by n
    )
    from generate_series(1, 16) as n
  ),
  true
);

insert into public.fba_instruments (instrument_type, version, items, is_active)
values (
  'open_ended',
  1,
  (
    select jsonb_agg(
      jsonb_build_object(
        'id', 'interview-' || n,
        'text', 'Interview Question ' || n,
        'answer_type', 'free_text'
      )
      order by n
    )
    from generate_series(1, 10) as n
  ),
  true
);

-- AFLS: 8 domains x 8 items, one fba_instruments row per domain so
-- Step 2 can render each as its own expandable group directly from
-- instrument_type + a domain-scoped query, without post-processing one
-- giant merged item list client-side.
insert into public.fba_instruments (instrument_type, version, items, is_active)
select
  'afls',
  1,
  (
    select jsonb_agg(
      jsonb_build_object(
        'id', lower(replace(domain, ' ', '-')) || '-' || n,
        'text', domain || ' Item ' || n,
        'answer_type', 'afls_scale',
        'scale', jsonb_build_array('Independent', 'With assistance', 'Unable', 'N/A'),
        'category', domain
      )
      order by n
    )
    from generate_series(1, 8) as n
  ),
  true
from (
  values
    ('Self-Management'),
    ('Basic Communication'),
    ('Dressing'),
    ('Toileting'),
    ('Grooming'),
    ('Bathing'),
    ('Health/Safety & First Aid'),
    ('Nighttime Routines')
) as domains(domain);
