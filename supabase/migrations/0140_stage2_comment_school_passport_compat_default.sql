-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 3, Stage 2 -- comment-only change. create_school_passport()'s
-- behavior is unchanged, byte-for-byte identical to its live 0121
-- definition; this migration exists to put a warning directly in the
-- function body, not in a comment change of its own.
--
-- Stage 2 deleted ShareBottomSheet's handleApprove() -- the client's
-- only remaining write to passport_institution_links.approved_by_parent.
-- This function is now the ONLY thing that ever sets it true, and it does
-- so unconditionally, for every school-created passport, regardless of
-- any parent action. That's correct: a school creating its own child's
-- record has no parent to seek approval from, and the flag is what keeps
-- the link visible to gates written when it meant something else (the
-- passport_access self-insert/reactivate policies, 0100; institution
-- roster visibility). Changing it here would break those gates for no
-- benefit.
--
-- What has to be said, in the function itself, not just in CLAUDE.md: on
-- every row this function produces, approved_by_parent = true is NOT a
-- consent record. No parent approved anything. It is a compatibility
-- default, kept true so this table's existing readers and RLS policies
-- keep working unchanged. Read at face value, without this comment, it
-- is a false statement sitting in the database -- exactly the kind of
-- thing that gets cited in a subject access request or a DPA review.

create or replace function public.create_school_passport(p_institution_id uuid, p_child_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_passport_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if coalesce(trim(p_child_name), '') = '' then
    raise exception 'A child name is required.';
  end if;

  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) then
    raise exception 'Only an active, verified principal can create a passport for their school.';
  end if;

  insert into public.passports (child_name, passport_status)
  values (trim(p_child_name), 'not_started')
  returning id into v_passport_id;

  -- approved_by_parent = true HERE IS A COMPATIBILITY DEFAULT, NOT A
  -- CONSENT RECORD. This is a school creating its own child's passport --
  -- there is no parent action to record, and parent_approved_at stays
  -- null for exactly that reason (see below). It is set true only so
  -- this link stays visible to policies and reads written before the
  -- school-led pivot (PRD 3) that still check this column literally --
  -- most directly passport_access's own "Teachers can insert access for
  -- approved, matching institutions" and "...reactivate their own
  -- revoked access" policies (0100). PRD 3 Stage 2 removed the client's
  -- only remaining WRITE to this column for a genuine parent-approval
  -- case (ShareBottomSheet's handleApprove()) -- this insert is now the
  -- only place approved_by_parent is ever set true anywhere in this
  -- schema, and it is never once because a parent approved something.
  -- Do not read this value as evidence of parental consent on a school-
  -- created passport; it isn't.
  insert into public.passport_institution_links (passport_id, institution_id, approved_by_parent, parent_approved_at)
  values (v_passport_id, p_institution_id, true, null);

  insert into public.enrolments (passport_id, institution_id, started_by)
  values (v_passport_id, p_institution_id, auth.uid());

  return v_passport_id;
end;
$$;

grant execute on function public.create_school_passport(uuid, text) to authenticated;
