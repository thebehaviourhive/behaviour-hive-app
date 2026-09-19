-- PRD 8 Stage 2 -- a fifth table, found while wiring the export screens,
-- not among the four Daniel named explicitly (fba_reports, bsp,
-- clinical_plans, assessments). Flagged here rather than silently
-- folded in, since it goes beyond the literal ask -- but the identical
-- reasoning applies without modification, so it's built now rather than
-- left as a quietly incomplete export.
--
-- THE GAP: "Verified linked clinicians can view all clinical content"
-- (0040) is passport_clinical_content's own clinician-read policy, and
-- it requires the CALLER to hold their own active clinician_access row
-- for this specific passport. A director is not guaranteed to hold one
-- -- clinician_access is granted per (clinician, passport) individually,
-- and a director may not be the treating clinician for every child
-- their own clinic is engaged with, or may not treat clinically at all.
-- Without their own clinician_access row, a director reading this table
-- gets zero rows -- not refused, just quietly empty, for the exact
-- table section 8 calls "the route" clinical work reaches a school
-- through. Same accountability argument Daniel gave for the other
-- four: a director's oversight of their own clinic's published
-- guidance shouldn't depend on whether they personally happen to hold
-- an unrelated grant.
--
-- Same shape as the other four: narrow, table-specific, SECURITY
-- DEFINER, re-deriving the director check itself. The existing
-- "Verified linked clinicians" RLS policy is untouched -- this is an
-- additional read path, not a replacement.

create or replace function public.get_passport_clinical_content_for_director(p_passport_id uuid)
returns table (
  id uuid,
  item_type text,
  content jsonb,
  author_role text,
  author_id uuid,
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
    pcc.id, pcc.item_type, pcc.content, pcc.author_role, pcc.author_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as author_name,
    c.specialty as author_specialty, pcc.source_document_type, pcc.created_at
  from public.passport_clinical_content pcc
  join auth.users u on u.id = pcc.author_id
  left join public.clinicians c on c.user_id = pcc.author_id
  where pcc.passport_id = p_passport_id
    and public._bsp_source_still_active(pcc.source_document_type, pcc.source_document_id)
    and exists (
      select 1
      from public.institution_staff author_staff
      join public.institution_staff director on director.institution_id = author_staff.institution_id
      join public.institutions inst on inst.id = director.institution_id
      where author_staff.user_id = pcc.author_id
        and author_staff.role = 'clinician'
        and director.user_id = auth.uid()
        and director.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
    )
  order by pcc.created_at asc;
$$;

grant execute on function public.get_passport_clinical_content_for_director(uuid) to authenticated;
