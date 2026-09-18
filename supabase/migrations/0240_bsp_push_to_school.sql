-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 7 -- pushing a signed BSP's school/shared strategies into the
-- classroom. The claim was proven before building anything: passport_
-- clinical_content, get_passport_clinical_content(), EodWizardForChild's
-- own client-side filter, and both strategy-effectiveness RPCs are all
-- already source-agnostic (item_type/passport_id driven, never branching
-- on source_document_type) -- a 'bsp'-sourced row works through every
-- one of them with zero code change. This migration is ONLY: (1) the
-- push itself, inside sign_bsp()'s own transaction; (2) the revision
-- case, which the inheritance proof did not cover and needed its own
-- design.
--
-- ***************************************************************************
-- THE REVISION TRAP -- A PRECEDENT SAFE IN ITS OWN CONTEXT, DESTRUCTIVE IN
-- A NEW ONE. RECORDED HERE SO IT IS NOT REPEATED THE NEXT TIME SOMETHING
-- IN THIS SCHEMA GAINS A REVISION CONCEPT.
--
-- finalize_fba_report() (0197/0199) deletes-then-inserts its own pushed
-- rows, scoped by source_document_id, purely as idempotency belt-and-
-- braces against a hypothetical re-run -- safe, because an FBA is never
-- revised; that document's own draft-lock means the delete can only
-- ever clear rows IT ITSELF wrote a moment earlier in the exact same
-- call. Naively reusing that shape for a BSP REVISION -- deleting the
-- PRIOR plan's own pushed rows when a new version is signed -- would
-- have been a different operation wearing the same syntax: strategy_
-- feedback.strategy_content_id references passport_clinical_content(id)
-- ON DELETE CASCADE. Deleting the prior plan's rows would silently
-- destroy every "helped/partly/not" rating a teacher had already logged
-- against them -- real clinical signal, permanently erased, at the exact
-- moment a plan changes hands. FBA was never at risk of this because FBA
-- has no revision concept; BSP is the first document in this schema
-- that can be superseded, and that is precisely what made the borrowed
-- pattern wrong here. A precedent proven safe in its original context
-- is not automatically safe in a new one -- the thing that changed was
-- not the code, it was what could now reference the row being deleted.
--
-- THE FIX: never delete passport_clinical_content on revision. Gate
-- VISIBILITY of a bsp-sourced row on whether its sourcing bsp is still
-- status = 'active', for every "acting on current guidance" reader
-- (parent, teacher/SNA, principal) -- superseded rows go invisible the
-- instant the new plan is activated (same transaction as the supersede),
-- never destroyed. strategy_feedback history survives permanently,
-- correctly attributed to whichever specific bsp version was live when
-- the rating was given. The clinician's own reads (both the raw RLS
-- branch and both strategy-effectiveness RPCs) are left completely
-- unconditional, deliberately: "we tried this in September, it didn't
-- help, that's why the plan changed" is exactly the evidence that
-- justified the revision, and hiding it would remove the reason the
-- change happened, not just old data.
-- ***************************************************************************
--
-- ***************************************************************************
-- THE SELF-REFERENTIAL RLS TRAP, PRE-EMPTED THIS TIME -- FOURTH INSTANCE
-- OF THIS SCHEMA'S OWN DOCUMENTED FAILURE MODE, FIRST TIME CAUGHT BEFORE
-- SHIPPING RATHER THAN FOUND LIVE BY A FIXTURE.
--
-- A naive `exists (select 1 from bsp where id = source_document_id and
-- status = 'active')` written DIRECTLY inside passport_clinical_content's
-- own RLS policy would run under the CALLING session's own RLS on bsp --
-- and bsp's own SELECT policy is clinician-author-or-domain-colleague
-- only. A teacher or parent querying through that inline subquery would
-- get zero rows back from bsp, EVERY time, making the check silently
-- always-false and hiding every current, legitimate BSP strategy from
-- every teacher and parent permanently -- the identical shape that hit
-- clinical_lead_scope twice (0207/0217) and assessments once (0233/0234),
-- each time found live, after shipping, by a verification fixture.
-- _bsp_source_still_active() below is a SECURITY DEFINER helper for
-- exactly that reason, checked against the live pattern before writing
-- a single policy that calls it.
-- ***************************************************************************

-- ===========================================================================
-- 1. The helper. A no-op (returns true unconditionally) for any row
-- whose source_document_type isn't 'bsp' -- FBA rows, and anything else
-- this table ever gains, sail through untouched.
-- ===========================================================================

