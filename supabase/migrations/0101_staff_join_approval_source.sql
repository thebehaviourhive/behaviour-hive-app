-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Adds approval_source, distinguishing HOW an institution_staff row came
-- to be approved -- 'grandfathered' (existed before 0100), 'bootstrap'
-- (auto-approved, no active principal existed at insert), 'principal' (a
-- real human approved it). approved_by alone can't distinguish
-- grandfathered from bootstrap: both are null, and both have
-- approved_at = created_at (Postgres's now() is transaction-stable, so
-- the trigger's now() and created_at's own default now() are the same
-- value within one INSERT -- confirmed, not assumed).
--
-- BACKFILL LABEL, CHECKED LIVE BEFORE WRITING THIS, NOT ASSUMED:
-- queried every row with approved_at is not null and approved_by is null
-- (the exact population this backfill touches) immediately before writing
-- this migration. 10 rows, latest created_at 2026-08-27T18:39:03Z, all
-- three belonging to the ZZFIXTURE thumb-test institution -- built and
-- populated well before this migration existed. No row in the result
-- postdates 0100's own deployment. Zero rows are ambiguous, so the
-- backfill below is unconditional and truthful: every row it touches is
-- genuinely grandfathered, not a guess. If that stops being true by the
-- time this actually runs (new bootstrap approvals landed in the gap
-- between writing and running this file), re-run the same check --
-- select id, created_at, approved_at, approved_by from institution_staff
-- where approved_at is not null and approved_by is null order by
-- created_at -- and treat any row created after this file was written as
-- suspect before trusting this backfill again.

alter table public.institution_staff
  add column approval_source text
  check (approval_source is null or approval_source in ('grandfathered', 'bootstrap', 'principal'));

-- Backfill BEFORE the paired constraint below -- a check constraint is
-- validated against every existing row the moment it's added, and every
-- already-approved row still has a null approval_source until this runs.
-- Reversing this order is exactly what failed on the first attempt.
update public.institution_staff
set approval_source = 'grandfathered'
where approved_at is not null and approval_source is null;

-- Self-sufficient on purpose: doesn't lean on
-- institution_staff_not_approved_and_rejected continuing to exist
-- elsewhere to keep a rejected row from also carrying an approval_source.
alter table public.institution_staff
  add constraint institution_staff_approval_source_paired_check
  check (
    (approval_source is null and approved_at is null)
    or (approval_source is not null and approved_at is not null and rejected_at is null)
  );

create or replace function public.derive_staff_join_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'principal' and not exists (
    select 1 from public.institution_staff s
    where s.institution_id = new.institution_id
      and s.role = 'principal'
      and s.approved_at is not null
      and s.deactivated_at is null
      and s.rejected_at is null
  ) then
    new.approved_at := now();
    new.approval_source := 'bootstrap';
    -- approved_by stays null -- see header note on 0100.
  end if;
  return new;
end;
$$;

create or replace function public.approve_staff_join(p_institution_staff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.institution_staff;
  v_caller_is_active_principal boolean;
begin
  select * into v_target from public.institution_staff where id = p_institution_staff_id;

  if not found then
    raise exception 'Staff join request not found.';
  end if;

  if v_target.approved_at is not null then
    raise exception 'This request has already been approved.';
  end if;

  if v_target.rejected_at is not null then
    raise exception 'This request has already been rejected.';
  end if;

  select exists (
    select 1
    from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.user_id = auth.uid()
      and s.institution_id = v_target.institution_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) into v_caller_is_active_principal;

  if not v_caller_is_active_principal then
    raise exception 'Only an active principal at this institution can approve staff here.';
  end if;

  update public.institution_staff
  set approved_at = now(), approved_by = auth.uid(), approval_source = 'principal'
  where id = p_institution_staff_id;

  return jsonb_build_object('approved', true);
end;
$$;
