/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SCHOOL INCIDENT LOG -- fixes two real bugs in 0085, both found by
   testing the actual live result, not by re-reading the SQL that was
   run.

   =====================================================================
   BUG 1 -- the teacher_signed_by guard never actually applied
   =====================================================================
   0085's `alter policy "Creator or owning teacher can edit before
   teacher sign-off" ...` named a policy that migration 0069 (long
   before this session) had already dropped and replaced with a
   different name and a role check: "Owning teacher can edit before
   teacher sign-off". The ALTER POLICY statement referenced a name that
   doesn't exist in the live schema -- it errored, silently, while the
   rest of 0085 (the functions) landed fine as independent statements.
   Confirmed live: signed in as a real owning teacher, wrote
   teacher_signed_by = a different teacher's id, and it persisted with
   no error.

   Fixed here as a TRIGGER instead of another RLS policy edit -- raised
   in review, correctly: an RLS WITH CHECK clause can't see OLD, so
   "only on the transition where teacher_signed_at goes from null to
   non-null" has to either lean on some OTHER policy's own USING clause
   coincidentally already restricting it that way (fragile -- correct
   today, but not structurally guaranteed if that other policy ever
   changes), or be expressed directly with real OLD/NEW comparison,
   which only a trigger can do. This trigger cannot fire outside that
   exact transition, full stop -- it does not depend on which RLS
   policy ends up routing any given write, including the countersign
   write, which never touches teacher_signed_at at all and so never
   enters this trigger's guarded branch.

   =====================================================================
   BUG 2 -- get_incident_signoff_summary() failed outright
   =====================================================================
   "permission denied for table users", confirmed live. The function
   joins auth.users to build staff display names -- auth.users has no
   grant to the authenticated role at all (this is a Supabase-standard
   restriction, not specific to this table), and the function is plain
   (not security definer), so it ran as the calling teacher, who has no
   access to that table directly. get_institution_staff_roster() and
   get_institution_incidents() already do this same auth.users read
   under security definer -- same fix here. Its own explicit
   authorization check (creator/owning teacher only) was already
   present in 0085 and doesn't rely on RLS, so it's unaffected by, and
   remains the actual gate despite, the privilege elevation.
   incident_signoff_issues() and sign_off_incident() never touch
   auth.users and are confirmed working as plain functions -- untouched
   here.

   =====================================================================
   ON VERIFYING NAMES AGAINST THE LIVE SCHEMA
   =====================================================================
   Flagging plainly rather than claiming more than is true: this
   project has no raw-SQL introspection path available to me (no
   direct Postgres connection string in .env.local, no psql, no
   exec-SQL RPC already in this codebase) -- I cannot query pg_policies
   directly to confirm a name character-for-character before writing
   SQL that references it. What I can and did do here: avoid
   referencing any existing policy by name at all (the trigger fix
   needs no such reference), and confirm the countersign-safety
   reasoning against live behaviour (AUDIT G, before this file was
   written: a real principal countersign succeeded through whichever
   policy actually applies). If you want me to be able to verify names
   directly rather than reason from migration files or behaviour, I'd
   need either a Postgres connection string I can hold locally, or a
   narrow read-only introspection RPC -- your call, not assumed here. */


-- =====================================================================
-- 1. teacher_signed_by, correctly scoped to the exact transition.
-- =====================================================================

create or replace function public.guard_teacher_signed_by_matches_caller()
returns trigger
language plpgsql
as $$
begin
  if new.teacher_signed_at is not null
    and old.teacher_signed_at is null
    and new.teacher_signed_by is distinct from auth.uid()
  then
    raise exception 'teacher_signed_by must match the account performing the sign-off.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_teacher_signed_by_matches_caller on public.incidents;
create trigger guard_teacher_signed_by_matches_caller
  before update on public.incidents
  for each row
  execute function public.guard_teacher_signed_by_matches_caller();


-- =====================================================================
-- 2. get_incident_signoff_summary() -- security definer, so it can read
-- auth.users for staff display names, same as get_institution_staff_
-- roster()/get_institution_incidents() already do. Its own explicit
-- creator/owning-teacher check (unchanged from 0085) is the real gate.
-- =====================================================================

create or replace function public.get_incident_signoff_summary(p_incident_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
        else initcap(replace(public.get_attestation_status(st.id), '_', ' '))
      end,
      'blocks_signoff', st.user_id is not null and public.get_attestation_status(st.id) in ('stale', 'withdrawn')
    ) order by st.id), '[]'::jsonb)
  into v_staff
  from public.incident_staff st
  left join auth.users u on u.id = st.user_id
  where st.incident_id = p_incident_id;

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
$$;

grant execute on function public.get_incident_signoff_summary(uuid) to authenticated;
