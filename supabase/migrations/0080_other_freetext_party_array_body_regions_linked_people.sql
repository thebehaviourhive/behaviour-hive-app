/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SCHOOL INCIDENT LOG -- post-thumb-test fixes, Part 2 (schema). Five
   independent changes, each explained in its own section below. Every
   trigger function here is SECURITY DEFINER + set search_path = public
   on purpose -- 0079 (this same module, days ago) proved that a trigger
   doing a cross-table EXISTS check without it runs under the CALLING
   user's own restricted RLS view, not ground truth, and silently gives
   the wrong answer for exactly the kind of "does this other row really
   exist" check every trigger below performs. Not repeating that.

   Revised once already, against four points of your own review:

   1. incidents.location_other -- kept, as you confirmed.
   2. No "Other" added to the three CPI vocabularies -- confirmed left
      alone. Trained-technique taxonomies, not free lists; a missing
      hold is a vocabulary edit, not a free-text box.
   3. party's check constraint used `<@`, which alone permits an empty
      array -- {} would have passed a required field. Fixed: added
      `array_length(party, 1) >= 1` alongside the containment check.
   4. incident_body_marks.note was going to double as the mark's
      "Other, please specify" text -- ambiguous, would mean two things
      under one name. Given its own column instead: other_detail,
      matching incident_actions.other_detail's naming. `note` itself is
      untouched, still unused, still means nothing yet.
   5. region_id/side were going to be nullable "for now" -- correctly
      called out as the kind of thing that never gets tightened. All 15
      incident_body_marks rows currently in the database were traced
      back to their institution before writing this and confirmed: all
      15, across 4 incidents, belong to ZZFIXTURE_THUMBTEST -- fixture
      and thumb-test data only, nothing real. Deleted below, and both
      columns are NOT NULL from the start. (Traced again, moments before
      this SQL was written -- if a real mark was created in the gap
      between that check and this running, it would be deleted too;
      flagging the timing rather than assuming it away.)

   =====================================================================
   1. "OTHER" NEEDS A FREE-TEXT VALUE, AUDITED
   =====================================================================
   Every seeded vocabulary in this module, and whether it currently has
   an "Other" option and a place to say what it was:

     incident_action_types    -- HAS "Other" (seeded, sort_order 210).
                                  incident_actions has NO free-text
                                  column at all today. Fixed below:
                                  incident_actions.other_detail.
     incident_recovery_types  -- HAS "Other" (seeded, sort_order 90).
                                  incident_children.recovery_methods is
                                  a bare text[], no companion. Fixed:
                                  incident_children.recovery_methods_other.
     incident_injury_types    -- HAS "Other" (seeded, sort_order 70).
                                  Used two places: incident_injuries.
                                  injury_types (text[], no companion --
                                  but Part 5 of the brief removes this
                                  field from the person-selection step
                                  entirely, so no companion column is
                                  added for it; see section 4 below) and
                                  incident_body_marks.injury_type_id (a
                                  single FK per mark) -- fixed with its
                                  own other_detail column, see point 4
                                  above.
     incident_locations       -- HAS "Other" (seeded, sort_order 80).
                                  Confirmed wanted: incidents.location_other.
     cpi_reason_types,
     cpi_disengagement_types,
     cpi_result_types         -- Confirmed: no "Other" today, none
                                  added. Trained-technique taxonomies.
     treatments (Part 7, new) -- incident_injuries.treatment_other
                                  ALREADY EXISTS in the schema (added in
                                  the original 0068 build, never wired
                                  to any UI). No new column needed --
                                  Part 7 just has to render it.
     party                    -- did not have "Other" until now; added
                                  as part of section 2 below, with its
                                  own incidents.party_other.

   =====================================================================
   2. PARTY BECOMES MULTI-SELECT, WITH OTHER
   =====================================================================
   incidents.party was `text check (party in ('self','peer','staff'))`.
   Converted to `text[]`, existing single values wrapped into a
   one-element array (NULL stays NULL, not {NULL} -- array[NULL::text]
   would otherwise produce a one-element array containing a null, which
   is a different, wrong thing). 'other' added to the allowed set, plus
   party_other for the free text. Two conditions now, not one: every
   element must be in the allowed set (<@), AND the array must be
   non-empty when not null (array_length(party, 1) >= 1) -- party is
   required on the form, so an empty selection must not silently pass
   as "answered."

   =====================================================================
   3. BODY MAP REGIONS -- A NEW SEEDED VOCABULARY, THE REGION IS THE FACT
   =====================================================================
   incident_body_regions: the ten regions, seeded to match
   regions.json EXACTLY -- head, chest, stomach, upper_arm, lower_arm,
   hand, upper_back, lower_back, upper_leg, lower_leg. These are stored
   as the raw slug (snake_case), not a human label like every other
   vocab table in this module (e.g. "Cut", "Gently blocked further
   attempts") -- a deliberate exception: the client reads a path's
   data-region attribute directly off the SVG and must match it to a
   row with zero translation in between, because a translation step is
   exactly where the original x/y mapping bug lived. Display formatting
   ("Upper arm" instead of upper_arm) is a client-side concern, not a
   schema one. institution_id kept nullable for shape-consistency with
   every other vocab table, seeded as global rows only, SELECT policy
   only -- this list isn't school-configurable like locations or CPI
   codes, so no principal-edit policy is added. Say if a school should
   be able to add its own regions; not assumed here.

   incident_body_marks gains region_id (FK, NOT NULL) and side (NOT
   NULL, 'left'/'right'/'centre' -- matching the SVG's own data-side
   values literally, including 'centre' for the five regions that have
   one: head, chest, stomach, upper_back, lower_back). The brief says
   read data-side, don't re-derive it -- storing exactly what the DOM
   already resolved, including 'centre', is the same principle applied
   to the schema: no extra translation layer to get wrong a second time.
   x/y are unchanged -- they still render the marker; region_id is the
   fact that gets recorded and printed.

   All 15 existing incident_body_marks rows are deleted first (see the
   note above the header) so these NOT NULL constraints can be added
   immediately, correctly, the first time.

   =====================================================================
   4. INJURED PARTY MUST BE SOMEONE NAMED ON THIS INCIDENT
   =====================================================================
   incident_injuries.passport_id and .staff_user_id are unchanged in
   shape (still nullable FKs to passports/auth.users) -- changing what
   passport_id POINTS TO would break get_parent_incidents(), which
   matches a parent's own passport_id against this column directly.
   Instead, a trigger enforces the real constraint: whenever set,
   passport_id must belong to one of THIS incident's incident_children
   rows, and staff_user_id must belong to one of THIS incident's
   incident_staff rows. free_text_name is untouched and stays a genuine
   fallback with no such check -- per the brief, only for someone with
   no account who was never named at the stamp.

   As flagged in section 1: incident_injuries.injury_types (the
   person-level "what type of injury" multi-select) is not touched by
   this migration -- the brief removes it from the UI in Part 5 (type
   belongs to the mark, not the person), so it is left as an unused,
   readable column, matching the same "keep it, stop writing it" posture
   applied to staff_initials below. No schema change needed for that.

   =====================================================================
   5. CPI STAFF BECOME LINKED PEOPLE, MANY-TO-MANY, REAL ACCOUNTS ONLY
   =====================================================================
   New table restrictive_practice_staff: restrictive_practice_id x
   incident_staff_id, many-to-many. A trigger enforces both halves of
   "these are people with accounts, on this incident": the linked
   incident_staff row must belong to the SAME incident as the
   restrictive_practices row, and must have a real user_id -- a
   free-text-only incident_staff entry (someone with no account) cannot
   be linked here at all, no fallback, per the brief.

   restrictive_practices.staff_initials is UNTOUCHED -- stays exactly as
   it is, nothing dropped, nothing renamed. The client stops writing to
   it in the Part 4 build; this migration doesn't enforce that (it can't
   -- the column has no way to know intent), it just leaves the column
   alone so no existing value is lost. Checked live: staff_initials is
   non-null on 2 of the 2 restrictive_practices rows that currently
   exist in production -- "TT" (the ZZFIXTURE_THUMBTEST fixture) and
   "Dc, el" (your own thumb-test entry, same institution, a second
   incident you created while testing). Both preserved, untouched. */


