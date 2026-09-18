-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Supersedes 0242 outright -- that migration's own run failed on its
-- very first attempt and rolled back completely (confirmed directly:
-- zero clinical_artefact_types rows, no clinical_plans table, neither
-- function exists), so there is no partial state here to reconcile
-- against; this is the same build, corrected, run from scratch.
--
-- TWO THINGS WRONG WITH 0242, BOTH FIXED HERE:
--
-- 1. A REAL ORDERING BUG, CAUGHT BY POSTGRES ITSELF ON THE FIRST RUN,
-- NOT BY REVIEW. clinical_plans' own RLS policies (this file's own
-- part 3) call _clinical_plan_is_school_visible() -- but 0242 defined
-- that function AFTER the table and its policies, not before. Unlike a
-- plpgsql function body (which Postgres only resolves at CALL time), a
-- CREATE POLICY statement's USING clause is parsed and its function
-- references resolved IMMEDIATELY, at policy-creation time -- "function
-- ... does not exist" was thrown the instant the second policy tried to
-- reference a function that genuinely didn't exist yet in the same
-- script. Fixed by moving the helper function and the read RPC (this
-- file's own part 2) to BEFORE clinical_plans and its policies (part
-- 3) -- the exact ordering FBA/BSP's own migrations already get right
-- (a table's own dependent helpers always precede the policies that
-- call them), just missed here.
--
-- 2. "STATUTORY" WAS A FALSE LEGAL CLAIM, CAUGHT BY DANIEL DIRECTLY,
-- NOT ASSUMED CORRECT FROM THE FIRST DRAFT'S OWN NAMING. IEPs have
-- never been statutory in Ireland -- the EPSEN Act's own IEP provisions
-- were never commenced. What DES inspectors actually look for is the
-- STUDENT SUPPORT FILE under the NEPS Continuum of Support (Guidelines
-- for Primary Schools, Circular 002/2024), and the document within it
-- is the STUDENT SUPPORT PLAN, at three tiers -- Classroom Support,
-- School Support, School Support Plus. "IEP" survives only as informal
-- shorthand at the top tier. 0242's own artefact_type/plan_type key
-- (statutory_plan) and its "statutory (IEP and equivalents)" framing
-- were both a real, false claim -- a column value and a comment that
-- would read, to anyone inspecting this schema later, as "this document
-- is a legally mandated instrument," which is not true. Renamed
-- throughout: statutory_plan -> student_support_plan. Fixed at the KEY,
-- not just client-facing copy, because the key is what a future reader
-- of the SCHEMA sees, and a wrong key is a wrong claim that propagates
-- every time it's read, copied, or extended.
--
-- THE PPP -- RECORDED, NOT BUILT, NOT A SIXTH TYPE. The Pupil Personal
-- Plan is a real Irish document for pupils with SNA access -- genuinely
-- relevant given the trial school is a special school with four SNAs.
-- It may be what student_support_plan/care_plan already cover, or it
-- may want its own type; not decided here. Ask Catherine whether her
-- clinic sees PPPs at all before adding a sixth clinical_artefact_types
-- row for it -- recorded as an open question, not resolved by guessing
-- either way.

