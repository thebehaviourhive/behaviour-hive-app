/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SCHOOL INCIDENT LOG -- countersign authority, indirected through one
   function, deliberately NOT the real spec yet.

   Explicit instruction: don't build Phase 4's sign-off path against the
   principal role directly, and don't build the real institution_permissions
   grant model yet either -- put a single function in between,
   can_countersign_incident(user, institution), that for now returns
   exactly what the principal-role check already returns. The real spec
   arrives later as a change to this one function's body, not a rewrite
   of every place that currently asks "is this person allowed to
   countersign".

   Scope, deliberately narrow: this covers ONLY the countersign action --
   the "Principal can countersign after teacher sign-off" UPDATE policy
   on incidents, created in 0068. It does NOT touch can_view_incident()'s
   own principal branch (general incident visibility), get_institution_
   incidents() (the principal's list), the vocabulary-editing principal
   check on incident_locations, or the amendment/school_notices principal
   branches -- all separate authority questions the brief never asked to
   be indirected here. Widening this to those too is a real option later,
   flagged rather than assumed.

   Today's behaviour is byte-identical to what the inlined check already
   did (principal role at that institution, institution verified) -- this
   migration changes WHERE that check lives, not what it currently
   decides. */

create or replace function public.can_countersign_incident(p_user_id uuid, p_institution_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = p_user_id
      and s.role = 'principal'
      and inst.status = 'verified'
  );
$$;

grant execute on function public.can_countersign_incident(uuid, uuid) to authenticated;

-- Swap the existing countersign policy to call the function instead of
-- inlining the same check a second time -- so the real spec, whenever
-- it arrives, is a change to can_countersign_incident()'s body and
-- nothing here needs to change again.
alter policy "Principal can countersign after teacher sign-off"
  on public.incidents
  using (
    teacher_signed_at is not null
    and principal_signed_at is null
    and public.can_countersign_incident(auth.uid(), incidents.institution_id)
  )
  with check (
    principal_signed_by = auth.uid()
  );
