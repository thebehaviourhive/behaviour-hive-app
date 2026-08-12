/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   THE CALM BUTTON, Stage 1 -- Calm Cards data model.

   fba_calm_cards is a COMPANION layer, not FBA content. fba_reports has
   no separate "locked" column -- "finalized" is purely status =
   'completed' (see migration 0040), and the clinician's own UPDATE
   policy on fba_reports requires status <> 'completed', which is what
   actually freezes content_data once finalized. Calm Cards deliberately
   sit OUTSIDE that freeze: this table's own RLS below has no such
   status <> 'completed' guard, so a clinician can keep adding, editing,
   or retiring Calm Cards on an already-completed FBA indefinitely. This
   is what makes the retro-add path (constraint 1B: adding cards to
   FBAs finalized before this feature existed) work at all -- if this
   table inherited fba_reports' own lock, retro-adding would be
   impossible by construction.

   strategy_ref: Section 12 (Recommendations) stores strategies as THREE
   separate arrays inside fba_reports.content_data -- recommendationsHome/
   recommendationsSchool/recommendationsShared (see
   src/lib/fba/types.ts's StrategyEntry[]) -- each entry has a stable
   client-generated id, but that id is NOT unique across the three
   arrays (no DB constraint enforces it, since content_data is one
   opaque jsonb blob). strategy_ref therefore stores BOTH which array and
   which entry, as "<group>:<entryId>", e.g.
   "recommendationsHome:3f2b9e1a-...". This is an application-level
   reference only -- like passport_clinical_content before it, there is
   no DB-level foreign key into a nested JSONB array element, so nothing
   here enforces that the referenced strategy still exists if a
   clinician later deletes it from Section 12. That's an acceptable gap
   consistent with how passport_clinical_content already works, not a
   regression.

   steps: JSONB array of 2-3 short imperative strings, enforced by a
   check constraint at insert/update time, not just at the UI layer.

   No "locked" concept for teachers to accidentally slip through: no
   policy is created for class_teacher at all, matching fba_reports'
   own "no policy = zero access" posture exactly. */

create table public.fba_calm_cards (
  id uuid primary key default gen_random_uuid(),
  fba_id uuid not null references public.fba_reports (id) on delete cascade,
  strategy_ref text not null,
  title text not null,
  steps jsonb not null default '[]'::jsonb
    check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 2 and 3),
  door_type text not null
    check (door_type in ('prevention', 'deescalation')),
  trigger_tags text[] not null default '{}',
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fba_calm_cards_fba_id_idx on public.fba_calm_cards (fba_id);

drop trigger if exists set_fba_calm_cards_updated_at on public.fba_calm_cards;
create trigger set_fba_calm_cards_updated_at
  before update on public.fba_calm_cards
  for each row
  execute function public.set_updated_at();

alter table public.fba_calm_cards enable row level security;

-- ============================================================
-- Clinician: full CRUD on cards belonging to their OWN FBAs. Same
-- active + verified clinician_access check fba_reports itself uses,
-- reached via a join since this table has no clinician_id column of
-- its own -- DELIBERATELY WITHOUT fba_reports' "status <> 'completed'"
-- guard (see header comment: that's the whole point of this table).
-- ============================================================

create policy "Clinicians can view their own calm cards"
  on public.fba_calm_cards
  for select
  to authenticated
  using (
    exists (
      select 1 from public.fba_reports fr
      where fr.id = fba_calm_cards.fba_id
        and fr.clinician_id = auth.uid()
        and public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = fr.passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
    )
  );

create policy "Clinicians can create calm cards on their own FBAs"
  on public.fba_calm_cards
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.fba_reports fr
      where fr.id = fba_calm_cards.fba_id
        and fr.clinician_id = auth.uid()
        and public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = fr.passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
    )
  );

create policy "Clinicians can update their own calm cards"
  on public.fba_calm_cards
  for update
  to authenticated
  using (
    exists (
      select 1 from public.fba_reports fr
      where fr.id = fba_calm_cards.fba_id
        and fr.clinician_id = auth.uid()
        and public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = fr.passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
    )
  )
  with check (
    exists (
      select 1 from public.fba_reports fr
      where fr.id = fba_calm_cards.fba_id
        and fr.clinician_id = auth.uid()
        and public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = fr.passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
    )
  );

create policy "Clinicians can delete their own calm cards"
  on public.fba_calm_cards
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.fba_reports fr
      where fr.id = fba_calm_cards.fba_id
        and fr.clinician_id = auth.uid()
        and public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = fr.passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
    )
  );

-- ============================================================
-- Parent: SELECT only, only once the FBA is finalized (status =
-- 'completed' -- there is no separate "locked" column) AND the card
-- itself is published. An unpublished card on an otherwise-completed
-- FBA stays invisible.
-- ============================================================

create policy "Parents can view published calm cards on completed FBAs"
  on public.fba_calm_cards
  for select
  to authenticated
  using (
    is_published = true
    and exists (
      select 1 from public.fba_reports fr
      where fr.id = fba_calm_cards.fba_id
        and fr.status = 'completed'
        and public.owns_passport(fr.passport_id)
    )
  );

-- No policy at all for class_teacher -- zero access, by omission,
-- matching fba_reports' own posture exactly.

-- ============================================================
-- Parent-facing read helper: "get my child's published calm cards".
-- Returns cards + door/tags only -- never FBA content, never anything
-- from content_data. This is also the single source of truth for
-- whether the Calm button is "live" for a given passport (Stage 2):
-- zero rows = locked state, any rows = live.
-- ============================================================

create or replace function public.get_my_child_calm_cards(p_passport_id uuid)
returns table (
  id uuid,
  title text,
  steps jsonb,
  door_type text,
  trigger_tags text[]
)
language sql
security definer
set search_path = public
stable
as $$
  select c.id, c.title, c.steps, c.door_type, c.trigger_tags
  from public.fba_calm_cards c
  join public.fba_reports fr on fr.id = c.fba_id
  where fr.passport_id = p_passport_id
    and fr.status = 'completed'
    and c.is_published = true
    and public.owns_passport(p_passport_id)
  order by c.door_type, c.created_at asc;
$$;

grant execute on function public.get_my_child_calm_cards(uuid) to authenticated;
