-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Time-on-task instrumentation, Pass 1 of 2 (the smaller pass, the one
-- Daniel most wants: "how long does the 15-second stamp actually
-- take"). Blocked on Catherine + a DPA reviewer for the secondary-
-- purpose review before any REPORT is produced from this data --
-- collecting it is not the same decision as reporting on it, and this
-- migration only does the former. Nothing here is surfaced in-product;
-- these columns are read only by direct, service-role query for an
-- internal report, exactly like the existing recorded_at/teacher_
-- signed_at/countersigned_at columns already are.
--
-- WHAT THIS ADDS, and why each one is a plain nullable column rather
-- than a new table or a new RPC surface:
--
-- 1. incidents.stamp_opened_at / stamp_first_input_at -- captured on the
--    CREATOR's own device (screen-open, first keystroke/tap) and passed
--    as two new trailing parameters into create_incident_stamp() itself.
--    This MUST happen inside the RPC, not via a client follow-up
--    .update() after creation, because the creator is not always the
--    eventual owning_teacher_id (0159: an SNA present for a crisis is
--    the common case that isn't eligible to own the incident) -- a
--    follow-up update from the creator would be silently filtered by
--    the "Owning teacher can edit before teacher sign-off" policy
--    exactly the way CLAUDE.md's first documented gotcha describes,
--    and would specifically and silently drop this data for every SNA-
--    stamped incident, not a rare edge case in a special school.
--
--    create_incident_stamp()'s parameter list has never changed across
--    five prior migrations (checked directly, all five: 0069/0097/0100/
--    0105/0159) -- this is the first time it grows, so per CLAUDE.md's
--    own rule this is DROP + CREATE, never a bare CREATE OR REPLACE.
--
--    Both new parameters default null and are never validated in a way
--    that can reject the insert -- a malformed or missing timing value
--    must never be the reason a real incident stamp fails. Nonsensical
--    values (first-input logged before open, or either timestamp
--    implausibly in the future) are silently nulled inside the
--    function, not raised.
--
-- 2. incidents.stage_two_opened_at / stage_two_first_edit_at -- NOT
--    threaded through any RPC. Stage two is a resumable, multi-session
--    editing process (open today, finish signing off two days later),
--    not a single form submission -- there is no one moment to attach
--    these to except "the first time it happens", which the client
--    sets directly via a plain .update(), guarded by "only if not
--    already set". This is deliberately, and correctly, scoped by the
--    EXISTING "Owning teacher can edit before teacher sign-off" policy
--    (0106's live definition: owning_teacher_id = auth.uid(), teacher_
--    signed_at is null) -- these two timestamps are about how long the
--    person actually responsible for the record took, which is exactly
--    who that policy already restricts writes to. No new policy needed.
--
-- 3. teacher_updates.screen_opened_at / first_input_at / submission_
--    source -- all three set by the client at insert time, riding along
--    on the existing plain .insert() (no RPC, no extra network round
--    trip). submission_source ('standalone' | 'bulk') answers "did bulk
--    EOD change the per-child time" -- named in CLAUDE.md as the one
--    column needed to stop that comparison from relying on inferring
--    clustering from submitted_at gaps.
--
-- 4. abc_logs.screen_opened_at / first_input_at, morning_checkins.
--    screen_opened_at / first_input_at -- same shape as teacher_updates,
--    same reasoning: both are plain client .insert() calls, both get
--    the two new columns as extra insert values, zero new round trips.
--
-- NO CHECK CONSTRAINTS on any of these eight new columns. Every other
-- timestamp pair in this schema (recorded_at/occurred_at, teacher_
-- signed_at/countersigned_at) is safeguarding-record content and is
-- rightly strict. These are instrumentation: bad or missing data here
-- degrades a future report, it must never degrade or block the actual
-- record. That asymmetry is deliberate, not an oversight.
--
-- RETENTION: these are operational columns on records that are
-- themselves retained for the underlying record's own, much longer,
-- safeguarding-retention reasons -- they don't need (and structurally
-- can't have) a separate retention period from the row they sit on.
-- The standalone events table (Pass 2, not this migration) is the one
-- that needs its own retention decision, because it isn't a column on
-- an existing legal record.

alter table public.incidents
  add column stamp_opened_at timestamptz,
  add column stamp_first_input_at timestamptz,
  add column stage_two_opened_at timestamptz,
  add column stage_two_first_edit_at timestamptz;

alter table public.teacher_updates
  add column screen_opened_at timestamptz,
  add column first_input_at timestamptz,
  add column submission_source text check (submission_source is null or submission_source in ('standalone', 'bulk'));

alter table public.abc_logs
  add column screen_opened_at timestamptz,
  add column first_input_at timestamptz;

alter table public.morning_checkins
  add column screen_opened_at timestamptz,
  add column first_input_at timestamptz;

-- create_incident_stamp() -- DROP + CREATE (see header). Everything
-- below is byte-identical to the live 0159 body except: two new
-- trailing parameters, the defensive sanitisation block right after the
-- existing staff-role check (kept as early as possible, before any
-- mutating statement -- same "guard order" convention this function's
-- own comments already follow), and the two new columns in the
-- incidents insert.

drop function if exists public.create_incident_stamp(uuid, timestamptz, uuid, uuid[], jsonb);

create function public.create_incident_stamp(
  p_institution_id uuid,
  p_occurred_at timestamptz,
  p_location_id uuid,
  p_child_passport_ids uuid[],
  p_staff jsonb,
  p_client_opened_at timestamptz default null,
  p_client_first_input_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_incident_id uuid;
  v_child_count integer;
  v_child_index text;
  v_passport_id uuid;
  v_i integer;
  v_staff_entry jsonb;
  v_user_id uuid;
  v_free_text_name text;
  v_involvement text;
  v_owning_teacher_id uuid;
  v_candidate_teacher_id uuid;
  v_stamp_opened_at timestamptz := p_client_opened_at;
  v_stamp_first_input_at timestamptz := p_client_first_input_at;
begin
  select role into v_caller_role
  from public.institution_staff
  where institution_id = p_institution_id
    and user_id = auth.uid()
    and deactivated_at is null
    and approved_at is not null;

  if v_caller_role is null or v_caller_role not in ('class_teacher', 'sna', 'principal') then
    raise exception 'You are not registered as school staff at this institution.';
  end if;

  -- Defensive sanitisation, never rejection -- a malformed timing value
  -- must never be the reason a real incident stamp fails. Implausible
  -- (more than 5 minutes in the future, allowing for ordinary clock
  -- skew) or internally inconsistent (first input logged before open)
  -- values are silently dropped, not raised.
  if v_stamp_opened_at is not null and v_stamp_opened_at > now() + interval '5 minutes' then
    v_stamp_opened_at := null;
  end if;
  if v_stamp_first_input_at is not null and v_stamp_first_input_at > now() + interval '5 minutes' then
    v_stamp_first_input_at := null;
  end if;
  if v_stamp_first_input_at is not null and (v_stamp_opened_at is null or v_stamp_first_input_at < v_stamp_opened_at) then
    v_stamp_first_input_at := null;
  end if;

  if p_child_passport_ids is null or array_length(p_child_passport_ids, 1) is null or array_length(p_child_passport_ids, 1) = 0 then
    raise exception 'At least one child is required.';
  end if;
  v_child_count := array_length(p_child_passport_ids, 1);
  if v_child_count > 2 then
    raise exception 'An incident can name at most two children.';
  end if;

  -- Owner resolution -- see this migration's own header for the full
  -- reasoning and ordering.
  if public.can_own_incident(auth.uid(), p_institution_id) then
    v_owning_teacher_id := auth.uid();
  else
    v_owning_teacher_id := null;

    for v_i in 1 .. array_length(p_child_passport_ids, 1)
    loop
      select ct.user_id into v_candidate_teacher_id
      from public.class_children cc
      join public.class_teachers ct on ct.class_id = cc.class_id
      where cc.passport_id = p_child_passport_ids[v_i]
        and cc.ended_at is null
        and ct.ended_at is null
        and public.can_own_incident(ct.user_id, p_institution_id)
      order by ct.position asc
      limit 1;

      if v_candidate_teacher_id is not null then
        v_owning_teacher_id := v_candidate_teacher_id;
        exit;
      end if;
    end loop;

    if v_owning_teacher_id is null then
      select user_id into v_owning_teacher_id
      from public.institution_staff
      where institution_id = p_institution_id
        and role = 'principal'
        and deactivated_at is null
        and approved_at is not null
      limit 1;
    end if;
  end if;

  v_incident_id := gen_random_uuid();

  insert into public.incidents (
    id, institution_id, created_by, owning_teacher_id, occurred_at, location_id,
    stamp_opened_at, stamp_first_input_at
  )
  values (
    v_incident_id, p_institution_id, auth.uid(), v_owning_teacher_id,
    p_occurred_at, p_location_id,
    v_stamp_opened_at, v_stamp_first_input_at
  );

  v_i := 0;
  foreach v_passport_id in array p_child_passport_ids
  loop
    if not exists (
      select 1 from public.passport_institution_links pil
      where pil.passport_id = v_passport_id and pil.institution_id = p_institution_id
    ) then
      raise exception 'Child % is not connected to this institution.', v_passport_id;
    end if;

    v_child_index := case when v_i = 0 then 'A' else 'B' end;
    insert into public.incident_children (incident_id, passport_id, child_index, added_by)
    values (v_incident_id, v_passport_id, v_child_index, auth.uid());
    v_i := v_i + 1;
  end loop;

  if p_staff is not null then
    for v_staff_entry in select * from jsonb_array_elements(p_staff)
    loop
      v_user_id := nullif(v_staff_entry ->> 'user_id', '')::uuid;
      v_free_text_name := nullif(v_staff_entry ->> 'free_text_name', '');
      v_involvement := coalesce(nullif(v_staff_entry ->> 'involvement', ''), 'involved');

      if v_user_id is null and v_free_text_name is null then
        raise exception 'Each staff entry needs either user_id or free_text_name.';
      end if;
      if v_involvement not in ('involved', 'witnessed') then
        raise exception 'Invalid involvement value: %', v_involvement;
      end if;

      insert into public.incident_staff (incident_id, user_id, free_text_name, involvement)
      values (v_incident_id, v_user_id, v_free_text_name, v_involvement);
    end loop;
  end if;

  return v_incident_id;
end;
$$;

grant execute on function public.create_incident_stamp(uuid, timestamptz, uuid, uuid[], jsonb, timestamptz, timestamptz) to authenticated;
