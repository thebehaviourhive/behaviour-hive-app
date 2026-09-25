-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- OUTSTANDING-TASK SNOOZING, 25 Sept 2026. Daniel's own brief: every
-- outstanding-task/work-queue list in the product (principal, clinical
-- director, clinical lead, centre manager, teacher, clinician -- an
-- inventory pass found 31 real buckets across 7 roles, not the two he
-- expected might be found) needs a way to clear an item that isn't
-- actionable yet, without permanently hiding it. "Snooze this for N
-- days, it comes back on its own, nothing is ever silently gone."
--
-- THE MODEL, verbatim from the brief: snooze for N days (default 5,
-- configurable PER INSTITUTION on that institution's own settings
-- screen); institution-wide, not per-user (one shared queue, one
-- shared state); re-snoozing allowed; a full audit trail that survives
-- expiry; a repeated-snooze count, surfaced once it reaches three.
--
-- ITEM IDENTITY IS NOT UNIFORM ACROSS THE 31 BUCKETS, CONFIRMED BY A
-- DEDICATED INVENTORY PASS BEFORE THIS WAS DESIGNED. Most buckets have
-- a real, stable row id (incidents.id, institution_staff.id,
-- fba_reports.id, tag_change_requests.id, ...). A few do not: the
-- stagnation queue and the "school link, nothing shared yet" bucket
-- are keyed on passport_id alone (no dedicated row); "no bookable
-- session types" is a bare institution-level boolean with no row at
-- all. `item_id uuid` is deliberately generic enough to hold any of
-- these -- a real row's own id, or a passport_id, or (for the one
-- rowless bucket) the institution_id itself -- because a single-item-
-- shape schema would not have fit a third of what this feature needs
-- to cover. `queue_key` is what disambiguates which of these an
-- item_id actually means; the canonical list of queue_key values lives
-- in src/lib/outstandingTaskQueues.ts, not here, since it's a client-
-- side rendering concern, not a database constraint -- a CHECK
-- enumerating every queue_key would need editing every time a new
-- bucket is added, for a value this schema never itself branches on.
--
-- APPEND-ONLY, NOT AN EDITABLE "CURRENT STATE" ROW -- THE AUDIT TRAIL
-- IS NON-NEGOTIABLE ("a task about a child that vanished with no
-- record is the first thing an inspection would ask about... must
-- survive the snooze expiring"). Every snooze action is its own row,
-- never updated, never deleted. "Is this item currently snoozed" and
-- "how many times has it been snoozed" are both DERIVED by reading the
-- log (get_institution_snooze_status(), below), never a separate
-- mutable flag that could silently drift from what actually happened.
-- Matches this schema's own established audit-log shape (principal_
-- handovers, incident_amendments) -- no UPDATE/DELETE policy at all,
-- on this table or through any RPC.
--
-- GRANT AT TABLE LEVEL, PER DANIEL'S OWN EXPLICIT INSTRUCTION -- this
-- schema has been bitten once already by abc_logs' own SELECT grant
-- being replaced with an explicit column list (0021), which silently
-- stranded every column added to that table since, unreadable by any
-- raw client query, until 0298 finally caught and fixed it. `grant
-- select on public.outstanding_task_snoozes to authenticated` below is
-- deliberately table-wide, so a future column added to this table is
-- never at risk of repeating that mistake.
--
-- ONLY ONE POLICY ON THIS TABLE, CHECKED DELIBERATELY -- PER DANIEL'S
-- OWN INSTRUCTION TO CHECK FOR A "for all" MANAGEMENT POLICY THAT
-- COULD COMBINE WITH OR. This schema has one real, documented instance
-- of that exact trap (session_types, 0287/0288: a SELECT-specific
-- policy correctly tightened while a second, unrelated `for all`
-- policy kept the same table wide open, because permissive RLS
-- policies OR-combine and nothing had inventoried every policy on that
-- table before declaring it closed). This table gets exactly ONE
-- policy, `for select`, and nothing else -- no `for all`, no INSERT/
-- UPDATE/DELETE policy of any shape -- so there is no second door to
-- have missed. Every write goes through snooze_outstanding_task()
-- below, a SECURITY DEFINER function that bypasses RLS entirely and is
-- therefore never gated by a client-facing policy at all.

alter table public.institutions
  add column if not exists default_snooze_days integer not null default 5
    check (default_snooze_days > 0 and default_snooze_days <= 90);

comment on column public.institutions.default_snooze_days is
  'The number of days an outstanding-task item is snoozed for when no explicit length is given. Settable by the institution''s own leader (principal for a school/clinic, centre_manager for a respite_centre) via set_institution_default_snooze_days(). Default 5, matching the brief''s own stated default.';

