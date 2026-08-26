-- Phase 4, piece 3: countersign.
--
-- countersigned_via is a SEPARATE fact from countersigned_role_at_time --
-- the latter answers "what standing did this person have" (their real
-- institution_staff.role, honestly null if they genuinely have none --
-- verified this session: not reachable through the app today, since
-- institution_staff has no DELETE policy and guard_institution_permissions_
-- grantee_is_staff() only validates at grant-creation time; still handled
-- correctly rather than assumed impossible), while countersigned_via
-- answers "under what authority" -- 'principal_role' or 'grant'. Two
-- separate true facts, nothing invented for the case with no real answer.
--
-- Both are DERIVED by a dedicated trigger (derive_countersign_fields,
-- below), not validated against a client-submitted value the way the
-- previous WITH CHECK tried to -- that comparison was fragile (a bare
-- `=` against a subquery that could return no rows, which would have
-- silently rejected a legitimate grant-only countersign the day
-- institution_staff ever gains a real removal path) and couldn't
-- express countersigned_via's conditional logic at all. The trigger
-- fires on the countersigned_at null->not-null transition regardless of
-- how the write is issued -- the RPC below, or any other path that could
-- ever reach this column -- so there is exactly one place this logic
-- lives, matching derive_incident_status()'s own precedent (0089).

alter table public.incidents
  add column countersigned_via text;

alter table public.incidents
  add constraint incidents_countersigned_via_check
  check (countersigned_via is null or countersigned_via in ('principal_role', 'grant'));

alter table public.incidents
  add constraint incidents_countersigned_via_paired_check
  check ((countersigned_at is null) = (countersigned_via is null));

-- guard_incident_immutability -- byte-identical to the live definition
-- verified this session, except one new array element (countersigned_via
-- is settable exactly once, same moment as the other three countersign
-- fields and status).
create or replace function public.guard_incident_immutability()
returns trigger
language plpgsql
as $function$
declare
  v_mutable_keys text[] := array['updated_at', 'countersigned_at', 'countersigned_by', 'countersigned_role_at_time', 'countersigned_via', 'status'];
  v_old_jsonb jsonb;
  v_new_jsonb jsonb;
  v_key text;
begin
  if old.teacher_signed_at is not null then
    v_old_jsonb := to_jsonb(old);
    v_new_jsonb := to_jsonb(new);
    foreach v_key in array v_mutable_keys loop
      v_old_jsonb := v_old_jsonb - v_key;
      v_new_jsonb := v_new_jsonb - v_key;
    end loop;
    if v_old_jsonb is distinct from v_new_jsonb then
      raise exception 'This incident is teacher-signed and immutable. Use incident_amendments to add a correction.';
    end if;
  end if;
  return new;
end;
$function$;

-- derive_countersign_fields -- the trigger that replaces the fragile
-- WITH CHECK. Null-safe by construction: if the caller has no
-- institution_staff row at this institution at all (grant-only,
-- currently unreachable per the comment above), v_role is null, the
-- CASE falls through to 'grant' (the only way can_countersign_incident()
-- could have been true without a 'principal' role row), and
-- countersigned_role_at_time is stored as the honest null rather than a
-- guessed value.
create or replace function public.derive_countersign_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text;
begin
  if new.countersigned_at is not null and old.countersigned_at is null then
    select s.role into v_role
    from public.institution_staff s
    where s.institution_id = new.institution_id
      and s.user_id = auth.uid();

    new.countersigned_by := auth.uid();
    new.countersigned_role_at_time := v_role;
    new.countersigned_via := case when v_role = 'principal' then 'principal_role' else 'grant' end;
  end if;
  return new;
end;
$function$;

create trigger derive_countersign_fields
before update on public.incidents
for each row execute function public.derive_countersign_fields();

-- Simplify the "Principal can countersign" policy's WITH CHECK now that
-- the trigger above is the sole source of truth for those three fields
-- -- the old comparison would always be a tautology post-trigger (and
-- was null-unsafe before it). USING remains the actual authorization
-- gate, unchanged. Real protection against sneaking a change to
-- anything else through this policy still comes from
-- guard_incident_immutability(), which fires regardless of which policy
-- admitted the write.
alter policy "Principal can countersign after teacher sign-off"
on public.incidents
with check (true);

-- Shared helper, extracted from get_incident_signoff_summary()'s
-- existing jsonb_agg block (verified live before this migration) so
-- get_countersign_summary() below doesn't duplicate it a second time --
-- that block has already had one casing bug (0087) fixed once.
-- Internal only: no visibility check of its own (same posture as
-- incident_signoff_issues(), trusted to only be called from something
-- that already checked), execute revoked from public/anon/authenticated.
create or replace function public.build_staff_attestations_summary(p_incident_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
      'incident_staff_id', st.id,
      'name', coalesce(
        nullif(trim(st.free_text_name), ''),
        coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
        'Named staff member'
      ),
      'has_account', st.user_id is not null,
      'status', case when st.user_id is null then 'not_attested' else public.get_attestation_status(st.id) end,
      'status_label', case
        when st.user_id is null then 'Not attested -- no account'
        else case public.get_attestation_status(st.id)
          when 'current' then 'Current'
          when 'stale' then 'Stale'
          when 'withdrawn' then 'Withdrawn'
          when 'not_attested' then 'Not attested'
          else initcap(replace(public.get_attestation_status(st.id), '_', ' '))
        end
      end,
      'blocks_signoff', st.user_id is not null and public.get_attestation_status(st.id) in ('stale', 'withdrawn')
    ) order by st.id), '[]'::jsonb)
  from public.incident_staff st
  left join auth.users u on u.id = st.user_id
  where st.incident_id = p_incident_id;
$function$;