-- ===========================================================================
-- 1. clinical_artefact_types -- widen for five new Silo-2 members, all
-- silo = 'framework' (a living, updatable document, same category BSP
-- already established), all default_school_visibility = 'shareable' --
-- Daniel's own framing: "these default shareable, unlike diagnostic
-- assessments", matching the SAME confirmed type default BSP's own row
-- already carries (Stage 3's recon named "BSP and plans shareable"
-- together, as one decision -- this is the "and plans" half, finally
-- attached to real rows).
--
-- default_domain_tags: a first, reasonable clinical classification per
-- type, not a clinically-authored vocabulary -- flagged for Catherine's
-- review, same posture Stage 3 already took for assessment_instruments'
-- own seeded values. sensory_diet_plan -> sensory_motor and aac_plan ->
-- communication both map cleanly. student_support_plan -> statutory_
-- education -- that DOMAIN enum value (a practice AREA -- "this touches
-- special-educational-needs/DES-process work") is a different, softer
-- claim than "this specific document IS a statutory instrument", and
-- stays accurate even though the document's own name changed; not
-- touched by this correction. crisis_plan and care_plan are left '{}'
-- (genuinely unclassifiable -- a crisis plan can span behaviour
-- analysis, sensory, and communication all at once; a care plan is
-- often medical, outside all six domains) -- empty means open to any
-- domain-matched colleague, the same safe fallback Stage 3 already
-- established for a practitioner who hasn't declared their own domains
-- yet, not a broken or forgotten value.
-- ===========================================================================

alter table public.clinical_artefact_types
  drop constraint if exists clinical_artefact_types_artefact_type_check;
alter table public.clinical_artefact_types
  add constraint clinical_artefact_types_artefact_type_check
    check (artefact_type in (
      'fba_report', 'session_note', 'bsp',
      'crisis_plan', 'sensory_diet_plan', 'aac_plan', 'care_plan', 'student_support_plan'
    ));

-- CRISIS MANAGEMENT -- PRD 7 section 16's own open question, recorded
-- against this type specifically, not solved here: where does the
-- worst-case plan live, and how does a cover SNA find it on a phone in
-- three seconds? A row holding a name, a date, a free-text body and an
-- attachment does not answer that -- there is no fast-path surface
-- here, no "break glass" affordance, nothing that privileges crisis_
-- plan over the other four at read time; it sits behind the same
-- Clinical Team tab and the same generic list every other plan type
-- does. Whoever builds crisis_plan's own structured, built-in-full
-- form should start from the real requirement above (the three-second
-- phone lookup), not from this placeholder's own generic shape, which
-- was never designed to answer it.
--
-- THE PPP QUESTION -- see this migration's own header. Recorded here,
-- against care_plan specifically, since that is the more likely of the
-- two existing types to already cover it: does a Pupil Personal Plan
-- belong under care_plan, or does it need its own clinical_artefact_
-- types row? Ask Catherine before deciding either way.
insert into public.clinical_artefact_types (artefact_type, silo, default_domain_tags, default_school_visibility) values
  ('crisis_plan', 'framework', '{}'::public.clinical_domain[], 'shareable'),
  ('sensory_diet_plan', 'framework', array['sensory_motor']::public.clinical_domain[], 'shareable'),
  ('aac_plan', 'framework', array['communication']::public.clinical_domain[], 'shareable'),
  ('care_plan', 'framework', '{}'::public.clinical_domain[], 'shareable'),
  ('student_support_plan', 'framework', array['statutory_education']::public.clinical_domain[], 'shareable')
on conflict (artefact_type) do nothing;

-- ===========================================================================
-- 2. The school-visibility helper AND the read RPC -- moved ahead of
-- clinical_plans itself (part 3), which is the actual ordering fix.
-- The helper folds override-then-type-default into one place; the RPC
-- exists (rather than a raw client select) purely to join author_name
-- from auth.users, the same reason get_passport_clinical_content() is
-- an RPC and not a bare select -- neither a teacher, a principal, nor a
-- parent can read another user's own auth.users row directly.
-- ===========================================================================

create or replace function public._clinical_plan_is_school_visible(
  p_plan_type text,
  p_school_visibility_override text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    p_school_visibility_override,
    (select cat.default_school_visibility from public.clinical_artefact_types cat where cat.artefact_type = p_plan_type)
  ) = 'shareable';
$$;

grant execute on function public._clinical_plan_is_school_visible(text, text) to authenticated;

create or replace function public.get_clinical_plans_for_passport(p_passport_id uuid)
returns table (
  id uuid,
  plan_type text,
  name text,
  plan_date date,
  body text,
  author_name text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    cp.id, cp.plan_type, cp.name, cp.plan_date, cp.body,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
    cp.created_at
  from public.clinical_plans cp
  join auth.users u on u.id = cp.clinician_id
  where cp.passport_id = p_passport_id
    and public._clinical_plan_is_school_visible(cp.plan_type, cp.school_visibility_override)
    and (
      public.has_child_access(auth.uid(), p_passport_id)
      or exists (
        select 1 from public.institution_staff s
        join public.passport_institution_links pil on pil.institution_id = s.institution_id
        where pil.passport_id = p_passport_id
          and s.user_id = auth.uid()
          and s.role = 'principal'
          and s.deactivated_at is null
          and s.approved_at is not null
      )
    )
  order by cp.plan_date desc;
$$;

grant execute on function public.get_clinical_plans_for_passport(uuid) to authenticated;

-- ===========================================================================
-- 3. clinical_plans -- the one generic table backing all five types,
-- plan_type the discriminator. Same "name + date + free-text body +
-- attachment" shape for every type -- nothing here varies per plan_type
-- beyond the clinical_artefact_types row it resolves against for
-- domain/visibility defaults.
--
-- plan_type carries BOTH a real FK into clinical_artefact_types (so a
-- typo or a stale value is a database error, not a silent orphan) AND
-- its own narrower CHECK -- clinical_artefact_types also legally
-- contains 'fba_report'/'session_note'/'bsp', which the FK alone would
-- not stop this table from accepting; the CHECK is what actually keeps
-- plan_type scoped to the five real Silo-2 placeholder values.
--
-- No auto-seeding of domain_tags from the type's own default at insert
-- time -- deliberately, unlike BSP's own _bsp_default_domain_tags().
-- BSP could use a plain column DEFAULT because its own artefact_type
-- key ('bsp') is a single constant; this table's own key (plan_type)
-- varies per row, and a column DEFAULT cannot see a sibling column's
-- value in the same INSERT -- only a BEFORE INSERT trigger could, and
-- that felt like more machinery than a placeholder stage needs.
-- domain_tags simply defaults to '{}' (open to any domain-matched
-- colleague, the same safe fallback named above) -- the client may
-- still prefill it from clinical_artefact_types.default_domain_tags at
-- creation time as a plain read, it just isn't server-guaranteed here.
-- ===========================================================================

create table public.clinical_plans (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  clinician_id uuid not null references auth.users (id) on delete cascade,
  plan_type text not null references public.clinical_artefact_types (artefact_type)
    check (plan_type in ('crisis_plan', 'sensory_diet_plan', 'aac_plan', 'care_plan', 'student_support_plan')),
  name text not null,
  plan_date date not null default current_date,
  body text,
  domain_tags public.clinical_domain[] not null default '{}',
  school_visibility_override text check (school_visibility_override in ('clinic_only', 'shareable')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.clinical_plans is
  'Silo 2 placeholders: crisis management, sensory diet, AAC/communication, care plans, student support plans (the NEPS Continuum of Support''s Classroom/School/School Plus tiers -- "IEP" survives only as informal shorthand at the top tier and is never used as the schema key, since these documents are not statutory in Ireland). Deliberately does NOT lock -- the attachment (when one exists) is the authoritative, already-immutable artefact; this row is metadata about it (a name, a date, a free-text summary), and locking a pointer to an immutable file is theatre. WHEN any one of these five graduates to a built-in-full structured form (own fields, own editor, no longer just a name+attachment pointer), it inherits bsp''s own lifecycle: draft, locked on sign, revision as a new row, never an edit. This comment is why that lock does not exist YET on this table -- not an oversight to fix quietly later.';

create index clinical_plans_passport_id_idx on public.clinical_plans (passport_id);
create index clinical_plans_clinician_id_idx on public.clinical_plans (clinician_id);

create trigger clinical_plans_touch_updated_at
  before update on public.clinical_plans
  for each row
  execute function public.set_updated_at();

alter table public.clinical_plans enable row level security;

-- Same colleague-read composition assessments/fba_reports/bsp already
-- have -- direct reuse of _caller_has_live_clinician_access() and
-- _clinical_colleague_domain_match(), both fully generic already, no
-- change needed to either. No director-always branch -- matching bsp's
-- own SELECT policy exactly, the closest real precedent (Silo 2,
-- built this same session), not assessments'/session_notes' own
-- director branch, which those two tables have for reasons specific to
-- them.
create policy "Clinicians read their own plans, or a domain-matched colleague's"
  on public.clinical_plans for select to authenticated
  using (
    (clinician_id = auth.uid() and public._caller_has_live_clinician_access(passport_id))
    or public._clinical_colleague_domain_match(clinician_id, passport_id, domain_tags)
  );

-- The school-facing branch, requirement 2's own read half. Gated on
-- has_child_access() (the same primitive passport_clinical_content's
-- own teacher/SNA branch uses) AND the resolved school-visibility
-- value, via the helper defined in part 2 above -- this policy (and
-- the principal branch, and the RPC) never re-derive that logic three
-- separate ways.
create policy "School staff with active access can view shareable plans"
  on public.clinical_plans for select to authenticated
  using (
    public.has_child_access(auth.uid(), passport_id)
    and public._clinical_plan_is_school_visible(plan_type, school_visibility_override)
  );

create policy "A linked institution's principal can view shareable plans"
  on public.clinical_plans for select to authenticated
  using (
    public._clinical_plan_is_school_visible(plan_type, school_visibility_override)
    and exists (
      select 1 from public.institution_staff s
      join public.passport_institution_links pil on pil.institution_id = s.institution_id
      where pil.passport_id = clinical_plans.passport_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and s.deactivated_at is null
        and s.approved_at is not null
    )
  );

create policy "Clinicians can create plans for their own caseload"
  on public.clinical_plans for insert to authenticated
  with check (
    clinician_id = auth.uid()
    and public.is_verified_clinician(auth.uid())
    and public._caller_has_live_clinician_access(passport_id)
  );

-- No "while draft" restriction -- there is no draft/locked state to
-- protect. The author may edit indefinitely; ownership is permanent,
-- matching session_notes' own "an author corrects their own record
-- regardless of current access" reasoning, not bsp's own draft-gated
-- shape (bsp gates on status because it HAS a lock; this table never
-- does).
create policy "The plan's own author can edit it -- no lock, ever"
  on public.clinical_plans for update to authenticated
  using (clinician_id = auth.uid())
  with check (clinician_id = auth.uid());

-- No DELETE policy -- matching bsp/assessments/fba_reports, none of
-- which have one either. Not decided here to add one now.

-- ===========================================================================
-- 4. The attachments bridge (0232), inherited wholesale, one new arm.
-- Deliberately NO school branch in either helper -- see this
-- migration's own header for why that is what makes requirement 2's
-- split structurally guaranteed rather than merely intended.
-- ===========================================================================

alter table public.attachments
  drop constraint if exists attachments_artefact_type_check;
alter table public.attachments
  add constraint attachments_artefact_type_check
    check (artefact_type in ('assessment', 'clinical_plan'));

create or replace function public._caller_owns_artefact(p_artefact_type text, p_artefact_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case p_artefact_type
    when 'assessment' then exists (
      select 1 from public.assessments a
      where a.id = p_artefact_id
        and a.clinician_id = auth.uid()
    )
    when 'clinical_plan' then exists (
      select 1 from public.clinical_plans cp
      where cp.id = p_artefact_id
        and cp.clinician_id = auth.uid()
    )
    else false
  end;
$$;

-- clinical_plans never locks -- the author may add or remove an
-- attachment at any time, matching the base table's own UPDATE policy
-- (no completion-state gate at all). The 'assessment' arm keeps its own
-- completed_at check exactly as it was; this is a genuinely different
-- rule for a genuinely different table, not a relaxation of the
-- existing one.
create or replace function public._caller_can_modify_artefact_attachments(p_artefact_type text, p_artefact_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case p_artefact_type
    when 'assessment' then exists (
      select 1 from public.assessments a
      where a.id = p_artefact_id
        and a.clinician_id = auth.uid()
        and a.completed_at is null
    )
    when 'clinical_plan' then exists (
      select 1 from public.clinical_plans cp
      where cp.id = p_artefact_id
        and cp.clinician_id = auth.uid()
    )
    else false
  end;
$$;

alter policy "Clinicians can record an attachment on their own uncompleted assessment"
  on public.attachments
  with check (
    uploaded_by = auth.uid()
    and artefact_type in ('assessment', 'clinical_plan')
    and public._caller_can_modify_artefact_attachments(artefact_type, artefact_id)
  );

-- storage.objects' own three policies (0232) already dispatch entirely
-- through the two helpers above via the path's own first segment
-- ((storage.foldername(name))[1]) -- none of them hardcode 'assessment'
-- anywhere, so none of them need touching for this new arm to work.