create table public.outstanding_task_snoozes (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions (id) on delete cascade,
  queue_key text not null,
  item_id uuid not null,
  snoozed_by uuid not null references auth.users (id) on delete cascade,
  snoozed_at timestamptz not null default now(),
  snoozed_until timestamptz not null,
  reason text not null check (char_length(trim(reason)) > 0),
  check (snoozed_until > snoozed_at)
);

comment on table public.outstanding_task_snoozes is
  'Append-only audit log. One row per snooze action -- never updated, never deleted. "Currently snoozed" and "snooze count" are both derived by reading this log (get_institution_snooze_status()), not stored as a separate mutable flag. Survives the snooze itself expiring, by design -- the trail is the point.';

create index outstanding_task_snoozes_lookup_idx
  on public.outstanding_task_snoozes (institution_id, queue_key, item_id, snoozed_at desc);

alter table public.outstanding_task_snoozes enable row level security;

-- The ONE policy on this table. Broad ("any current-standing staff at
-- this institution", not role-restricted further) because snoozes are
-- explicitly institution-wide shared state, not a per-role secret --
-- the same posture institutions' own `using (true)` SELECT policy and
-- this schema's other broadly-shared per-institution tables already
-- take.
create policy "Institution staff can view their own institution's snoozes"
  on public.outstanding_task_snoozes
  for select
  to authenticated
  using (public.institution_staff_has_current_standing(auth.uid(), institution_id));

grant select on public.outstanding_task_snoozes to authenticated;

-- ===========================================================================
-- snooze_outstanding_task() -- the one write path. No INSERT policy on
-- the table at all; this SECURITY DEFINER function is the only way any
-- row is ever created, matching bsp's own "no client write policy,
-- functions only" posture. auth.uid() is stamped server-side, never
-- taken from a client-supplied parameter -- this schema's own standing
-- "never trust a client-supplied role/via value" rule.
-- ===========================================================================

create or replace function public.snooze_outstanding_task(
  p_institution_id uuid,
  p_queue_key text,
  p_item_id uuid,
  p_reason text,
  p_days integer default null
)
returns table (snoozed_until timestamptz, snooze_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer;
  v_until timestamptz;
begin
  if not public.institution_staff_has_current_standing(auth.uid(), p_institution_id) then
    raise exception 'You do not have current standing at this institution.';
  end if;

  if p_reason is null or char_length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to snooze an outstanding task.';
  end if;

  -- p_days is optional -- when omitted (the ordinary case), falls back
  -- to this institution's own configured default. Re-snoozing with an
  -- explicit p_days is how a colleague could snooze for longer than
  -- the default without changing the institution's own setting.
  select coalesce(p_days, i.default_snooze_days) into v_days
  from public.institutions i where i.id = p_institution_id;

  if v_days is null or v_days <= 0 or v_days > 90 then
    raise exception 'Enter a number of days between 1 and 90.';
  end if;

  v_until := now() + (v_days || ' days')::interval;

  insert into public.outstanding_task_snoozes (institution_id, queue_key, item_id, snoozed_by, snoozed_until, reason)
  values (p_institution_id, p_queue_key, p_item_id, auth.uid(), v_until, trim(p_reason));

  -- Returns the new snoozed_until plus the item's own total snooze
  -- count (including the row just inserted), so the client can render
  -- "Snoozed until X -- 3rd time" immediately, no second round trip.
  return query
  select v_until, count(*)::integer
  from public.outstanding_task_snoozes s
  where s.institution_id = p_institution_id and s.queue_key = p_queue_key and s.item_id = p_item_id;
end;
$$;

grant execute on function public.snooze_outstanding_task(uuid, text, uuid, text, integer) to authenticated;

-- ===========================================================================
-- get_institution_snooze_status() -- the one read path. Returns a row
-- for every (queue_key, item_id) that has EVER been snoozed at this
-- institution (not just currently-active ones) -- a client needs both:
-- is_currently_snoozed to filter the default view, and snooze_count on
-- an item that has EXPIRED and come back, to show "snoozed 3 times"
-- even though it's no longer actively snoozed right now.
-- ===========================================================================

create or replace function public.get_institution_snooze_status(
  p_institution_id uuid,
  p_queue_key text default null
)
returns table (
  queue_key text,
  item_id uuid,
  is_currently_snoozed boolean,
  snoozed_until timestamptz,
  snooze_count integer,
  last_reason text,
  last_snoozed_by uuid,
  last_snoozed_by_name text,
  last_snoozed_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  with latest as (
    select distinct on (s.queue_key, s.item_id)
      s.queue_key, s.item_id, s.snoozed_until, s.reason, s.snoozed_by, s.snoozed_at
    from public.outstanding_task_snoozes s
    where s.institution_id = p_institution_id
      and (p_queue_key is null or s.queue_key = p_queue_key)
    order by s.queue_key, s.item_id, s.snoozed_at desc
  ),
  counts as (
    select s.queue_key, s.item_id, count(*)::integer as total
    from public.outstanding_task_snoozes s
    where s.institution_id = p_institution_id
      and (p_queue_key is null or s.queue_key = p_queue_key)
    group by s.queue_key, s.item_id
  )
  select
    l.queue_key,
    l.item_id,
    l.snoozed_until > now(),
    l.snoozed_until,
    c.total,
    l.reason,
    l.snoozed_by,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
    l.snoozed_at
  from latest l
  join counts c on c.queue_key = l.queue_key and c.item_id = l.item_id
  left join auth.users u on u.id = l.snoozed_by
  where public.institution_staff_has_current_standing(auth.uid(), p_institution_id);
$$;

grant execute on function public.get_institution_snooze_status(uuid, text) to authenticated;

-- ===========================================================================
-- set_institution_default_snooze_days() -- the per-institution N.
-- Gated on the same "leadership" role every other institution-wide
-- toggle/setting in this schema already uses -- principal for a school
-- OR a clinic (both use that role value), centre_manager for a respite
-- centre. Direct institutions.default_snooze_days reads need no RPC --
-- institutions' own SELECT policy has been `using (true)` since
-- migration 0013, the same reason /principal/clinic already reads
-- clinic_hours_start_time etc. via a plain client-side select.
-- ===========================================================================

create or replace function public.set_institution_default_snooze_days(
  p_institution_id uuid,
  p_days integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_days is null or p_days <= 0 or p_days > 90 then
    raise exception 'Enter a number of days between 1 and 90.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions i on i.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
      and (
        (i.type in ('school', 'clinic') and s.role = 'principal')
        or (i.type = 'respite_centre' and s.role = 'centre_manager')
      )
  ) then
    raise exception 'Only this institution''s own leader may change this setting.';
  end if;

  update public.institutions set default_snooze_days = p_days where id = p_institution_id;
end;
$$;

grant execute on function public.set_institution_default_snooze_days(uuid, integer) to authenticated;

-- ===========================================================================
-- THE DEEPER FIX -- "an FBA that has been started is not outstanding
-- work for the director, it is work already happening." Changes what
-- THE QUEUE understands about an FBA's state, reading fba_reports'
-- own already-existing content_data column from outside -- nothing
-- inside the FBA feature is touched, per the standing instruction.
--
-- fba_reports.status (0040) allows 'draft' | 'in_progress' |
-- 'completed', but 'in_progress' is never actually written anywhere in
-- this schema's live history -- confirmed by grep before writing this,
-- not assumed. useFbaReport.ts's own saveContent() is the only writer
-- of status, and it only ever sets 'draft' (on creation, untouched) or
-- 'completed' (finalize_fba_report()). So `status <> 'completed'`
-- (the bucket's previous filter) was really "everything that isn't
-- finished" -- collapsing a genuinely just-created, untouched shell
-- and an FBA someone has been actively writing for six weeks into the
-- identical row, with the identical "Review" action, for the entire
-- 8-10 weeks an FBA legitimately takes.
--
-- The fix: only surface a draft FBA here when content_data is still
-- the bare '{}'::jsonb default it's created with -- genuinely nothing
-- written, not merely unfinished. The moment a clinician saves a
-- single section, this bucket stops surfacing it on its own, without
-- anyone needing to snooze anything -- exactly the brief's own words.
-- Same signature, same shape, every other clause unchanged.
-- ===========================================================================

create or replace function public.get_institution_draft_fbas(p_institution_id uuid)
returns table (
  fba_id uuid,
  passport_id uuid,
  child_name text,
  clinician_id uuid,
  clinician_name text,
  status text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select f.id, f.passport_id, p.child_name, f.clinician_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'), f.status, f.created_at
  from public.fba_reports f
  join public.passports p on p.id = f.passport_id
  join auth.users u on u.id = f.clinician_id
  where f.status <> 'completed'
    and f.content_data = '{}'::jsonb
    and exists (
      select 1 from public.institution_staff s
      where s.institution_id = p_institution_id
        and s.user_id = f.clinician_id
        and s.role = 'clinician'
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    )
    and exists (
      select 1 from public.institution_staff caller
      join public.institutions inst on inst.id = caller.institution_id
      where caller.institution_id = p_institution_id
        and caller.user_id = auth.uid()
        and caller.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(caller.user_id, caller.institution_id)
    )
  order by f.created_at;
$$;

grant execute on function public.get_institution_draft_fbas(uuid) to authenticated;
