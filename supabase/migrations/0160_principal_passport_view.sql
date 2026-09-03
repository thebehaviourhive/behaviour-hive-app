-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Principal passport view. Confirmed before writing this: a principal
-- has NO path to a child's actual behavioural passport content at all
-- -- not Section A, not B/C/D, not clinical content. ChildDetail.tsx
-- (the principal's own child detail page) has zero references to any
-- of passport_section_b/c/d, and passports/passport_section_b/c/d/
-- passport_clinical_content are all gated on has_child_access(), which
-- is has_class_teacher_access() OR has_sna_access() -- no principal
-- branch, anywhere. get_institution_child_roster(), the one RPC a
-- principal already uses for children, returns exactly passport_id and
-- child_name. Only administrative metadata (enrolment, access grants,
-- clinician engagement history) was ever visible to a principal.
--
-- SCOPE, per Daniel's own instruction: "full view of institution facing
-- material, so same level permissions as a class_teacher role."
-- Deliberately READ-ONLY -- this is a VIEW, not parity with a teacher's
-- own tools (ABC logging, strategy rating, messaging). Deliberately the
-- SAME field set a class_teacher actually sees today, not a broader
-- "full passport" dump: the teacher passport page's own Section A/B/C/D
-- query (src/app/teacher/passport/[passportId]/page.tsx) selects a
-- curated subset of each table's columns, not every column -- e.g.
-- passport_section_c's own okay_signals-equivalent fields are never
-- selected there. This migration's new RPC mirrors that exact field
-- list, column for column, so "same level of permissions" means the
-- same VISIBILITY, not a different, broader curation invented here.
--
-- NOT done by widening has_child_access() itself -- that helper backs
-- 45 separate policy references across 11 migration files, including
-- write policies (e.g. strategy_feedback's own INSERT gate uses the
-- narrower has_class_teacher_access() specifically). Widening the
-- shared read/write building block to add "view" access for a new role
-- risks granting far more than viewing, silently, in places this
-- migration never audited. Matches this codebase's own established
-- pattern instead (CLAUDE.md: "when a relationship is deliberately
-- broader than the joined table's own RLS... resolve it through a
-- dedicated SECURITY DEFINER RPC", the same reasoning behind
-- get_institution_child_roster() itself): a new, principal-scoped,
-- read-only RPC for Section A/B/C/D, and one new OR-branch on the
-- EXISTING get_passport_clinical_content() RPC -- already the shared,
-- role-aware read path for parent/clinician/teacher clinical content,
-- so this is additive to an RPC already designed for exactly this kind
-- of role branching, not a new mechanism.
--
-- INSTITUTION-FACING ONLY, same restriction the class_teacher branch
-- already enforces: item_type in ('strategy_school', 'strategy_shared',
-- 'trigger', 'setting_event'). strategy_home stays parent/clinician-
-- only -- CLAUDE.md's own "HOME LOGS REACH THE CLASSROOM BY DESIGN, VIA
-- THE CLINICIAN" rule, unchanged by this migration, not reconsidered.
--
-- CORRECTION, found while chasing what looked like a bug: the teacher
-- page's own Section D query selects sensory_seeks_other. A grep of
-- supabase/migrations/ alone found no migration creating that column
-- and this file originally said so, flagging it as broken. Checked the
-- LIVE database directly before that claim shipped any further -- the
-- column genuinely exists in production (confirmed via a real select
-- against passport_section_d, real data came back). It's schema
-- drift, not a broken query: the column was added directly to the live
-- database at some point and never captured as a migration file here,
-- the exact gap "a migration isn't complete until it's both run AND
-- committed as a file" exists to prevent. Captured retroactively below
-- so the repo matches what's actually live, and included in this RPC's
-- own column list -- omitting it would have been the real gap, since
-- the teacher's own view includes it and "same level of permissions"
-- means the same fields.

-- Retroactive: passport_section_d.sensory_seeks_other exists live in
-- production today but was never created by any committed migration.
-- IF NOT EXISTS makes this a no-op against production (the column is
-- already there) while bringing the repo's own schema history in line
-- with reality, and makes this safe to run against any OTHER
-- environment (a fresh database, a future staging copy) where it
-- genuinely would be missing.
alter table public.passport_section_d
  add column if not exists sensory_seeks_other text;

create or replace function public.get_child_passport_profile_for_principal(
  p_passport_id uuid
)
returns table (
  child_name text,
  diagnoses text[],
  diagnosis_other text,
  section_a_complete boolean,
  hard_signals text[],
  hard_signals_other text,
  hard_triggers text[],
  hard_triggers_other text,
  communication_methods text[],
  communication_methods_other text,
  shows_happy text,
  shows_anxious text,
  phrases_to_avoid text,
  before_behaviour text[],
  before_behaviour_other text,
  during_distress text[],
  during_distress_other text,
  after_distress text[],
  after_distress_other text,
  sensory_seeks text[],
  sensory_seeks_other text,
  sensory_avoids text[],
  sensory_avoids_other text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.child_name, p.diagnoses, p.diagnosis_other, p.section_a_complete,
    sb.hard_signals, sb.hard_signals_other, sb.hard_triggers, sb.hard_triggers_other,
    sc.communication_methods, sc.communication_methods_other, sc.shows_happy, sc.shows_anxious, sc.phrases_to_avoid,
    sd.before_behaviour, sd.before_behaviour_other, sd.during_distress, sd.during_distress_other,
    sd.after_distress, sd.after_distress_other, sd.sensory_seeks, sd.sensory_seeks_other, sd.sensory_avoids, sd.sensory_avoids_other
  from public.passports p
  left join public.passport_section_b sb on sb.passport_id = p.id
  left join public.passport_section_c sc on sc.passport_id = p.id
  left join public.passport_section_d sd on sd.passport_id = p.id
  where p.id = p_passport_id
    and exists (
      select 1 from public.institution_staff s
      join public.passport_institution_links pil on pil.institution_id = s.institution_id
      where pil.passport_id = p_passport_id
        and s.user_id = auth.uid()
        and s.role = 'principal'
        and s.deactivated_at is null
        and s.approved_at is not null
    );
$$;

grant execute on function public.get_child_passport_profile_for_principal(uuid) to authenticated;

-- get_passport_clinical_content() -- one new OR-branch, principal at an
-- institution this child is linked to, same item_type restriction the
-- existing has_child_access() branch already enforces. Everything else
-- reproduced verbatim from the live (0104) body -- CREATE OR REPLACE is
-- sufficient, same signature, same return shape.

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
      public.owns_passport(p_passport_id)
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
      )
      or (
        pcc.item_type in ('strategy_school', 'strategy_shared', 'trigger', 'setting_event')
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
