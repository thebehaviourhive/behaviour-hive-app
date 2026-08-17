-- TEACHER ABC VISIBILITY -- governance change (clinical lead decision):
-- teachers may see ONLY (a) incident logs they authored themselves, and
-- (b) individual logs explicitly shared with them via an incident-note
-- message where they are a recipient (the parent/clinician who chose to
-- send that note IS the relevance decision). Teachers lose passport-wide
-- browsing of the child's full ABC history. Parent and clinician
-- visibility is completely unchanged (parents see all for their own
-- child; clinicians see all for their actively-linked, verified cases).
--
-- Enforced at every read path a teacher has to abc_logs:
--   1. abc_logs' own teacher SELECT policy -- the real bar. Everything
--      else (get_abc_logs/get_abc_trend_data) is a SECURITY DEFINER
--      convenience wrapper, but a teacher session querying the table
--      directly (e.g. AbcLogReference.tsx's existence check) is still
--      bound by this policy, so it has to carry the actual narrowing.
--   2. get_abc_logs() -- the teacher timeline/list view's data source.
--   3. get_abc_trend_data() -- the Progress tab's chart data source.
--   4. get_teacher_activity_feed() -- abc_logged events narrowed to
--      teacher-authored only; every other event type is untouched.
--
-- The "shared" grant: a log counts as shared to a teacher the moment ANY
-- message referencing it (messages.abc_log_id) lists that teacher as a
-- recipient (message_recipients.recipient_id) -- regardless of who sent
-- it. This already exists structurally (Stage 3A's abc_log_id column +
-- send_message's same-passport check, whose own comment already says
-- "the log's own RLS still protects its content when a recipient later
-- views it"); this migration is what actually turns that reference into
-- a real visibility grant, rather than the log simply riding along on
-- the teacher's old passport-wide access.
--
-- Still gated on genuine active linkage: a teacher must also still be
-- actively, parent-approved-linked to the passport at all (same
-- is_active check every branch already had) -- a fully revoked teacher
-- loses everything on that passport, own-authored logs included, same
-- posture as the messages system's own revocation rule.
--
-- No retroactive weirdness: a message already sent to a teacher with an
-- abc_log_id keeps working exactly as it did (that reference IS the
-- share, whenever it happened, past or future). A log a teacher could
-- once browse but was never actually shared with them becomes
-- unreachable the moment this migration runs -- that is the intended
-- effect of the governance change, not a bug, and is stated here
-- explicitly per the brief's own instruction to say so.

-- =====================================================================
-- 1. abc_logs' own teacher SELECT policy.
-- =====================================================================
drop policy if exists "Teachers can view abc logs for passports they access" on public.abc_logs;

create policy "Teachers can view abc logs for passports they access"
  on public.abc_logs
  for select
  to authenticated
  using (
    exists (
      select 1 from public.passport_access pa
      where pa.passport_id = abc_logs.passport_id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
    )
    and (
      abc_logs.logged_by = auth.uid()
      or exists (
        select 1 from public.messages m
        join public.message_recipients mr on mr.message_id = m.id
        where m.abc_log_id = abc_logs.id
          and mr.recipient_id = auth.uid()
      )
    )
  );

-- =====================================================================
-- 2. get_abc_logs -- same narrowing inside the teacher branch of its own
--    WHERE clause. Parent and clinician branches, the return column
--    list, and the perceived_function gating (0052) are byte-identical
--    to the current function -- sharing widens WHICH rows a teacher can
--    reach, never WHAT FIELDS any row returns.
-- =====================================================================
create or replace function public.get_abc_logs(p_passport_id uuid)
returns table (
  id uuid,
  passport_id uuid,
  logged_by uuid,
  logged_by_name text,
  logged_by_role text,
  incident_date date,
  incident_time time,
  duration_minutes integer,
  intensity integer,
  antecedents text[],
  antecedent_other text,
  behaviours text[],
  behaviour_other text,
  consequences text[],
  consequence_other text,
  perceived_function text,
  general_notes text,
  is_draft boolean,
  sync_status text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    a.id, a.passport_id, a.logged_by,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as logged_by_name,
    a.logged_by_role, a.incident_date, a.incident_time, a.duration_minutes,
    a.intensity, a.antecedents, a.antecedent_other, a.behaviours, a.behaviour_other,
    a.consequences, a.consequence_other,
    case
      when public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = a.passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
      then a.perceived_function
      else null
    end as perceived_function,
    a.general_notes,
    a.is_draft, a.sync_status, a.created_at
  from public.abc_logs a
  join auth.users u on u.id = a.logged_by
  where a.passport_id = p_passport_id
    and (
      public.owns_passport(p_passport_id)
      or (
        exists (
          select 1 from public.passport_access pa
          where pa.passport_id = p_passport_id
            and pa.teacher_id = auth.uid()
            and pa.is_active = true
        )
        and (
          a.logged_by = auth.uid()
          or exists (
            select 1 from public.messages m
            join public.message_recipients mr on mr.message_id = m.id
            where m.abc_log_id = a.id
              and mr.recipient_id = auth.uid()
          )
        )
      )
      or (
        public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = p_passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
      )
    )
  order by a.incident_date desc, a.incident_time desc;
$$;

grant execute on function public.get_abc_logs(uuid) to authenticated;

-- =====================================================================
-- 3. get_abc_trend_data -- identical narrowing in the same teacher
--    branch. Parent and clinician branches and the return shape are
--    unchanged -- the Progress tab's chart now simply computes from
--    whatever rows the teacher can actually reach.
-- =====================================================================
create or replace function public.get_abc_trend_data(p_passport_id uuid)
returns table (
  id uuid,
  incident_date date,
  incident_time time,
  logged_by_role text,
  duration_minutes integer,
  intensity integer,
  antecedents text[],
  behaviours text[],
  consequences text[]
)
language sql
security definer
set search_path = public
stable
as $$
  select
    a.id, a.incident_date, a.incident_time, a.logged_by_role,
    a.duration_minutes, a.intensity, a.antecedents, a.behaviours, a.consequences
  from public.abc_logs a
  where a.passport_id = p_passport_id
    and (
      public.owns_passport(p_passport_id)
      or (
        exists (
          select 1 from public.passport_access pa
          where pa.passport_id = p_passport_id
            and pa.teacher_id = auth.uid()
            and pa.is_active = true
        )
        and (
          a.logged_by = auth.uid()
          or exists (
            select 1 from public.messages m
            join public.message_recipients mr on mr.message_id = m.id
            where m.abc_log_id = a.id
              and mr.recipient_id = auth.uid()
          )
        )
      )
      or (
        public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = p_passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
      )
    )
  order by a.incident_date asc, a.incident_time asc;
$$;

grant execute on function public.get_abc_trend_data(uuid) to authenticated;

-- =====================================================================
-- 4. get_teacher_activity_feed -- abc_logged events narrowed to
--    teacher-authored only (actor_id = auth.uid()). Every other event
--    type (passport_updated, team_linked, strategy_logged,
--    access_revoked, afternoon_update, clinical_content_added) is
--    completely untouched -- this governance change is scoped to ABC
--    logs specifically, not to activity visibility generally. The
--    pre-existing "not exists (... clinicians ...)" clause already
--    excluded clinician-authored rows across the board; this adds the
--    equivalent exclusion for parent-authored abc_logged rows too,
--    narrowly, without touching how any other event type behaves.
-- =====================================================================
create or replace function public.get_teacher_activity_feed(
  p_limit integer default 20, p_offset integer default 0
)
returns table (
  id uuid, passport_id uuid, child_name text, event_type text,
  event_description text, created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select al.id, al.passport_id, p.child_name, al.event_type, al.event_description, al.created_at
  from public.activity_log al
  join public.passports p on p.id = al.passport_id
  join public.passport_access pa
    on pa.passport_id = al.passport_id
    and pa.teacher_id = auth.uid()
    and pa.is_active = true
  join public.passport_institution_links pil
    on pil.passport_id = pa.passport_id
    and pil.institution_id = pa.institution_id
    and pil.approved_by_parent = true
  where al.event_type in (
      'passport_updated', 'abc_logged', 'team_linked', 'strategy_logged',
      'access_revoked', 'afternoon_update', 'clinical_content_added'
    )
    and (al.event_type <> 'abc_logged' or al.actor_id = auth.uid())
    and not exists (
      select 1 from public.clinicians c where c.user_id = al.actor_id
    )
  order by al.created_at desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.get_teacher_activity_feed(integer, integer) to authenticated;