-- =====================================================================
-- 1. "Other" free-text companions.
-- =====================================================================

alter table public.incident_actions add column other_detail text;
alter table public.incident_children add column recovery_methods_other text;
alter table public.incidents add column location_other text;


-- =====================================================================
-- 2. party -> text[], with 'other' + party_other. Non-empty required.
-- =====================================================================

alter table public.incidents drop constraint if exists incidents_party_check;

alter table public.incidents
  alter column party type text[]
  using (case when party is null then null else array[party] end);

alter table public.incidents
  add constraint incidents_party_check
  check (
    party is null
    or (party <@ array['self', 'peer', 'staff', 'other']::text[] and array_length(party, 1) >= 1)
  );

alter table public.incidents add column party_other text;


-- =====================================================================
-- 3. Body map regions. Existing marks cleared first (all 15 confirmed
-- fixture/thumb-test data, none real -- see the note above the header).
-- =====================================================================

delete from public.incident_body_marks;

create table public.incident_body_regions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions (id) on delete cascade,
  value text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Matches regions.json's own `region` values exactly -- snake_case
-- slugs, not human labels. See section 3 above for why.
insert into public.incident_body_regions (value, sort_order) values
  ('head', 10),
  ('chest', 20),
  ('stomach', 30),
  ('upper_arm', 40),
  ('lower_arm', 50),
  ('hand', 60),
  ('upper_back', 70),
  ('lower_back', 80),
  ('upper_leg', 90),
  ('lower_leg', 100);

