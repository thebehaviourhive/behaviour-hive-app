-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 6, Stage 4 -- the director's own reading surface. Daniel's own
-- instruction: Stage 4 is director-only for now (the clinical_lead
-- half is deferred -- see CLAUDE.md's own dedicated entry on why).
--
-- session_notes' own SELECT policy (0228) already lets a clinic's
-- director read every note authored by any clinician at that clinic,
-- author standing never required, director standing always required.
-- That policy is proven live (0229's own fixture, 35/35). This
-- function does NOT re-grant anything new -- it exists only because a
-- SECURITY DEFINER function bypasses RLS for every table it touches
-- (including session_notes itself), so the director check has to be
-- re-derived explicitly here, byte-for-byte the same predicate the
-- policy already uses, rather than assumed to still apply. Matches
-- get_shared_session_notes()'s own reason for existing as a function
-- rather than a raw client-side select() -- both need the auth.users
-- join for a clinician's display name, which RLS alone can never give
-- a client session (auth.users has no client-readable policy at all).
--
-- Unlike get_shared_session_notes(), this returns clinical_record too
-- -- a director's own read is total, matching the base table's own
-- policy exactly; there is no redaction boundary between a director
-- and the clinical record the way there structurally is for a parent.
create or replace function public.get_session_notes_for_director(p_passport_id uuid)
returns table (
  id uuid,
  session_date date,
  clinical_record text,
  parent_note text,
  is_shared_with_parent boolean,
  shared_at timestamptz,
  parent_note_edited_after_share_at timestamptz,
  clinician_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select sn.id, sn.session_date, sn.clinical_record, sn.parent_note, sn.is_shared_with_parent,
    sn.shared_at, sn.parent_note_edited_after_share_at,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name')
  from public.session_notes sn
  join auth.users u on u.id = sn.clinician_id
  where sn.passport_id = p_passport_id
    and exists (
      select 1
      from public.institution_staff author_staff
      join public.institution_staff director on director.institution_id = author_staff.institution_id
      join public.institutions inst on inst.id = director.institution_id
      where author_staff.user_id = sn.clinician_id
        and author_staff.role = 'clinician'
        and director.user_id = auth.uid()
        and director.role = 'principal'
        and inst.status = 'verified'
        and inst.type = 'clinic'
        and public.institution_staff_has_current_standing(director.user_id, director.institution_id)
    )
  order by sn.session_date desc, sn.created_at desc;
$$;

grant execute on function public.get_session_notes_for_director(uuid) to authenticated;