revoke execute on function public.build_staff_attestations_summary(uuid) from public, anon, authenticated;

-- get_incident_signoff_summary -- identical behavior, identical error
-- messages, identical return shape to the live definition verified
-- before this migration. The only change is where the staff block
-- comes from.
create or replace function public.get_incident_signoff_summary(p_incident_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_incident public.incidents;
  v_staff jsonb;
  v_issues jsonb;
begin
  select * into v_incident from public.incidents where id = p_incident_id;
  if not found then
    raise exception 'Incident not found, or you do not have permission to view it.';
  end if;

  if not (v_incident.created_by = auth.uid() or v_incident.owning_teacher_id = auth.uid()) then
    raise exception 'Only this incident''s creator or owning teacher can view its sign-off summary.';
  end if;

  if v_incident.teacher_signed_at is not null then
    raise exception 'This incident has already been signed off.';
  end if;

  v_staff := public.build_staff_attestations_summary(p_incident_id);
  v_issues := public.incident_signoff_issues(v_incident);

  return jsonb_build_object(
    'can_sign_off', jsonb_array_length(v_issues) = 0,
    'blocking_issues', v_issues,
    'staff_attestations', v_staff,
    'anyone_injured', jsonb_build_object(
      'value', v_incident.anyone_injured,
      'note', case when v_incident.anyone_injured is null then 'not recorded' else null end
    )
  );
end;
$function$;

-- get_countersign_summary -- new. Can't reuse get_incident_signoff_summary
-- directly: it explicitly throws once teacher_signed_at is set (the only
-- moment a principal would ever call this), and its blocking_issues/
-- can_sign_off fields describe what blocks TEACHER sign-off, which is
-- moot and the wrong frame once past that point. Gated to
-- can_countersign_incident() only -- not creator/owning teacher, who
-- this isn't for.
create or replace function public.get_countersign_summary(p_incident_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_incident public.incidents;
  v_staff jsonb;
  v_teacher_name text;
  v_countersigner_name text;
begin
  select * into v_incident from public.incidents where id = p_incident_id;
  if not found then
    raise exception 'Incident not found, or you do not have permission to view it.';
  end if;

  if v_incident.teacher_signed_at is null then
    raise exception 'This incident has not yet been signed off by its teacher.';
  end if;

  if not public.can_countersign_incident(auth.uid(), v_incident.institution_id) then
    raise exception 'Only someone who can countersign this incident may view its countersign summary.';
  end if;

  v_staff := public.build_staff_attestations_summary(p_incident_id);

  select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name')
  into v_teacher_name
  from auth.users u
  where u.id = v_incident.teacher_signed_by;

  if v_incident.countersigned_by is not null then
    select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name')
    into v_countersigner_name
    from auth.users u
    where u.id = v_incident.countersigned_by;
  end if;

  return jsonb_build_object(
    'staff_attestations', v_staff,
    'teacher_signed_at', v_incident.teacher_signed_at,
    'teacher_signed_by_name', v_teacher_name,
    'anyone_injured', jsonb_build_object(
      'value', v_incident.anyone_injured,
      'note', case when v_incident.anyone_injured is null then 'not recorded' else null end
    ),
    'already_countersigned', v_incident.countersigned_at is not null,
    'countersigned_at', v_incident.countersigned_at,
    'countersigned_by_name', v_countersigner_name,
    'countersigned_role_at_time', v_incident.countersigned_role_at_time,
    'countersigned_via', v_incident.countersigned_via
  );
end;
$function$;

grant execute on function public.get_countersign_summary(uuid) to authenticated;

-- countersign_incident -- new. Checks not-found, not-yet-teacher-signed,
-- already-countersigned, then can_countersign_incident() -- never a role
-- check directly. Deliberately does NOT set countersigned_by/
-- role_at_time/via itself -- derive_countersign_fields() above does
-- that uniformly, so the RPC and any other path that could ever reach
-- this update stay consistent by construction.
create or replace function public.countersign_incident(p_incident_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_incident public.incidents;
begin
  select * into v_incident from public.incidents where id = p_incident_id;
  if not found then
    raise exception 'Incident not found, or you do not have permission to view it.';
  end if;

  if v_incident.teacher_signed_at is null then
    raise exception 'This incident has not yet been signed off by its teacher.';
  end if;

  if v_incident.countersigned_at is not null then
    raise exception 'This incident has already been countersigned.';
  end if;

  if not public.can_countersign_incident(auth.uid(), v_incident.institution_id) then
    raise exception 'You do not have permission to countersign this incident.';
  end if;

  update public.incidents
  set countersigned_at = now()
  where id = p_incident_id;
end;
$function$;

grant execute on function public.countersign_incident(uuid) to authenticated;

-- Notify the owning teacher when someone else adds an amendment -- the
-- record is immutable by that point, so the only way to respond is with
-- their own amendment, not an edit. Matches withdraw_attestation()'s
-- exact insert shape (notice_type, institution_id, incident_id -- no
-- recipient/body column exists on school_notices; "addressed to" is
-- resolved by whoever queries the table, same as attestation_withdrawn
-- already is). Skips the insert when the author IS the owning teacher --
-- no point notifying someone of their own action.
create or replace function public.notify_owning_teacher_of_amendment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_incident public.incidents;
begin
  select * into v_incident from public.incidents where id = new.incident_id;

  if v_incident.owning_teacher_id is not null and v_incident.owning_teacher_id <> new.author_id then
    insert into public.school_notices (notice_type, institution_id, incident_id)
    values ('incident_amendment_added', v_incident.institution_id, v_incident.id);
  end if;

  return new;
end;
$function$;

create trigger notify_owning_teacher_of_amendment
after insert on public.incident_amendments
for each row execute function public.notify_owning_teacher_of_amendment();