alter table public.incident_body_regions enable row level security;

create policy "Vocabulary is readable by global default or own institution"
  on public.incident_body_regions for select to authenticated
  using (institution_id is null or exists (
    select 1 from public.institution_staff s
    where s.institution_id = incident_body_regions.institution_id and s.user_id = auth.uid()
  ));

alter table public.incident_body_marks
  add column region_id uuid not null references public.incident_body_regions (id);
alter table public.incident_body_marks
  add column side text not null check (side in ('left', 'right', 'centre'));
alter table public.incident_body_marks
  add column other_detail text;


-- =====================================================================
-- 4. Injured party must be named on this incident.
-- =====================================================================

create or replace function public.guard_incident_injuries_named_party()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.passport_id is not null then
    if not exists (
      select 1 from public.incident_children ic
      where ic.incident_id = new.incident_id and ic.passport_id = new.passport_id
    ) then
      raise exception 'The injured child must be one of the children already named on this incident.';
    end if;
  end if;

  if new.staff_user_id is not null then
    if not exists (
      select 1 from public.incident_staff st
      where st.incident_id = new.incident_id and st.user_id = new.staff_user_id
    ) then
      raise exception 'The injured staff member must be one of the staff already named on this incident.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_incident_injuries_named_party on public.incident_injuries;
create trigger guard_incident_injuries_named_party
  before insert or update on public.incident_injuries
  for each row
  execute function public.guard_incident_injuries_named_party();


-- =====================================================================
-- 5. CPI staff -- linked people, many-to-many, real accounts only.
-- =====================================================================

create table public.restrictive_practice_staff (
  id uuid primary key default gen_random_uuid(),
  restrictive_practice_id uuid not null references public.restrictive_practices (id) on delete cascade,
  incident_staff_id uuid not null references public.incident_staff (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (restrictive_practice_id, incident_staff_id)
);

create index restrictive_practice_staff_rp_idx on public.restrictive_practice_staff (restrictive_practice_id);
create index restrictive_practice_staff_staff_idx on public.restrictive_practice_staff (incident_staff_id);

alter table public.restrictive_practice_staff enable row level security;

create policy "Restrictive practice staff link visibility follows the parent incident"
  on public.restrictive_practice_staff for select to authenticated
  using (
    exists (
      select 1 from public.restrictive_practices rp
      where rp.id = restrictive_practice_staff.restrictive_practice_id
        and public.can_view_incident(rp.incident_id)
    )
  );

create policy "Creator or owning teacher can link staff to restrictive practice before sign-off"
  on public.restrictive_practice_staff for insert to authenticated
  with check (
    exists (
      select 1 from public.restrictive_practices rp
      join public.incidents i on i.id = rp.incident_id
      where rp.id = restrictive_practice_staff.restrictive_practice_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  );

create policy "Creator or owning teacher can unlink staff from restrictive practice before sign-off"
  on public.restrictive_practice_staff for delete to authenticated
  using (
    exists (
      select 1 from public.restrictive_practices rp
      join public.incidents i on i.id = rp.incident_id
      where rp.id = restrictive_practice_staff.restrictive_practice_id
        and i.teacher_signed_at is null
        and (i.created_by = auth.uid() or i.owning_teacher_id = auth.uid())
    )
  );

-- No delete-then-relink race matters here; only a straight linked/
-- unlinked toggle per staff member, matching the checkbox-style UI this
-- will be. No UPDATE policy -- a link either exists or it doesn't.

create or replace function public.guard_restrictive_practice_staff_real_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rp_incident_id uuid;
  v_staff_incident_id uuid;
  v_staff_user_id uuid;
begin
  select incident_id into v_rp_incident_id
  from public.restrictive_practices where id = new.restrictive_practice_id;

  select incident_id, user_id into v_staff_incident_id, v_staff_user_id
  from public.incident_staff where id = new.incident_staff_id;

  if v_staff_incident_id is distinct from v_rp_incident_id then
    raise exception 'This staff member is not named on the same incident as this restrictive practice record.';
  end if;

  if v_staff_user_id is null then
    raise exception 'Cannot link a free-text-only staff entry to a restrictive practice record -- only staff with a real account can be linked here.';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_restrictive_practice_staff_real_account on public.restrictive_practice_staff;
create trigger guard_restrictive_practice_staff_real_account
  before insert on public.restrictive_practice_staff
  for each row
  execute function public.guard_restrictive_practice_staff_real_account();