create or replace function public._bsp_source_still_active(
  p_source_document_type text,
  p_source_document_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select p_source_document_type <> 'bsp'
    or exists (
      select 1 from public.bsp b
      where b.id = p_source_document_id and b.status = 'active'
    );
$$;

grant execute on function public._bsp_source_still_active(text, uuid) to authenticated;

-- ===========================================================================
-- 2. passport_clinical_content -- the parent's and the teacher's own
-- read policies both gate on the helper. The clinician policy (this
-- table's third SELECT policy) is untouched, deliberately -- full
-- history, always.
-- ===========================================================================

alter policy "Parents can view clinical content for their own passport"
  on public.passport_clinical_content
  using (
    public.owns_passport(passport_clinical_content.passport_id)
    and public._bsp_source_still_active(
      passport_clinical_content.source_document_type,
      passport_clinical_content.source_document_id
    )
  );

alter policy "Teachers with active access can view school-relevant clinical content"
  on public.passport_clinical_content
  using (
    item_type in ('strategy_school', 'strategy_shared', 'trigger', 'setting_event')
    and public.has_child_access(auth.uid(), passport_clinical_content.passport_id)
    and public._bsp_source_still_active(
      passport_clinical_content.source_document_type,
      passport_clinical_content.source_document_id
    )
  );

-- ===========================================================================
-- 3. get_passport_clinical_content() -- the actual client read path.
-- Same gate added to the owns_passport branch, the has_child_access
-- branch, and the principal branch (0160) -- the clinician branch
-- (clinician_access + is_verified_clinician) is left unconditional,
-- matching the RLS change above exactly. CREATE OR REPLACE is
-- sufficient -- same signature, same return shape, reproduced verbatim
-- from the live (0160) body otherwise.
-- ===========================================================================

create or replace function public.get_passport_clinical_content(p_passport_id uuid)
returns table (
  id uuid,
  item_type text,
  content jsonb,
  author_role text,
  author_name text,
  author_specialty text,
  source_document_type text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    pcc.id,
    pcc.item_type,
    pcc.content,
    pcc.author_role,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as author_name,
    c.specialty as author_specialty,
    pcc.source_document_type,
    pcc.created_at
  from public.passport_clinical_content pcc
  join auth.users u on u.id = pcc.author_id
  left join public.clinicians c on c.user_id = pcc.author_id
  where pcc.passport_id = p_passport_id
    and (
      (
        public.owns_passport(p_passport_id)
        and public._bsp_source_still_active(pcc.source_document_type, pcc.source_document_id)
      )
      or (
        exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = p_passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
        and public.is_verified_clinician(auth.uid())
      )
      or (
        pcc.item_type in ('strategy_school', 'strategy_shared', 'trigger', 'setting_event')
        and public.has_child_access(auth.uid(), p_passport_id)
        and public._bsp_source_still_active(pcc.source_document_type, pcc.source_document_id)
      )
      or (
        pcc.item_type in ('strategy_school', 'strategy_shared', 'trigger', 'setting_event')
        and public._bsp_source_still_active(pcc.source_document_type, pcc.source_document_id)
        and exists (
          select 1 from public.institution_staff s
          join public.passport_institution_links pil on pil.institution_id = s.institution_id
          where pil.passport_id = p_passport_id
            and s.user_id = auth.uid()
            and s.role = 'principal'
            and s.deactivated_at is null
            and s.approved_at is not null
        )
      )
    )
  order by pcc.created_at asc;
$$;

grant execute on function public.get_passport_clinical_content(uuid) to authenticated;

-- ===========================================================================
-- 4. strategy_feedback -- the teacher's own INSERT policy hardened the
-- same way: today it verifies item_type only, never whether the
-- sourcing document is still current. The EOD wizard can never
-- construct a rating against a superseded row in the first place (its
-- own candidate list comes from get_passport_clinical_content(), which
-- no longer returns one) -- this closes the direct-write path too,
-- matching the "don't trust the UI, validate at write time" standard
-- already applied to assign_assessment_respondent() (0239).
-- ===========================================================================

alter policy "Teachers can rate school/shared strategies on linked passports"
  on public.strategy_feedback
  with check (
    rater_id = auth.uid()
    and rater_role = 'teacher'
    and context = 'eod'
    and strategy_content_id is not null
    and public.has_class_teacher_access(auth.uid(), strategy_feedback.passport_id)
    and exists (
      select 1 from public.passport_clinical_content pcc
      where pcc.id = strategy_feedback.strategy_content_id
        and pcc.passport_id = strategy_feedback.passport_id
        and pcc.item_type in ('strategy_school', 'strategy_shared')
        and public._bsp_source_still_active(pcc.source_document_type, pcc.source_document_id)
    )
  );

-- ===========================================================================
-- 5. sign_bsp() -- the push itself, same transaction as the sign.
-- Identical for a first sign and a revision sign -- there is no
-- revision-specific branch in the push logic at all; the gate above is
-- what makes a superseded plan's own already-pushed rows go invisible
-- the instant this function activates its replacement, orthogonal to
-- whether THIS sign happens to also be superseding something.
--
-- Home-placement strategies never enter the loop at all -- the WHERE
-- clause is the entire enforcement of "home never crosses", not a
-- filter applied after the fact.
--
-- description composition, per Daniel's own correction: WHY FIRST, then
-- HOW. A BSP strategy's "why" (in the real document: "Rian benefits
-- from predictability and clear visual information about what is
-- happening now, what is finished, and what is coming next.") is
-- written for the person implementing it, not clinical reasoning to
-- shield a teacher from -- unlike an FBA's own hypothesis fields, which
-- stay unpushed for exactly that reason. scripted_language and
-- materials_and_setup follow when present; caveat travels last, on ANY
-- strategy that has one (school or shared, not just shared) -- if a
-- clinician wrote it, they meant to convey it.
--
-- The delete-then-insert scoped to (source_document_type='bsp',
-- source_document_id=p_bsp_id) is belt-and-braces, not structurally
-- required -- a bsp can only ever be signed once (status <> 'draft'
-- refuses a re-sign) -- kept only for defensive symmetry with
-- finalize_fba_report()'s own idempotency guard.
-- ===========================================================================

create or replace function public.sign_bsp(p_bsp_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_prior record;
  v_child_name text;
  v_strategy record;
  v_item_type text;
  v_description text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_row from public.bsp where id = p_bsp_id;
  if v_row.id is null then
    raise exception 'Plan not found.';
  end if;

  if v_row.clinician_id is distinct from auth.uid() then
    raise exception 'Only the plan''s own author may sign it.';
  end if;

  if v_row.status <> 'draft' then
    raise exception 'This plan has already been signed.';
  end if;

  if v_row.supersedes_id is not null then
    select * into v_prior from public.bsp where id = v_row.supersedes_id;
    if v_prior.id is null or v_prior.status <> 'active' then
      raise exception 'The plan this one supersedes is no longer active.';
    end if;

    update public.bsp
    set status = 'superseded'
    where id = v_row.supersedes_id;
  end if;

  update public.bsp
  set status = 'active',
      signed_at = now(),
      signed_by = auth.uid()
  where id = p_bsp_id;

  select child_name into v_child_name from public.passports where id = v_row.passport_id;

  delete from public.passport_clinical_content
  where source_document_type = 'bsp' and source_document_id = p_bsp_id;

  for v_strategy in
    select * from public.bsp_strategies
    where bsp_id = p_bsp_id and placement in ('school', 'shared')
  loop
    v_item_type := case v_strategy.placement when 'school' then 'strategy_school' else 'strategy_shared' end;

    v_description := v_strategy.why || E'\n' || v_strategy.how;
    if v_strategy.scripted_language is not null and trim(v_strategy.scripted_language) <> '' then
      v_description := v_description || E'\n' || v_strategy.scripted_language;
    end if;
    if v_strategy.materials_and_setup is not null and trim(v_strategy.materials_and_setup) <> '' then
      v_description := v_description || E'\n' || v_strategy.materials_and_setup;
    end if;
    if v_strategy.caveat is not null and trim(v_strategy.caveat) <> '' then
      v_description := v_description || E'\n' || v_strategy.caveat;
    end if;

    insert into public.passport_clinical_content
      (passport_id, author_id, author_role, source_document_type, source_document_id, item_type, content)
    values (
      v_row.passport_id, auth.uid(), 'clinician', 'bsp', p_bsp_id, v_item_type,
      jsonb_build_object('title', v_strategy.title, 'description', v_description)
    );
  end loop;

  insert into public.activity_log (passport_id, actor_id, event_type, event_description)
  values (
    v_row.passport_id, auth.uid(), 'clinical_content_added',
    format('Clinician strategies added to %s''s passport', v_child_name)
  );
end;
$$;

grant execute on function public.sign_bsp(uuid) to authenticated;

-- ===========================================================================
-- NOT FIXED HERE, RECORDED SO IT ISN'T MISTAKEN FOR AN OVERSIGHT LATER:
-- get_clinician_strategy_type_insights()'s caseload rollup groups by
-- content->>'strategy_type_id', a concept bsp_strategies has no
-- equivalent of -- every BSP-sourced rating buckets into the rollup's
-- existing 'Untagged' group (the left join public.strategy_types
-- already coalesces a null key to that label; nothing crashes, nothing
-- is excluded). This is fine today. It is not "a missing field" -- it
-- is a rollup that LOSES RESOLUTION as BSP adoption grows: the more
-- classroom strategies originate from BSPs rather than FBAs, the more
-- of the caseload-wide view collapses into one undifferentiated bucket
-- instead of distinguishing anything. The likely fix is a strategy_type
-- on the bank itself (strategy_bank/bsp_strategies), not a change to
-- this rollup's own SQL -- and it is not this stage's problem to solve.
-- ===========================================================================
