/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SCHOOL INCIDENT LOG -- fixes a real bug in 0078, caught by the
   adversarial suite doing exactly its job. Not a design change.

   THE BUG: guard_institution_permissions_grantee_is_staff() and
   guard_institution_permissions_last_holder() were both plain
   `language plpgsql`, with no `security definer` -- so each ran under
   the CALLING user's own RLS view of institution_staff, not a
   privileged one. institution_staff's own SELECT policy ("Users can
   view their own staff link", migration 0009) is strictly
   `auth.uid() = user_id` -- no broader institution-wide visibility at
   all. Live proof: a real principal, granting countersign_incident to a
   real teacher on their own staff, got rejected --
   "user <teacherDP> is not a member of institution_staff at institution
   <X>" -- even though that teacher's institution_staff row plainly
   existed. The trigger's own query couldn't see it: querying as the
   PRINCIPAL, under RLS, institution_staff only ever showed the
   principal's own row, never the grantee's.

   guard_institution_permissions_last_holder() has the same defect for
   its principal-existence check, though it happened to still give the
   right answer in every reachable scenario (the caller of a real revoke
   is independently already required to BE an active principal by the
   REVOKE policy itself, so their own visible row already satisfies
   "a principal exists"; service-role calls bypass RLS regardless of
   trigger security mode). Fixed anyway, for the same reason a trigger
   exists in the first place: it should see ground truth, not a
   caller-shaped view of it, matching FORWARD DEPENDENCY discipline
   elsewhere in this module rather than relying on today's policies
   happening to align.

   THE FIX: add `security definer` + `set search_path = public` to both
   -- the same posture every other privileged function in this module
   already uses (can_countersign_incident, can_view_incident,
   get_institution_incidents), for exactly this reason: a function that
   enforces an invariant needs to see the real state, not whatever the
   caller's own RLS happens to let them see.

   guard_institution_permissions_immutable_grant() is untouched -- it
   only compares NEW/OLD on the row already being written, no
   cross-table SELECT, no RLS visibility question to get wrong. */

create or replace function public.guard_institution_permissions_grantee_is_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.institution_staff s
    where s.institution_id = new.institution_id and s.user_id = new.user_id
  ) then
    raise exception 'Cannot grant % -- user % is not a member of institution_staff at institution %.',
      new.permission, new.user_id, new.institution_id;
  end if;
  return new;
end;
$$;

create or replace function public.guard_institution_permissions_last_holder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.revoked_at is not null and old.revoked_at is null and new.permission = 'countersign_incident' then
    if not exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = new.institution_id
        and s.role = 'principal'
        and inst.status = 'verified'
    ) and not exists (
      select 1 from public.institution_permissions p2
      where p2.institution_id = new.institution_id
        and p2.permission = 'countersign_incident'
        and p2.revoked_at is null
        and p2.id <> new.id
    ) then
      raise exception 'Cannot revoke -- this is the last active countersign holder at institution %. This institution has no principal; revoking this grant would leave nobody able to countersign.',
        new.institution_id;
    end if;
  end if;
  return new;
end;
$$;
