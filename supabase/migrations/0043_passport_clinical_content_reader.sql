-- FBA MODULE -- STAGE 3, Part E addition: one read RPC for the "From
-- your Clinical Team" passport section, discovered mid-build.
--
-- passport_clinical_content.author_id references auth.users, which no
-- client role can query directly, and the two existing paths that
-- resolve a clinician's display name are both dead ends here:
-- `clinicians` only grants SELECT to the clinician themselves, and
-- get_passport_team() is hard-gated to `owns_passport()` in every
-- branch -- a teacher calling it gets zero rows regardless of role. So
-- there is currently no way for a teacher (or, for that matter, a
-- clinician viewing another clinician's earlier entry) to see who
-- authored an extracted trigger or strategy.
--
-- get_passport_clinical_content() re-implements the EXACT SAME three
-- conditions already enforced by passport_clinical_content's existing
-- RLS policies (owns_passport full access / verified-linked-clinician
-- full access / linked-teacher school-relevant-item_types-only) -- this
-- doesn't widen who can see what, it only adds server-side name
-- resolution on top of access every caller already has at the row
-- level. Same SECURITY DEFINER convenience-RPC pattern as
-- get_clinician_passports/get_passport_team elsewhere in this schema.
-- No table or column changes.

create or replace function public.get_passport_clinical_content(p_passport_id uuid)
returns table (
  id uuid,
  item_type text,
  content jsonb,
  author_role text,
  author_name text,
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
    pcc.source_document_type,
    pcc.created_at
  from public.passport_clinical_content pcc
  join auth.users u on u.id = pcc.author_id
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
        and exists (
          select 1 from public.passport_access pa
          where pa.passport_id = p_passport_id
            and pa.teacher_id = auth.uid()
            and pa.is_active = true
        )
      )
    )
  order by pcc.created_at asc;
$$;

grant execute on function public.get_passport_clinical_content(uuid) to authenticated;
