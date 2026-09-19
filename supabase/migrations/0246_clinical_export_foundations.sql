-- PRD 8 Stage 2 -- clinical export, foundations only. The export screens
-- themselves (both directions), the director-wide reads for
-- fba_reports/bsp/clinical_plans/assessments, and the zip/document
-- generation path are all deliberately NOT built in this migration --
-- each is a real, separate decision Daniel is still weighing (which
-- generation path replaces window.print() for a bundled download; and
-- whether a clinic director's export should be able to see a colleague's
-- FBA/BSP/plan/assessment at all, given each of those four tables was
-- scoped author-only on purpose, the same way session_notes was before
-- PRD 6 Stage 4 gave it its own explicitly-requested director branch).
-- This migration is the part that's unblocked either way: the toggle,
-- the audit event type, and the one genuinely load-bearing finding from
-- this stage's own recon -- the time-scoped authorship join.

-- =====================================================================
-- 1. practitioner_can_export_own_clients -- same shape as
-- practitioner_can_onboard / practitioner_can_discharge_own_clients
-- (0207), default false. Deliberately NOT a flat permission: a
-- practitioner can already read everything a clinical export of their
-- own material would contain -- RLS on fba_reports/bsp/clinical_plans/
-- assessments/session_notes/passport_clinical_content/abc_logs already
-- lets an author read their own rows. What changes when this is on
-- isn't access -- it's that a file leaves the building. That's the
-- thing worth a clinic's own decision, same reasoning as the two
-- existing toggles.
-- =====================================================================

alter table public.institutions
  add column if not exists practitioner_can_export_own_clients boolean not null default false;


-- =====================================================================
-- 2. activity_log gains 'clinical_export_generated'. Recorded NOW, not
-- deferred to the Stage 5 cross-organisation read audit -- that stage
-- is a materially bigger mechanism (intercepting ordinary reads across
-- many existing, already-scoped query paths); an export is a single,
-- already-centralized action (one screen, one moment) and costs one
-- event_type, matching this table's own established precedent for
-- exactly this shape of thing (fba_started, clinical_content_added,
-- session_note_shared -- record a significant thing as it happens,
-- don't wait for the eventual bigger system that would also cover it).
-- =====================================================================

alter table public.activity_log drop constraint if exists activity_log_event_type_check;
alter table public.activity_log add constraint activity_log_event_type_check
  check (event_type in (
    'passport_updated', 'morning_checkin', 'afternoon_update', 'abc_logged',
    'passport_shared', 'team_linked', 'clinician_logged', 'strategy_logged',
    'access_revoked', 'fba_started', 'fba_completed', 'clinical_content_added',
    'questionnaire_sent', 'questionnaire_completed', 'calm_escalation',
    'session_note_shared', 'session_note_updated', 'clinical_export_generated'
  ));

-- No change needed to get_parent_activity_feed()'s exclusion list (0152)
-- or the parent SELECT policy's exclusion list (0054) -- both are short,
-- specific denylists (questionnaire_sent/completed, calm_escalation);
-- anything not named is visible to a parent by default, which is
-- exactly right here -- a parent should be able to see that their
-- child's full clinical file left the clinic, the same reasoning PRD 8
-- section 11's own open question ("does a parent see that two
-- organisations are attached") already leans toward.

create or replace function public.record_clinical_export(
  p_passport_id uuid,
  p_institution_id uuid,
  p_scope text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_institution_name text;
  v_description text;
begin
  -- Deliberately narrow: confirms the caller has SOME active staff
  -- relationship to the exporting institution, and that institution is
  -- genuinely linked to this passport. It does not re-derive the full
  -- "may this specific person export this specific material" rule --
  -- that's already decided by which screen the caller could even reach
  -- (director-only, or a practitioner with the toggle on, exporting
  -- their own material) to get here in the first place. This function
  -- records that an export happened; it does not authorize it.
  if not exists (
    select 1
    from public.institution_staff s
    join public.passport_institution_links pil on pil.institution_id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and pil.passport_id = p_passport_id
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
  ) then
    raise exception 'Only current staff at an institution linked to this child may record an export for them.';
  end if;

  select name into v_institution_name from public.institutions where id = p_institution_id;
  v_description := coalesce(v_institution_name, 'An organisation') || ' exported ' || p_scope || ' for this child.';

  insert into public.activity_log (passport_id, actor_id, event_type, event_description)
  values (p_passport_id, auth.uid(), 'clinical_export_generated', v_description);
end;
$$;

grant execute on function public.record_clinical_export(uuid, uuid, text) to authenticated;


-- =====================================================================
-- 3. The time-scoped authorship join -- THE load-bearing finding from
-- this stage's own recon.
--
-- institution_staff has no uniqueness constraint across TIME -- only
-- institution_staff_one_active_per_institution (0100), one ACTIVE row
-- per (institution_id, user_id). Nothing stops a clinician from having
-- a second, historical row at a DIFFERENT institution once they've left
-- the first. A naive "clinician_id's CURRENT institution_staff row"
-- join would silently misattribute a clinician's old work to whichever
-- clinic they work at TODAY -- and it would look completely correct
-- until the day someone actually moved between two clinics on this
-- platform, which is exactly the kind of bug that survives every
-- fixture built against a single-clinic reality and only shows up live,
-- against a real personnel change, with no error anywhere to explain
-- it. "Ownership follows authorship, permanently" (PRD 8 section 2) is
-- only actually true if the join resolving that ownership is anchored
-- to the moment authorship happened, not to whoever the author reports
-- to today.
--
-- _clinician_authored_at_institution(clinician, institution, at) is
-- that anchor: true only if the clinician held an APPROVED
-- institution_staff row at that institution whose own tenure window
-- (approved_at .. deactivated_at, open-ended if still active) covers
-- the moment in question. Every clinician-authored table this stage
-- touches (fba_reports, bsp, clinical_plans, assessments, session_notes,
-- passport_clinical_content, and abc_logs' own clinician-role rows) uses
-- this same one function rather than each export query re-deriving the
-- identical join a different way.
-- =====================================================================

create or replace function public._clinician_authored_at_institution(
  p_clinician_id uuid,
  p_institution_id uuid,
  p_at timestamptz
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.institution_staff s
    where s.user_id = p_clinician_id
      and s.institution_id = p_institution_id
      and s.role = 'clinician'
      and s.approved_at is not null
      and s.approved_at <= p_at
      and (s.deactivated_at is null or s.deactivated_at > p_at)
  );
$$;

grant execute on function public._clinician_authored_at_institution(uuid, uuid, timestamptz) to authenticated;
