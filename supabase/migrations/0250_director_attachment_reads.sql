-- PRD 8 Stage 2 -- a sixth extension, found building the verification
-- fixture's own "zip containing real attachment bytes" check, which is
-- exactly what this closes. Same reasoning as the fifth table
-- (passport_clinical_content, 0248), flagged the same way: goes beyond
-- the four tables named explicitly, but the identical accountability
-- argument applies without modification, and _caller_owns_artefact()'s
-- own 0232 header already anticipated this exact addition -- its
-- comment names "director, eventually" as a future arm before this
-- stage ever existed.
--
-- THE GAP: attachments' own SELECT policy, and storage.objects' own
-- read policy for this bucket, both gate entirely through
-- _caller_owns_artefact() -- author-only, no director branch, for
-- either the 'assessment' or 'clinical_plan' arm. A director exporting
-- their own clinic's material could read the ASSESSMENT/PLAN row itself
-- (via 0247/0248's own RPCs) but could not generate a signed URL for,
-- or even see the existence of, any file attached to it -- the "Download
-- attachments" zip would silently produce nothing for anything the
-- director didn't personally author.
--
-- Same time-scoped test as the other six reads (_clinician_authored_at_
-- institution()), applied to the artefact's own author and created_at.
-- Only _caller_owns_artefact() changes -- _caller_can_modify_artefact_
-- attachments() (upload/delete) stays author-only, deliberately: a
-- director reading their clinic's own material for export is not the
-- same claim as a director editing a colleague's attachments, which
-- nobody has asked for and this migration does not grant.

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
        and (
          a.clinician_id = auth.uid()
          or exists (
            select 1
            from public.institution_staff director
            join public.institutions inst on inst.id = director.institution_id
            where director.user_id = auth.uid()
              and director.role = 'principal'
              and inst.status = 'verified'
              and inst.type = 'clinic'
              and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
              and public._clinician_authored_at_institution(a.clinician_id, director.institution_id, a.created_at)
          )
        )
    )
    when 'clinical_plan' then exists (
      select 1 from public.clinical_plans cp
      where cp.id = p_artefact_id
        and (
          cp.clinician_id = auth.uid()
          or exists (
            select 1
            from public.institution_staff director
            join public.institutions inst on inst.id = director.institution_id
            where director.user_id = auth.uid()
              and director.role = 'principal'
              and inst.status = 'verified'
              and inst.type = 'clinic'
              and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
              and public._clinician_authored_at_institution(cp.clinician_id, director.institution_id, cp.created_at)
          )
        )
    )
    else false
  end;
$$;
